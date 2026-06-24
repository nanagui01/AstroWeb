require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// "Banco" em memória (objeto simples)
const DB = {
  admins: [],
  scripts: []
};

// Criar admin hardcoded ao iniciar
const ADMIN_USER = process.env.ADMIN_USER || 'nanagui';
const ADMIN_PASS = process.env.ADMIN_PASS || '001010GGZEHEN';
const adminHash = bcrypt.hashSync(ADMIN_PASS, 10);
DB.admins.push({ id: 1, username: ADMIN_USER, password_hash: adminHash });
console.log(`✅ Admin pronto: ${ADMIN_USER}`);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware para injetar DB falso
app.use((req, res, next) => {
  req.DB = DB;
  next();
});

// === Rotas de Autenticação ===
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Preencha todos os campos' });

  const admin = DB.admins.find(a => a.username === username);
  if (!admin) return res.status(401).json({ error: 'Credenciais inválidas' });

  const valid = bcrypt.compareSync(password, admin.password_hash);
  if (!valid) return res.status(401).json({ error: 'Credenciais inválidas' });

  const token = jwt.sign({ id: admin.id, username: admin.username }, process.env.JWT_SECRET || 'secret', { expiresIn: '8h' });

  res.cookie('token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
  });

  res.json({ success: true });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    res.json({ username: decoded.username });
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
});

// === Rotas de Scripts ===
function authMiddleware(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Acesso negado' });
  try {
    jwt.verify(token, process.env.JWT_SECRET || 'secret');
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

app.get('/api/scripts', authMiddleware, (req, res) => {
  const scripts = DB.scripts.map(s => ({ id: s.id, name: s.name, status: s.status, updated_at: s.updated_at }));
  res.json(scripts);
});

app.get('/api/scripts/:id', authMiddleware, (req, res) => {
  const script = DB.scripts.find(s => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: 'Script não encontrado' });
  res.json(script);
});

app.post('/api/scripts', authMiddleware, (req, res) => {
  const { name, content, status } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'Nome e conteúdo obrigatórios' });
  const newScript = {
    id: uuidv4(),
    name,
    content,
    status: status || 'online',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  DB.scripts.push(newScript);
  res.status(201).json(newScript);
});

app.put('/api/scripts/:id', authMiddleware, (req, res) => {
  const script = DB.scripts.find(s => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: 'Script não encontrado' });
  const { name, content, status } = req.body;
  if (name) script.name = name;
  if (content) script.content = content;
  if (status) script.status = status;
  script.updated_at = new Date().toISOString();
  res.json(script);
});

app.delete('/api/scripts/:id', authMiddleware, (req, res) => {
  const index = DB.scripts.findIndex(s => s.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Script não encontrado' });
  DB.scripts.splice(index, 1);
  res.json({ success: true });
});

// === Rota de Loader (protegida) ===
app.get('/api/load/:id', (req, res) => {
  const secret = req.headers['x-saturn-key'];
  if (secret !== 'saturn_loader_secret_2024') {
    return res.status(403).sendFile(path.join(__dirname, 'public', 'blocked.html'));
  }
  const script = DB.scripts.find(s => s.id === req.params.id && s.status === 'online');
  if (!script) return res.status(404).sendFile(path.join(__dirname, 'public', 'blocked.html'));
  res.type('text/plain').send(script.content);
});

// === Páginas ===
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html')));

// Rota de reset (não mais necessária, mas mantida)
app.get('/api/reset-admin', (req, res) => {
  res.json({ success: true, username: ADMIN_USER, password: ADMIN_PASS });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🪐 Saturn Storage rodando em http://0.0.0.0:${PORT}`);
});