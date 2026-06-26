require('dotenv').config();

// ============================================================
// VALIDAÇÃO OBRIGATÓRIA DE AMBIENTE (SEM VALORES PADRÃO)
// ============================================================
if (!process.env.JWT_SECRET) {
  console.error('❌ ERRO FATAL: JWT_SECRET não definido no arquivo .env');
  process.exit(1);
}
if (!process.env.ADMIN_ROUTE_SECRET) {
  console.error('❌ ERRO FATAL: ADMIN_ROUTE_SECRET não definido no arquivo .env');
  process.exit(1);
}
if (!process.env.ADMIN_PASS) {
  console.error('❌ ERRO FATAL: ADMIN_PASS não definido no arquivo .env');
  process.exit(1);
}
if (!process.env.ADMIN_USER) {
  console.error('❌ ERRO FATAL: ADMIN_USER não definido no arquivo .env');
  process.exit(1);
}

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { DB, saveDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

/* ============================================================
   CONFIGURAÇÕES (TODAS OBRIGATÓRIAS)
   ============================================================ */
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_ROUTE_SECRET = process.env.ADMIN_ROUTE_SECRET;
const DYNAMIC_ADMIN_PATH = '/' + crypto.createHash('sha256').update(ADMIN_ROUTE_SECRET).digest('hex');
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';

// Só mostra a rota admin em ambiente de desenvolvimento
if (process.env.NODE_ENV !== 'production') {
  console.log(`\n[DEV] URL administrativa: http://localhost:${PORT}${DYNAMIC_ADMIN_PATH}\n`);
}

/* ============================================================
   CONTENT SECURITY POLICY (ATIVADO)
   ============================================================ */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

/* ============================================================
   MIDDLEWARE DE VALIDAÇÃO DE ENTRADA (ANTI-XSS)
   ============================================================ */
function sanitizeInput(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// Middleware global para sanitizar campos de texto
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    for (const key in req.body) {
      if (key === 'name' || key === 'title' || key === 'description') {
        req.body[key] = sanitizeInput(req.body[key]);
      }
    }
  }
  next();
});

/* ============================================================
   SEGURANÇA BÁSICA
   ============================================================ */
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

/* ============================================================
   RATE LIMIT (AGRESSIVO)
   ============================================================ */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: { error: 'Muitas tentativas. Conta bloqueada por 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 250,
  message: { error: 'Muitas requisições.' }
});

const loaderLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 150,
  message: 'Rate limit exceeded.'
});

/* ============================================================
   PROTEÇÃO CSRF (TOKEN POR SESSÃO)
   ============================================================ */
function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

app.get('/api/csrf-token', (req, res) => {
  const token = generateCsrfToken();
  res.cookie('csrf_token', token, {
    httpOnly: false,
    secure: true,
    sameSite: 'strict', // ← STRICT
    path: '/',
    maxAge: 8 * 60 * 60 * 1000
  });
  res.json({ csrfToken: token });
});

function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const cookieToken = req.cookies['csrf_token'];
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'Token CSRF inválido.' });
  }
  next();
}

app.use('/api/', csrfProtection);

/* ============================================================
   BLACKLIST DE TOKENS (INVALIDAÇÃO APÓS LOGOUT)
   ============================================================ */
DB.tokenBlacklist = DB.tokenBlacklist || [];

function isTokenBlacklisted(token) {
  // Remove tokens expirados da blacklist (limpeza automática)
  DB.tokenBlacklist = DB.tokenBlacklist.filter(t => {
    try {
      jwt.verify(t.token, JWT_SECRET);
      return false; // ainda é válido, mas está na blacklist
    } catch (e) {
      return false; // expirado, remove da blacklist
    }
  });
  return DB.tokenBlacklist.some(t => t.token === token);
}

function blacklistToken(token) {
  DB.tokenBlacklist.push({ token, blacklistedAt: Date.now() });
  // Mantém apenas os últimos 100 tokens
  if (DB.tokenBlacklist.length > 100) DB.tokenBlacklist = DB.tokenBlacklist.slice(-100);
  saveDb();
}

/* ============================================================
   BANCO DE DADOS
   ============================================================ */
DB.scripts = DB.scripts || [];
DB.admins = DB.admins || [];
DB.versions = DB.versions || [];

// Garante campos de segurança nos admins
DB.admins.forEach(a => {
  a.twofa_secret = a.twofa_secret || null;
  a.twofa_enabled = a.twofa_enabled || false;
  a.failedAttempts = a.failedAttempts || 0;
  a.lockUntil = a.lockUntil || null;
});

/* ============================================================
   FUNÇÕES AUXILIARES
   ============================================================ */
function generateShortId() {
  return crypto.randomBytes(8).toString('hex'); // 16 caracteres (antes 8)
}

function sendChangelogWebhook({ title, description, banner, thumbnail, scriptName }) {
  if (!DISCORD_WEBHOOK_URL) return;
  const embed = {
    title: title || `${scriptName} foi atualizado!`,
    description: description || 'Veja as novidades abaixo.',
    color: 0x6366f1,
    timestamp: new Date().toISOString(),
    footer: { text: 'Astro Storage' }
  };
  if (banner) embed.image = { url: banner };
  if (thumbnail) embed.thumbnail = { url: thumbnail };
  axios.post(DISCORD_WEBHOOK_URL, { embeds: [embed] }, { timeout: 5000 }).catch(e => console.error('[DISCORD]', e.message));
}

function authMiddleware(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Token ausente' });

  // Verifica se o token está na blacklist
  if (isTokenBlacklisted(token)) {
    res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
    return res.status(401).json({ error: 'Token inválido (logout anterior).' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
    res.status(401).json({ error: 'Sessão expirada' });
  }
}

function masterOnly(req, res, next) {
  if (req.user?.role !== 'master') {
    return res.status(403).json({ error: 'Apenas o master pode executar esta ação.' });
  }
  next();
}

/* ============================================================
   AUTENTICAÇÃO (COM LOGIN LOCK)
   ============================================================ */
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const admin = DB.admins.find(a => a.username === username);

  if (!admin) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  // Verifica se a conta está bloqueada
  if (admin.lockUntil && admin.lockUntil > Date.now()) {
    const minutesLeft = Math.ceil((admin.lockUntil - Date.now()) / 60000);
    return res.status(423).json({
      error: `Conta bloqueada. Tente novamente em ${minutesLeft} minuto(s).`,
      locked: true
    });
  }

  if (!bcrypt.compareSync(password, admin.password_hash)) {
    // Incrementa tentativas falhas
    admin.failedAttempts = (admin.failedAttempts || 0) + 1;
    if (admin.failedAttempts >= 5) {
      admin.lockUntil = Date.now() + 15 * 60 * 1000; // 15 minutos
      admin.failedAttempts = 0;
      saveDb();
      return res.status(423).json({
        error: 'Conta bloqueada por 15 minutos devido a múltiplas tentativas.',
        locked: true
      });
    }
    saveDb();
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  // Login bem-sucedido: reseta tentativas
  admin.failedAttempts = 0;
  admin.lockUntil = null;
  saveDb();

  // Se 2FA estiver ativo, gera token temporário
  if (admin.twofa_enabled) {
    const tempToken = jwt.sign(
      { id: admin.id, username, require2FA: true },
      JWT_SECRET,
      { expiresIn: '5m' }
    );
    return res.json({ require2FA: true, tempToken });
  }

  const token = jwt.sign(
    { id: admin.id, username, role: admin.role || 'admin' },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
  res.cookie('token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict', // ← STRICT
    path: '/',
    maxAge: 8 * 60 * 60 * 1000
  });
  res.json({ success: true, redirectPath: `${DYNAMIC_ADMIN_PATH}/dashboard` });
});

app.post('/api/auth/verify-2fa', (req, res) => {
  const { tempToken, code } = req.body;
  let payload;
  try {
    payload = jwt.verify(tempToken, JWT_SECRET);
    if (!payload.require2FA) throw new Error();
  } catch {
    return res.status(401).json({ error: 'Token temporário inválido.' });
  }

  const admin = DB.admins.find(a => a.id === payload.id);
  if (!admin || !admin.twofa_secret) {
    return res.status(400).json({ error: '2FA não configurado.' });
  }

  const verified = speakeasy.totp.verify({
    secret: admin.twofa_secret,
    encoding: 'base32',
    token: code,
    window: 1
  });
  if (!verified) return res.status(401).json({ error: 'Código 2FA inválido.' });

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
  res.json({ success: true, redirectPath: `${DYNAMIC_ADMIN_PATH}/dashboard` });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies?.token;
  if (token) {
    blacklistToken(token); // Invalida o token
  }
  res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
  res.clearCookie('csrf_token', { secure: true, sameSite: 'strict', path: '/' });
  res.json({ success: true, redirectPath: DYNAMIC_ADMIN_PATH });
});

app.get('/api/auth/me', authMiddleware, (req, res) => res.json({
  username: req.user.username,
  role: req.user.role || 'admin',
  twofa_enabled: DB.admins.find(a => a.id === req.user.id)?.twofa_enabled || false
}));

// 2FA Setup
app.get('/api/auth/2fa/setup', authMiddleware, (req, res) => {
  const admin = DB.admins.find(a => a.id === req.user.id);
  if (!admin) return res.status(404).json({ error: 'Admin não encontrado.' });
  const secret = speakeasy.generateSecret({ name: `Astro:${admin.username}` });
  admin.twofa_secret = secret.base32;
  admin.twofa_enabled = false;
  saveDb();
  QRCode.toDataURL(secret.otpauth_url, (err, dataUrl) => {
    if (err) return res.status(500).json({ error: 'Erro ao gerar QR code.' });
    res.json({ secret: secret.base32, qrCode: dataUrl });
  });
});

app.post('/api/auth/2fa/enable', authMiddleware, (req, res) => {
  const admin = DB.admins.find(a => a.id === req.user.id);
  if (!admin || !admin.twofa_secret) return res.status(400).json({ error: 'Gere o segredo primeiro.' });
  const { code } = req.body;
  const verified = speakeasy.totp.verify({ secret: admin.twofa_secret, encoding: 'base32', token: code, window: 1 });
  if (!verified) return res.status(400).json({ error: 'Código inválido.' });
  admin.twofa_enabled = true;
  saveDb();
  res.json({ success: true });
});

app.post('/api/auth/2fa/disable', authMiddleware, (req, res) => {
  const admin = DB.admins.find(a => a.id === req.user.id);
  if (!admin) return res.status(404).json({ error: 'Admin não encontrado.' });
  const { code } = req.body;
  if (admin.twofa_enabled) {
    const verified = speakeasy.totp.verify({ secret: admin.twofa_secret, encoding: 'base32', token: code, window: 1 });
    if (!verified) return res.status(400).json({ error: 'Código inválido.' });
  }
  admin.twofa_secret = null;
  admin.twofa_enabled = false;
  saveDb();
  res.json({ success: true });
});

/* ============================================================
   ROTA PÚBLICA DE SCRIPTS (PÁGINA INICIAL)
   ============================================================ */
app.get('/api/public/scripts', (req, res) => {
  const scripts = DB.scripts.map(s => ({
    id: s.id,
    name: s.name,
    status: s.status,
    image: s.image || '',
    short_id: s.short_id,
    version: s.version || '1.0.0',
    updated_at: s.updated_at
  }));
  res.json(scripts);
});

/* ============================================================
   SCRIPTS (CRUD)
   ============================================================ */
app.use('/api/scripts', apiLimiter);

app.get('/api/scripts', authMiddleware, (req, res) => {
  res.json(DB.scripts.map(s => ({
    id: s.id, name: s.name, status: s.status,
    sandbox: s.sandbox || false, executions: s.executions || 0,
    short_id: s.short_id, version: s.version || '1.0.0',
    created_at: s.created_at, updated_at: s.updated_at
  })));
});

app.get('/api/scripts/:id', authMiddleware, (req, res) => {
  const script = DB.scripts.find(s => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: 'Script não encontrado' });
  res.json(script);
});

app.post('/api/scripts', authMiddleware, (req, res) => {
  const { name, content, status, sandbox } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'Nome e conteúdo obrigatórios' });
  const script = {
    id: uuidv4(), name: name.trim(), content,
    status: status || 'online', sandbox: sandbox === true,
    executions: 0, short_id: generateShortId(), version: '1.0.0',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  };
  DB.scripts.push(script);
  saveDb();
  res.status(201).json(script);
});

app.put('/api/scripts/:id', authMiddleware, (req, res) => {
  const script = DB.scripts.find(s => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: 'Script não encontrado' });
  DB.versions.push({
    id: uuidv4(), script_id: script.id, name: script.name,
    content: script.content, status: script.status,
    sandbox: script.sandbox || false, created_at: new Date().toISOString()
  });
  const { name, content, status, sandbox } = req.body;
  if (name !== undefined) script.name = name.trim();
  if (content !== undefined) script.content = content;
  if (status !== undefined) script.status = status;
  if (sandbox !== undefined) script.sandbox = sandbox;
  script.updated_at = new Date().toISOString();
  saveDb();
  res.json(script);
});

app.delete('/api/scripts/:id', authMiddleware, (req, res) => {
  const idx = DB.scripts.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Script não encontrado' });
  DB.scripts.splice(idx, 1);
  DB.versions = DB.versions.filter(v => v.script_id !== req.params.id);
  saveDb();
  res.json({ success: true });
});

app.post('/api/scripts/bulk', authMiddleware, (req, res) => {
  const { scripts } = req.body;
  if (!Array.isArray(scripts) || scripts.length === 0) return res.status(400).json({ error: 'Array obrigatório' });
  const created = [];
  for (const s of scripts) {
    if (!s.name || !s.content) continue;
    const script = {
      id: uuidv4(), name: s.name.trim(), content: s.content,
      status: 'online', sandbox: false, executions: 0,
      short_id: generateShortId(), version: '1.0.0',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    };
    DB.scripts.push(script);
    created.push(script);
  }
  if (created.length === 0) return res.status(400).json({ error: 'Nenhum válido' });
  saveDb();
  res.status(201).json(created);
});

app.get('/api/scripts/:id/versions', authMiddleware, (req, res) => {
  const versions = DB.versions.filter(v => v.script_id === req.params.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(versions);
});

app.post('/api/scripts/:id/restore', authMiddleware, (req, res) => {
  const { versionId } = req.body;
  const version = DB.versions.find(v => v.id === versionId);
  if (!version || version.script_id !== req.params.id) return res.status(404).json({ error: 'Versão não encontrada' });
  const script = DB.scripts.find(s => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: 'Script não encontrado' });
  DB.versions.push({
    id: uuidv4(), script_id: script.id, name: script.name,
    content: script.content, status: script.status,
    sandbox: script.sandbox || false, created_at: new Date().toISOString()
  });
  script.name = version.name;
  script.content = version.content;
  script.status = version.status;
  script.sandbox = version.sandbox;
  script.updated_at = new Date().toISOString();
  saveDb();
  res.json(script);
});

/* ============================================================
   CHANGELOG VIA WEBHOOK
   ============================================================ */
app.post('/api/scripts/:id/changelog', authMiddleware, async (req, res) => {
  const script = DB.scripts.find(s => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: 'Script não encontrado' });
  const { title, description, banner, thumbnail } = req.body;
  await sendChangelogWebhook({ title, description, banner, thumbnail, scriptName: script.name });
  res.json({ success: true });
});

/* ============================================================
   EXPORT / IMPORT (APENAS MASTER)
   ============================================================ */
app.get('/api/export', authMiddleware, masterOnly, (req, res) => {
  res.json({ scripts: DB.scripts, versions: DB.versions });
});

app.post('/api/import', authMiddleware, masterOnly, (req, res) => {
  const { scripts, versions } = req.body;
  if (!Array.isArray(scripts)) return res.status(400).json({ error: 'Formato inválido' });
  DB.scripts = scripts;
  DB.versions = Array.isArray(versions) ? versions : [];
  saveDb();
  res.json({ success: true, imported: DB.scripts.length });
});

/* ============================================================
   ESTATÍSTICAS
   ============================================================ */
app.get('/api/stats', authMiddleware, (req, res) => {
  const total = DB.scripts.length;
  const online = DB.scripts.filter(s => s.status === 'online').length;
  const exec = DB.scripts.reduce((a, s) => a + (s.executions || 0), 0);
  res.json({ totalScripts: total, onlineScripts: online, offlineScripts: total - online, totalExecutions: exec, executionsToday: 0 });
});

/* ============================================================
   LOADER
   ============================================================ */
app.get('/api/load/:id', loaderLimiter, (req, res) => {
  if (MAINTENANCE_MODE) return res.status(503).send('Em manutenção.');
  const ua = (req.get('User-Agent') || '').toLowerCase();
  if (ua.includes('roblox')) {
    // permite
  } else {
    const isBrowser = /mozilla|chrome|safari|edge|firefox|opera/i.test(ua);
    if (isBrowser) return res.status(403).sendFile(path.join(__dirname, 'public', 'blocked.html'));
  }
  const script = DB.scripts.find(s => s.id === req.params.id);
  if (!script || script.status !== 'online') return res.status(404).send('Script indisponível.');
  if (script.sandbox) {
    const token = req.cookies?.token;
    try { jwt.verify(token, JWT_SECRET); } catch { return res.status(403).send('Acesso restrito.'); }
  }
  script.executions = (script.executions || 0) + 1;
  saveDb();
  res.type('text/plain').send(script.content);
});

/* ============================================================
   LINK CURTO
   ============================================================ */
app.get('/s/:shortId', (req, res) => {
  const script = DB.scripts.find(s => s.short_id === req.params.shortId);
  if (!script) return res.status(404).send('Link não encontrado.');
  return res.redirect(`/api/load/${script.id}`);
});

/* ============================================================
   PÁGINAS
   ============================================================ */
app.get('/status', (req, res) => {
  const online = DB.scripts.filter(s => s.status === 'online').length;
  const total = DB.scripts.length;
  const exec = DB.scripts.reduce((a, s) => a + (s.executions || 0), 0);
  res.send(`<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><title>Astro Status</title><style>body{background:#0a0a0a;color:#fff;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.card{background:#111;border:1px solid #1f1f1f;border-radius:16px;padding:2.5rem;text-align:center;max-width:400px;width:90%}h1{margin-bottom:.5rem}p{color:#a0a0a0}.stat{font-size:2rem;font-weight:800;margin:.5rem 0}.dot{display:inline-block;width:10px;height:10px;background:#10b981;border-radius:50%;margin-right:.5rem}</style></head><body><div class="card"><h1>Astro</h1><p>Sistema operacional</p><div class="stat"><span class="dot"></span>${online} / ${total} scripts online</div><p>${exec} execuções totais</p></div></body></html>`);
});

app.get('/get/:scriptId', (req, res) => {
  const script = DB.scripts.find(s => s.id === req.params.scriptId && s.status === 'online');
  if (!script) return res.status(404).send('Script não encontrado.');
  res.sendFile(path.join(__dirname, 'public', 'get.html'));
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get(DYNAMIC_ADMIN_PATH, (req, res) => res.sendFile(path.join(__dirname, 'public/admin/login.html')));
app.get(`${DYNAMIC_ADMIN_PATH}/dashboard`, authMiddleware, (req, res) => res.sendFile(path.join(__dirname, 'public/admin/dashboard.html')));
app.get('/admin', (req, res) => res.status(404).send('Cannot GET /admin'));

/* ============================================================
   ADMIN INICIAL (SENHA OBRIGATÓRIA DO .env)
   ============================================================ */
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
if (!DB.admins.find(a => a.username === ADMIN_USER)) {
  DB.admins.push({
    id: 1, username: ADMIN_USER,
    password_hash: bcrypt.hashSync(ADMIN_PASS, 10),
    role: 'master',
    twofa_secret: null,
    twofa_enabled: false,
    failedAttempts: 0,
    lockUntil: null
  });
  saveDb();
  console.log(`✅ Admin master criado: ${ADMIN_USER}`);
}

/* ============================================================
   TRATAMENTO DE ERROS
   ============================================================ */
app.use((err, req, res, next) => {
  console.error('❌ Erro:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Erro interno.' });
});

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🪐 Astro Storage rodando na porta ${PORT}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`🔗 Admin URL: ${DYNAMIC_ADMIN_PATH}`);
  }
});