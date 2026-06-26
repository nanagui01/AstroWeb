require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { DB, saveDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || 'saturn_secret_2024';

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Garantir estrutura
DB.scripts = DB.scripts || [];
DB.admins = DB.admins || [];

// --------------------- AUTENTICAÇÃO ---------------------
function auth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Token ausente' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const admin = DB.admins.find(a => a.username === username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash))
    return res.status(401).json({ error: 'Credenciais inválidas' });

  const token = jwt.sign({ id: admin.id, username }, JWT_SECRET, { expiresIn: '8h' });
  res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  res.json({ success: true });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  res.json({ success: true });
});

app.get('/api/auth/me', auth, (req, res) => res.json(req.user));

// --------------------- SCRIPTS ---------------------
app.get('/api/scripts', auth, (req, res) => res.json(DB.scripts));

app.post('/api/scripts', auth, (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'Nome e conteúdo obrigatórios' });

  const script = {
    id: uuidv4(),
    name,
    content,
    status: 'online',
    executions: 0,
    created_at: new Date().toISOString()
  };
  DB.scripts.push(script);
  saveDb();
  res.status(201).json(script);
});

app.put('/api/scripts/:id', auth, (req, res) => {
  const script = DB.scripts.find(s => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: 'Script não encontrado' });
  const { name, content, status } = req.body;
  if (name !== undefined) script.name = name;
  if (content !== undefined) script.content = content;
  if (status !== undefined) script.status = status;
  saveDb();
  res.json(script);
});

app.delete('/api/scripts/:id', auth, (req, res) => {
  DB.scripts = DB.scripts.filter(s => s.id !== req.params.id);
  saveDb();
  res.json({ success: true });
});

// --------------------- BACKUP ---------------------
app.get('/api/export', auth, (req, res) => {
  res.json({ scripts: DB.scripts });
});

app.post('/api/import', auth, (req, res) => {
  if (!req.body.scripts || !Array.isArray(req.body.scripts))
    return res.status(400).json({ error: 'Formato inválido' });
  DB.scripts = req.body.scripts;
  saveDb();
  res.json({ success: true });
});

// --------------------- LOADER (sem key) ---------------------
app.get('/api/load/:id', (req, res) => {
  const script = DB.scripts.find(s => s.id === req.params.id && s.status === 'online');
  if (!script) return res.status(404).send('Script não encontrado');
  script.executions = (script.executions || 0) + 1;
  saveDb();
  res.type('text/plain').send(script.content);
});

// --------------------- PÁGINAS ---------------------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/login.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/dashboard.html')));

// --------------------- ADMIN INICIAL ---------------------
const ADMIN_USER = process.env.ADMIN_USER || 'nanagui';
const ADMIN_PASS = process.env.ADMIN_PASS || '001010GGZEHEN';
if (!DB.admins.find(a => a.username === ADMIN_USER)) {
  DB.admins.push({ id: 1, username: ADMIN_USER, password_hash: bcrypt.hashSync(ADMIN_PASS, 10) });
  saveDb();
  console.log(`✅ Admin criado: ${ADMIN_USER}`);
}

app.listen(PORT, '0.0.0.0', () => console.log(`🪐 Rodando na porta ${PORT}`));