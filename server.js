require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const { DB, saveDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || 'segredo_super_seguro';
const ADMIN_USER = process.env.ADMIN_USER || 'nanagui';
const ADMIN_PASS = process.env.ADMIN_PASS || '001010GGZEHEN';

app.disable('x-powered-by');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({ windowMs: 60 * 1000, max: 200 });
app.use('/api/', limiter);

DB.scripts = DB.scripts || [];
DB.admins = DB.admins || [];

// ------------------- HELPERS -------------------
function shortId() { return crypto.randomBytes(8).toString('hex'); }
function secureToken() { return crypto.randomBytes(16).toString('hex'); }

function auth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Token ausente' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('token');
    res.status(401).json({ error: 'Sessão expirada' });
  }
}

// ------------------- AUTENTICAÇÃO -------------------
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const admin = DB.admins.find(a => a.username.toLowerCase() === username.toLowerCase());
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.redirect('/painel?error=1');
  }
  const token = jwt.sign({ id: admin.id, username, role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
  res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  return res.redirect('/painel/dashboard');
});

app.get('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/painel');
});

app.get('/api/auth/me', auth, (req, res) => res.json({ username: req.user.username }));

// ------------------- SCRIPTS CRUD -------------------
app.get('/api/scripts', auth, (req, res) => res.json(DB.scripts));

app.post('/api/scripts', auth, (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'Nome e conteúdo obrigatórios' });
  const s = {
    id: uuidv4(), name: name.trim(), content,
    status: 'online', executions: 0,
    short_id: shortId(), token: secureToken(),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  };
  DB.scripts.push(s);
  saveDb();
  res.status(201).json(s);
});

app.put('/api/scripts/:id', auth, (req, res) => {
  const s = DB.scripts.find(s => s.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Script não encontrado' });
  const { name, content, status } = req.body;
  if (name !== undefined) s.name = name.trim();
  if (content !== undefined) s.content = content;
  if (status !== undefined) s.status = status;
  s.updated_at = new Date().toISOString();
  saveDb();
  res.json(s);
});

app.delete('/api/scripts/:id', auth, (req, res) => {
  const idx = DB.scripts.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Script não encontrado' });
  DB.scripts.splice(idx, 1);
  saveDb();
  res.json({ success: true });
});

// ------------------- ESTATÍSTICAS -------------------
app.get('/api/stats', auth, (req, res) => {
  const total = DB.scripts.length;
  const online = DB.scripts.filter(s => s.status === 'online').length;
  const exec = DB.scripts.reduce((a, s) => a + (s.executions || 0), 0);
  res.json({ totalScripts: total, onlineScripts: online, offlineScripts: total - online, totalExecutions: exec });
});

// ------------------- LOADER PROTEGIDO (COM BLOQUEIO) -------------------
app.get('/api/load/:shortId/:token', (req, res) => {
  const ua = (req.get('User-Agent') || '').toLowerCase();
  // Permite apenas User-Agents que contenham "roblox" (ou vazio para compatibilidade)
  if (ua && !ua.includes('roblox')) {
    return res.status(403).sendFile(path.join(__dirname, 'public', 'blocked.html'));
  }

  const s = DB.scripts.find(s => s.short_id === req.params.shortId);
  if (!s || s.status !== 'online' || s.token !== req.params.token) {
    return res.status(404).send('Script indisponível.');
  }
  s.executions = (s.executions || 0) + 1;
  saveDb();
  res.type('text/plain').send(s.content);
});

// ------------------- PÁGINAS -------------------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/painel', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/login.html')));
app.get('/painel/dashboard', auth, (req, res) => res.sendFile(path.join(__dirname, 'public/admin/dashboard.html')));

// ------------------- ADMIN INICIAL -------------------
if (!DB.admins.find(a => a.username === ADMIN_USER)) {
  DB.admins.push({ id: uuidv4(), username: ADMIN_USER, password_hash: bcrypt.hashSync(ADMIN_PASS, 10), role: 'master' });
  saveDb();
  console.log(`✅ Admin criado: ${ADMIN_USER}`);
}

app.listen(PORT, '0.0.0.0', () => console.log(`🪐 Astro rodando na porta ${PORT}`));