const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');

// Middleware de autenticação para rotas de admin
function auth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Acesso negado' });

  try {
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

router.use(auth);

router.get('/', (req, res) => {
  const scripts = req.db.prepare('SELECT id, name, status, updated_at FROM scripts ORDER BY updated_at DESC').all();
  res.json(scripts);
});

router.get('/:id', (req, res) => {
  const script = req.db.prepare('SELECT * FROM scripts WHERE id = ?').get([req.params.id]);
  if (!script) return res.status(404).json({ error: 'Script não encontrado' });
  res.json(script);
});

router.post('/', (req, res) => {
  const { name, content, status } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'Nome e conteúdo obrigatórios' });

  const id = uuidv4();
  const now = new Date().toISOString();
  req.db.prepare('INSERT INTO scripts (id, name, content, status, updated_at) VALUES (?, ?, ?, ?, ?)').run([id, name, content, status || 'online', now]);
  req.saveDb();

  const newScript = req.db.prepare('SELECT * FROM scripts WHERE id = ?').get([id]);
  res.status(201).json(newScript);
});

router.put('/:id', (req, res) => {
  const script = req.db.prepare('SELECT * FROM scripts WHERE id = ?').get([req.params.id]);
  if (!script) return res.status(404).json({ error: 'Script não encontrado' });

  const { name, content, status } = req.body;
  const now = new Date().toISOString();
  req.db.prepare('UPDATE scripts SET name = COALESCE(?, name), content = COALESCE(?, content), status = COALESCE(?, status), updated_at = ? WHERE id = ?')
    .run([name || null, content || null, status || null, now, req.params.id]);
  req.saveDb();

  const updated = req.db.prepare('SELECT * FROM scripts WHERE id = ?').get([req.params.id]);
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const script = req.db.prepare('SELECT * FROM scripts WHERE id = ?').get([req.params.id]);
  if (!script) return res.status(404).json({ error: 'Script não encontrado' });

  req.db.prepare('DELETE FROM scripts WHERE id = ?').run([req.params.id]);
  req.saveDb();
  res.json({ success: true });
});

module.exports = router;