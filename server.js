require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const { DB, saveDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET ausente no .env');
  process.exit(1);
}

/* =========================
   🔥 RENDER FIX
========================= */
app.set('trust proxy', 1);

/* =========================
   MIDDLEWARES
========================= */
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

/* =========================
   RATE LIMIT (sem opção inválida)
========================= */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

/* =========================
   GARANTIR ESTRUTURA DO DB
========================= */
DB.scripts = DB.scripts || [];
DB.keys = DB.keys || [];
DB.logs = DB.logs || [];
DB.admins = DB.admins || [];

/* =========================
   LOG SIMPLES
========================= */
function log(action, meta, req) {
  DB.logs.push({
    action,
    meta: String(meta),
    ip: req?.ip || 'unknown',
    time: new Date().toISOString()
  });
  DB.logs = DB.logs.slice(-1000);
  saveDb();
}

/* =========================
   AUTH MIDDLEWARE
========================= */
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

/* =========================
   LOGIN
========================= */
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const admin = DB.admins.find(a => a.username === username);
  if (!admin) return res.status(401).json({ error: 'Credenciais inválidas' });

  if (!bcrypt.compareSync(password, admin.password_hash)) {
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
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000
  });

  log('LOGIN_SUCCESS', username, req);
  res.json({ success: true });
});

/* =========================
   LOGOUT
========================= */
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  res.json({ success: true });
});

/* =========================
   ME
========================= */
app.get('/api/auth/me', auth, (req, res) => {
  res.json(req.user);
});

/* =========================
   SCRIPTS (CRUD SIMPLES)
========================= */
app.get('/api/scripts', auth, (req, res) => {
  res.json(DB.scripts);
});

app.post('/api/scripts', auth, (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'Nome e conteúdo obrigatórios' });

  const script = {
    id: uuidv4(),
    name,
    content,
    status: 'online',
    executions: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  DB.scripts.push(script);
  saveDb();
  log('SCRIPT_CREATED', name, req);
  res.status(201).json(script);
});

app.put('/api/scripts/:id', auth, (req, res) => {
  const script = DB.scripts.find(s => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: 'Script não encontrado' });

  const { name, content, status } = req.body;
  if (name !== undefined) script.name = name;
  if (content !== undefined) script.content = content;
  if (status !== undefined) script.status = status;
  script.updated_at = new Date().toISOString();
  saveDb();
  res.json(script);
});

app.delete('/api/scripts/:id', auth, (req, res) => {
  const index = DB.scripts.findIndex(s => s.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Script não encontrado' });
  DB.scripts.splice(index, 1);
  // Remove keys vinculadas (opcional)
  DB.keys = DB.keys.filter(k => k.script_id !== req.params.id);
  saveDb();
  res.json({ success: true });
});

/* =========================
   KEYS (CRUD SIMPLES)
========================= */
app.get('/api/keys', auth, (req, res) => {
  // Popula nome do script para exibição
  const keysWithScript = DB.keys.map(k => {
    const script = DB.scripts.find(s => s.id === k.script_id);
    return { ...k, script_name: script ? script.name : '—' };
  });
  res.json(keysWithScript);
});

app.post('/api/keys', auth, (req, res) => {
  const { scriptId, hwid, expiresAt } = req.body;
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
  log('KEY_CREATED', key, req);
  res.status(201).json(newKey);
});

app.delete('/api/keys/:id', auth, (req, res) => {
  const index = DB.keys.findIndex(k => k.id == req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Key não encontrada' });
  DB.keys.splice(index, 1);
  saveDb();
  res.json({ success: true });
});

/* =========================
   LOADER (COM VALIDAÇÃO DE KEY)
========================= */
app.get('/api/load/:scriptId', (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(403).send('Acesso negado – key ausente');

  const keyData = DB.keys.find(k => k.key === key && k.status === 'active');
  if (!keyData) return res.status(403).send('Acesso negado – key inválida');

  if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
    keyData.status = 'expired';
    saveDb();
    return res.status(403).send('Acesso negado – key expirada');
  }

  if (keyData.hwid) {
    const hwid = req.query.hwid;
    if (!hwid || hwid !== keyData.hwid) {
      return res.status(403).send('Acesso negado – HWID inválido');
    }
  }

  const script = DB.scripts.find(s => s.id === req.params.scriptId && s.status === 'online');
  if (!script) return res.status(404).send('Script não encontrado');

  script.executions = (script.executions || 0) + 1;
  keyData.last_used = new Date().toISOString();
  saveDb();

  log('SCRIPT_EXEC', script.name, req);
  res.type('text/plain').send(script.content);
});

/* =========================
   PÁGINAS
========================= */
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/login.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/dashboard.html')));

/* =========================
   ADMIN INICIAL
========================= */
const ADMIN_USER = process.env.ADMIN_USER || 'nanagui';
const ADMIN_PASS = process.env.ADMIN_PASS || '001010GGZEHEN';

if (!DB.admins.find(a => a.username === ADMIN_USER)) {
  const hash = bcrypt.hashSync(ADMIN_PASS, 10);
  DB.admins.push({ id: Date.now(), username: ADMIN_USER, password_hash: hash, role: 'master' });
  saveDb();
  console.log(`✅ Admin criado: ${ADMIN_USER}`);
}

/* =========================
   START
========================= */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🪐 Saturn Storage rodando na porta ${PORT}`);
});