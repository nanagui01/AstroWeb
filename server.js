require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const { DB, saveDb } = require('./database');

// -------------------------------------------------------
// VALIDAÇÃO DE AMBIENTE
// -------------------------------------------------------
if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET não definido no .env');
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;
const RESET_SECRET = process.env.RESET_SECRET || 'reset_admin_secret_2024';

const app = express();
const PORT = process.env.PORT || 3000;

// 🔥 Confia no proxy do Render (remove o warning do rate-limit)
app.set('trust proxy', 1);

// -------------------------------------------------------
// MIDDLEWARES
// -------------------------------------------------------
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------
// RATE LIMITING
// -------------------------------------------------------
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100,
  message: { error: 'Muitas requisições, tente novamente mais tarde' }
});
app.use('/api/', globalLimiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Muitas tentativas de login, tente novamente em 15 minutos' }
});

const loaderLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 30,
  message: 'Rate limit exceeded'
});

// -------------------------------------------------------
// FUNÇÕES DE SEGURANÇA
// -------------------------------------------------------
function securityLog(action, details, ip = 'unknown') {
  const entry = {
    id: Date.now(),
    action,
    details,
    ip,
    created_at: new Date().toISOString()
  };
  DB.securityLogs.push(entry);
  if (DB.securityLogs.length > 1000) DB.securityLogs.shift(); // mantém apenas os últimos 1000
  saveDb();
  console.log(`[SECURITY] ${action}: ${details} (IP: ${ip})`);
}

// Schemas de validação
const scriptCreateSchema = z.object({
  name: z.string().min(1).max(100),
  content: z.string().min(1).max(50000),
  status: z.enum(['online', 'offline', 'maintenance', 'development']).optional().default('online'),
  tags: z.array(z.string().max(30)).max(10).optional().default([])
});

const keyCreateSchema = z.object({
  scriptId: z.string().optional(),
  hwid: z.string().max(100).optional().default(''),
  expiresAt: z.string().datetime().optional()
});

// -------------------------------------------------------
// AUTENTICAÇÃO
// -------------------------------------------------------
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    securityLog('LOGIN_FAILED', 'Campos vazios', req.ip);
    return res.status(400).json({ error: 'Preencha todos os campos' });
  }

  const admin = DB.admins.find(a => a.username === username);
  if (!admin) {
    securityLog('LOGIN_FAILED', `Usuário inexistente: ${username}`, req.ip);
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  if (!admin.password_hash || !bcrypt.compareSync(password, admin.password_hash)) {
    securityLog('LOGIN_FAILED', `Senha incorreta para: ${username}`, req.ip);
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  const token = jwt.sign(
    { id: admin.id, username: admin.username, role: admin.role || 'admin' },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.cookie('token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000
  });

  securityLog('LOGIN_SUCCESS', `Usuário: ${username}`, req.ip);
  return res.json({ success: true, role: admin.role });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
  return res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return res.json({ username: decoded.username, role: decoded.role });
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
});

function authMiddleware(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Acesso negado' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// -------------------------------------------------------
// ROTA DE EMERGÊNCIA PROTEGIDA
// -------------------------------------------------------
app.get('/api/reset-admin', (req, res) => {
  const { secret } = req.query;
  if (secret !== RESET_SECRET) {
    securityLog('RESET_ADMIN_FAILED', 'Tentativa com secret incorreto', req.ip);
    return res.status(403).json({ error: 'Acesso negado' });
  }

  const user = process.env.ADMIN_USER || 'nanagui';
  const pass = process.env.ADMIN_PASS || '001010GGZEHEN';
  const hash = bcrypt.hashSync(pass, 10);

  DB.admins = DB.admins.filter(a => a.username !== user);
  DB.admins.push({ id: Date.now(), username: user, password_hash: hash, role: 'master' });
  saveDb();
  securityLog('RESET_ADMIN', `Admin ${user} resetado`, req.ip);

  return res.json({ success: true, username: user, password: pass });
});

// -------------------------------------------------------
// SCRIPTS (CRUD com validação)
// -------------------------------------------------------
app.get('/api/scripts', authMiddleware, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 25;
  const start = (page - 1) * limit;
  const end = start + limit;

  const scripts = DB.scripts
    .map(s => ({
      id: s.id,
      name: s.name,
      status: s.status,
      tags: s.tags || [],
      executions: s.executions || 0,
      updated_at: s.updated_at
    }))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  const paginated = scripts.slice(start, end);
  return res.json({
    data: paginated,
    page,
    totalPages: Math.ceil(scripts.length / limit),
    total: scripts.length
  });
});

app.get('/api/scripts/:id', authMiddleware, (req, res) => {
  const script = DB.scripts.find(s => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: 'Script não encontrado' });
  return res.json(script);
});

app.post('/api/scripts', authMiddleware, (req, res) => {
  const validation = scriptCreateSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: 'Dados inválidos', details: validation.error.issues });
  }

  const { name, content, status, tags } = validation.data;
  const newScript = {
    id: uuidv4(),
    name,
    content,
    status,
    tags,
    executions: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  DB.scripts.push(newScript);
  saveDb();
  securityLog('SCRIPT_CREATED', `Script: ${name}`, req.ip);
  return res.status(201).json(newScript);
});

app.put('/api/scripts/:id', authMiddleware, (req, res) => {
  const script = DB.scripts.find(s => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: 'Script não encontrado' });

  // Salva versão anterior no histórico
  DB.versions.push({
    id: uuidv4(),
    script_id: script.id,
    name: script.name,
    content: script.content,
    status: script.status,
    tags: script.tags,
    created_at: new Date().toISOString()
  });

  const { name, content, status, tags } = req.body;
  if (name !== undefined) script.name = name;
  if (content !== undefined) script.content = content;
  if (status !== undefined) script.status = status;
  if (tags !== undefined) script.tags = tags;
  script.updated_at = new Date().toISOString();
  saveDb();
  return res.json(script);
});

app.delete('/api/scripts/:id', authMiddleware, (req, res) => {
  DB.scripts = DB.scripts.filter(s => s.id !== req.params.id);
  DB.versions = DB.versions.filter(v => v.script_id !== req.params.id);
  DB.keys = DB.keys.filter(k => k.script_id !== req.params.id);
  saveDb();
  return res.json({ success: true });
});

app.post('/api/scripts/:id/duplicate', authMiddleware, (req, res) => {
  const original = DB.scripts.find(s => s.id === req.params.id);
  if (!original) return res.status(404).json({ error: 'Script não encontrado' });
  const newScript = {
    ...original,
    id: uuidv4(),
    name: original.name + ' (Cópia)',
    executions: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  DB.scripts.push(newScript);
  saveDb();
  return res.status(201).json(newScript);
});

app.get('/api/scripts/:id/versions', authMiddleware, (req, res) => {
  const versions = DB.versions
    .filter(v => v.script_id === req.params.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return res.json(versions);
});

// -------------------------------------------------------
// KEYS (CRUD)
// -------------------------------------------------------
app.get('/api/keys', authMiddleware, (req, res) => {
  const keys = DB.keys.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return res.json(keys);
});

app.post('/api/keys', authMiddleware, (req, res) => {
  const validation = keyCreateSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: 'Dados inválidos', details: validation.error.issues });
  }

  const { scriptId, hwid, expiresAt } = validation.data;
  const key = 'SATURN-' + uuidv4().slice(0, 16).toUpperCase();
  const newKey = {
    id: Date.now(),
    key,
    script_id: scriptId || null,
    hwid: hwid || '',
    expires_at: expiresAt || null,
    status: 'active',
    last_used: null,
    created_at: new Date().toISOString()
  };
  DB.keys.push(newKey);
  saveDb();
  securityLog('KEY_CREATED', `Key: ${key}`, req.ip);
  return res.status(201).json(newKey);
});

app.put('/api/keys/:id', authMiddleware, (req, res) => {
  const key = DB.keys.find(k => k.id == req.params.id);
  if (!key) return res.status(404).json({ error: 'Key não encontrada' });

  const { hwid, expiresAt, status } = req.body;
  if (hwid !== undefined) key.hwid = hwid;
  if (expiresAt !== undefined) key.expires_at = expiresAt;
  if (status !== undefined) key.status = status;
  saveDb();
  return res.json({ success: true });
});

app.delete('/api/keys/:id', authMiddleware, (req, res) => {
  DB.keys = DB.keys.filter(k => k.id != req.params.id);
  saveDb();
  return res.json({ success: true });
});

// -------------------------------------------------------
// LOADER COM VALIDAÇÃO DE KEY DO USUÁRIO
// -------------------------------------------------------
app.get('/api/load/:scriptId', loaderLimiter, (req, res) => {
  const key = req.query.key;
  if (!key) {
    securityLog('LOADER_NO_KEY', `Script: ${req.params.scriptId}`, req.ip);
    return res.status(403).sendFile(path.join(__dirname, 'public', 'blocked.html'));
  }

  const keyData = DB.keys.find(k => k.key === key);
  if (!keyData || keyData.status !== 'active') {
    securityLog('LOADER_INVALID_KEY', `Key: ${key}`, req.ip);
    return res.status(403).sendFile(path.join(__dirname, 'public', 'blocked.html'));
  }

  if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
    keyData.status = 'expired';
    saveDb();
    securityLog('LOADER_EXPIRED_KEY', `Key: ${key}`, req.ip);
    return res.status(403).sendFile(path.join(__dirname, 'public', 'blocked.html'));
  }

  if (keyData.hwid) {
    const hwid = req.query.hwid;
    if (!hwid || hwid !== keyData.hwid) {
      securityLog('LOADER_HWID_MISMATCH', `Key: ${key}`, req.ip);
      return res.status(403).sendFile(path.join(__dirname, 'public', 'blocked.html'));
    }
  }

  const script = DB.scripts.find(s => s.id === req.params.scriptId && s.status === 'online');
  if (!script) {
    securityLog('LOADER_SCRIPT_NOT_FOUND', `Script: ${req.params.scriptId}`, req.ip);
    return res.status(404).sendFile(path.join(__dirname, 'public', 'blocked.html'));
  }

  script.executions = (script.executions || 0) + 1;
  keyData.last_used = new Date().toISOString();
  saveDb();

  res.type('text/plain');
  return res.send(script.content);
});

// -------------------------------------------------------
// PÁGINAS ESTÁTICAS
// -------------------------------------------------------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html')));

// -------------------------------------------------------
// INICIALIZAÇÃO
// -------------------------------------------------------
const user = process.env.ADMIN_USER || 'nanagui';
const pass = process.env.ADMIN_PASS || '001010GGZEHEN';

if (!DB.admins.find(a => a.username === user)) {
  const hash = bcrypt.hashSync(pass, 10);
  DB.admins.push({ id: Date.now(), username: user, password_hash: hash, role: 'master' });
  saveDb();
  console.log(`✅ Admin criado: ${user}`);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🪐 Saturn Storage rodando em http://0.0.0.0:${PORT}`);
});