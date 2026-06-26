require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { initDatabase, getDb, saveDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Injeta o banco nas requisições
app.use((req, res, next) => {
  req.db = getDb();
  req.saveDb = saveDb;
  next();
});

// Auth
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const admin = req.db.prepare('SELECT * FROM admins WHERE username = ?').get([username]);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash))
    return res.status(401).json({ error: 'Credenciais inválidas' });

  const token = jwt.sign({ id: admin.id, username, role: admin.role }, process.env.JWT_SECRET || 'secret', { expiresIn: '8h' });
  res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 8*3600*1000 });
  res.json({ success: true, role: admin.role });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'lax' });
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const d = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    res.json({ username: d.username, role: d.role });
  } catch { res.status(401).json({ error: 'Token inválido' }); }
});

function authMiddleware(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Acesso negado' });
  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    next();
  } catch { res.status(401).json({ error: 'Token inválido' }); }
}

// Scripts
app.get('/api/scripts', authMiddleware, (req, res) => {
  const scripts = req.db.prepare('SELECT id, name, status, tags, executions, updated_at FROM scripts ORDER BY updated_at DESC').all();
  res.json(scripts.map(s => ({ ...s, tags: JSON.parse(s.tags || '[]') })));
});

app.get('/api/scripts/:id', authMiddleware, (req, res) => {
  const s = req.db.prepare('SELECT * FROM scripts WHERE id = ?').get([req.params.id]);
  if (!s) return res.status(404).json({ error: 'Script não encontrado' });
  s.tags = JSON.parse(s.tags || '[]');
  res.json(s);
});

app.post('/api/scripts', authMiddleware, (req, res) => {
  const { name, content, status, tags } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'Nome e conteúdo obrigatórios' });
  const id = uuidv4();
  const now = new Date().toISOString();
  req.db.prepare('INSERT INTO scripts (id, name, content, status, tags, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run([id, name, content, status || 'online', JSON.stringify(tags || []), now]);
  req.saveDb();
  const newScript = req.db.prepare('SELECT * FROM scripts WHERE id = ?').get([id]);
  newScript.tags = JSON.parse(newScript.tags || '[]');
  res.status(201).json(newScript);
});

app.put('/api/scripts/:id', authMiddleware, (req, res) => {
  const original = req.db.prepare('SELECT * FROM scripts WHERE id = ?').get([req.params.id]);
  if (!original) return res.status(404).json({ error: 'Script não encontrado' });

  // Salva versão anterior
  req.db.prepare('INSERT INTO versions (id, script_id, name, content, status, tags) VALUES (?, ?, ?, ?, ?, ?)').run([uuidv4(), original.id, original.name, original.content, original.status, original.tags]);
  req.saveDb();

  const { name, content, status, tags } = req.body;
  const now = new Date().toISOString();
  req.db.prepare('UPDATE scripts SET name = COALESCE(?, name), content = COALESCE(?, content), status = COALESCE(?, status), tags = COALESCE(?, tags), updated_at = ? WHERE id = ?').run([name || null, content || null, status || null, tags ? JSON.stringify(tags) : null, now, req.params.id]);
  req.saveDb();
  const updated = req.db.prepare('SELECT * FROM scripts WHERE id = ?').get([req.params.id]);
  updated.tags = JSON.parse(updated.tags || '[]');
  res.json(updated);
});

app.delete('/api/scripts/:id', authMiddleware, (req, res) => {
  req.db.prepare('DELETE FROM scripts WHERE id = ?').run([req.params.id]);
  req.saveDb();
  res.json({ success: true });
});

app.post('/api/scripts/:id/duplicate', authMiddleware, (req, res) => {
  const original = req.db.prepare('SELECT * FROM scripts WHERE id = ?').get([req.params.id]);
  if (!original) return res.status(404).json({ error: 'Script não encontrado' });
  const newId = uuidv4();
  const now = new Date().toISOString();
  req.db.prepare('INSERT INTO scripts (id, name, content, status, tags, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run([newId, original.name + ' (Cópia)', original.content, original.status, original.tags, now]);
  req.saveDb();
  const dup = req.db.prepare('SELECT * FROM scripts WHERE id = ?').get([newId]);
  dup.tags = JSON.parse(dup.tags || '[]');
  res.status(201).json(dup);
});

app.get('/api/scripts/:id/versions', authMiddleware, (req, res) => {
  const versions = req.db.prepare('SELECT * FROM versions WHERE script_id = ? ORDER BY created_at DESC').all([req.params.id]);
  res.json(versions);
});

// Keys
app.get('/api/keys', authMiddleware, (req, res) => {
  const keys = req.db.prepare('SELECT * FROM keys ORDER BY created_at DESC').all();
  res.json(keys);
});

app.post('/api/keys', authMiddleware, (req, res) => {
  const { scriptId, hwid, expiresAt } = req.body;
  const key = 'SATURN-' + uuidv4().slice(0, 16).toUpperCase();
  req.db.prepare('INSERT INTO keys (key, script_id, hwid, expires_at) VALUES (?, ?, ?, ?)').run([key, scriptId || null, hwid || '', expiresAt || null]);
  req.saveDb();
  const newKey = req.db.prepare('SELECT * FROM keys WHERE key = ?').get([key]);
  res.status(201).json(newKey);
});

app.put('/api/keys/:id', authMiddleware, (req, res) => {
  const { hwid, expiresAt, status } = req.body;
  req.db.prepare('UPDATE keys SET hwid = COALESCE(?, hwid), expires_at = COALESCE(?, expires_at), status = COALESCE(?, status) WHERE id = ?').run([hwid || null, expiresAt || null, status || null, req.params.id]);
  req.saveDb();
  res.json({ success: true });
});

app.delete('/api/keys/:id', authMiddleware, (req, res) => {
  req.db.prepare('DELETE FROM keys WHERE id = ?').run([req.params.id]);
  req.saveDb();
  res.json({ success: true });
});

// Loader com key + hwid
app.get('/api/load/:scriptId', (req, res) => {
  const { key, hwid } = req.query;
  if (!key) return res.status(403).sendFile(path.join(__dirname, 'public', 'blocked.html'));

  const keyData = req.db.prepare('SELECT * FROM keys WHERE key = ?').get([key]);
  if (!keyData || keyData.status !== 'active') {
    req.db.prepare('INSERT INTO execution_logs (script_id, key_used, hwid, ip, success) VALUES (?, ?, ?, ?, 0)').run([req.params.scriptId, key, hwid || '', req.ip]);
    req.saveDb();
    return res.status(403).sendFile(path.join(__dirname, 'public', 'blocked.html'));
  }

  if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
    req.db.prepare('UPDATE keys SET status = ? WHERE id = ?').run(['expired', keyData.id]);
    req.saveDb();
    req.db.prepare('INSERT INTO execution_logs (script_id, key_used, hwid, ip, success) VALUES (?, ?, ?, ?, 0)').run([req.params.scriptId, key, hwid || '', req.ip]);
    req.saveDb();
    return res.status(403).sendFile(path.join(__dirname, 'public', 'blocked.html'));
  }

  if (keyData.hwid && hwid !== keyData.hwid) {
    req.db.prepare('INSERT INTO execution_logs (script_id, key_used, hwid, ip, success) VALUES (?, ?, ?, ?, 0)').run([req.params.scriptId, key, hwid || '', req.ip]);
    req.saveDb();
    return res.status(403).sendFile(path.join(__dirname, 'public', 'blocked.html'));
  }

  // Auto-vínculo de HWID no primeiro uso (opcional)
  if (!keyData.hwid && hwid) {
    req.db.prepare('UPDATE keys SET hwid = ? WHERE id = ?').run([hwid, keyData.id]);
    req.saveDb();
  }

  const script = req.db.prepare('SELECT * FROM scripts WHERE id = ? AND status = ?').get([req.params.scriptId, 'online']);
  if (!script) {
    req.db.prepare('INSERT INTO execution_logs (script_id, key_used, hwid, ip, success) VALUES (?, ?, ?, ?, 0)').run([req.params.scriptId, key, hwid || '', req.ip]);
    req.saveDb();
    return res.status(404).sendFile(path.join(__dirname, 'public', 'blocked.html'));
  }

  req.db.prepare('UPDATE scripts SET executions = executions + 1 WHERE id = ?').run([script.id]);
  req.db.prepare('INSERT INTO execution_logs (script_id, key_used, hwid, ip, success) VALUES (?, ?, ?, ?, 1)').run([script.id, key, hwid || '', req.ip]);
  req.saveDb();

  res.type('text/plain').send(script.content);
});

// Stats
app.get('/api/stats', authMiddleware, (req, res) => {
  const scriptsCount = req.db.prepare('SELECT COUNT(*) as count FROM scripts').get().count;
  const keysCount = req.db.prepare('SELECT COUNT(*) as count FROM keys').get().count;
  const execToday = req.db.prepare("SELECT COUNT(*) as count FROM execution_logs WHERE success = 1 AND created_at > datetime('now', '-1 day')").get().count;
  res.json({ totalScripts: scriptsCount, totalKeys: keysCount, executionsToday: execToday });
});

// Páginas
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html')));

(async () => {
  await initDatabase();
  const db = getDb();
  const masterUser = process.env.ADMIN_USER || 'nanagui';
  const masterPass = process.env.ADMIN_PASS || '001010GGZEHEN';
  const adminExists = db.prepare('SELECT id FROM admins WHERE username = ?').get([masterUser]);
  if (!adminExists) {
    const hash = bcrypt.hashSync(masterPass, 10);
    db.prepare('INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?)').run([masterUser, hash, 'master']);
    saveDb();
    console.log('✅ Admin master criado');
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`🪐 Rodando na porta ${PORT}`));
})();