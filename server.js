require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { DB, saveDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'saturn_secret_2024';

// --- SEGURANÇA BÁSICA ---
app.set('trust proxy', 1);
app.use(helmet()); // Protege headers HTTP
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- LIMITADORES DE TAXA (Rate Limit) ---
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // Limita cada IP a 5 tentativas de login por janela
  message: { error: 'Muitas tentativas de login. Tente novamente mais tarde.' }
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 100, // 100 requests por minuto na API
  message: { error: 'Calma aí! Você está fazendo muitas requisições.' }
});

// Garantir estrutura do DB
DB.scripts = DB.scripts || [];
DB.admins = DB.admins || [];

// --------------------- AUTENTICAÇÃO ---------------------
function auth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Acesso negado. Faça login.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('token'); // Limpa cookie inválido
    res.status(401).json({ error: 'Sessão expirada ou inválida.' });
  }
}

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Preencha todos os campos.' });

  const admin = DB.admins.find(a => a.username === username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  const token = jwt.sign({ id: admin.id, username }, JWT_SECRET, { expiresIn: '8h' });
  res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
  res.json({ success: true });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
  res.json({ success: true });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ username: req.user.username }));

// --------------------- SCRIPTS (Protegido com API Limiter) ---------------------
app.use('/api/scripts', apiLimiter);

app.get('/api/scripts', auth, (req, res) => res.json(DB.scripts));

app.post('/api/scripts', auth, (req, res) => {
  const { name, content, status } = req.body;
  // Validação contra inputs vazios
  if (!name || typeof name !== 'string' || name.trim() === '') return res.status(400).json({ error: 'Nome inválido.' });
  if (!content || typeof content !== 'string') return res.status(400).json({ error: 'Conteúdo inválido.' });

  const script = {
    id: uuidv4(),
    name: name.trim(),
    content,
    status: status === 'offline' ? 'offline' : 'online', // Evita status inventados
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
  if (name && typeof name === 'string') script.name = name.trim();
  if (content && typeof content === 'string') script.content = content;
  if (status && ['online', 'offline'].includes(status)) script.status = status;
  
  saveDb();
  res.json(script);
});

app.delete('/api/scripts/:id', auth, (req, res) => {
  const initialLength = DB.scripts.length;
  DB.scripts = DB.scripts.filter(s => s.id !== req.params.id);
  
  if (DB.scripts.length === initialLength) return res.status(404).json({ error: 'Script não encontrado.' });
  
  saveDb();
  res.json({ success: true });
});

// --------------------- BACKUP ---------------------
app.get('/api/export', auth, (req, res) => {
  res.json({ scripts: DB.scripts });
});

app.post('/api/import', auth, (req, res) => {
  if (!req.body.scripts || !Array.isArray(req.body.scripts)) {
    return res.status(400).json({ error: 'Formato de arquivo inválido' });
  }
  
  // Validação rigorosa dos dados importados para evitar injeção
  const validScripts = req.body.scripts.filter(s => 
    s.id && typeof s.name === 'string' && typeof s.content === 'string'
  ).map(s => ({
    id: s.id,
    name: s.name.trim(),
    content: s.content,
    status: s.status === 'offline' ? 'offline' : 'online',
    executions: typeof s.executions === 'number' ? s.executions : 0,
    created_at: s.created_at || new Date().toISOString()
  }));

  DB.scripts = validScripts;
  saveDb();
  res.json({ success: true, imported: validScripts.length });
});

// --------------------- LOADER ---------------------
app.get('/api/load/:id', apiLimiter, (req, res) => {
  const script = DB.scripts.find(s => s.id === req.params.id && s.status === 'online');
  if (!script) return res.status(404).send('-- Script offline ou inexistente'); // Melhor não revelar o motivo exato
  
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

app.listen(PORT, '0.0.0.0', () => console.log(`🪐 Saturn rodando na porta ${PORT}`));
