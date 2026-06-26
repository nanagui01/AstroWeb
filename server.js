require('dotenv').config();

// ============================================================
// VALIDAÇÃO OBRIGATÓRIA DE AMBIENTE
// ============================================================
if (!process.env.JWT_SECRET) { console.error('❌ ERRO FATAL: JWT_SECRET não definido no .env'); process.exit(1); }
if (!process.env.COOKIE_SECRET) { console.error('❌ ERRO FATAL: COOKIE_SECRET não definido no .env'); process.exit(1); }
if (!process.env.ADMIN_ROUTE_SECRET) { console.error('❌ ERRO FATAL: ADMIN_ROUTE_SECRET não definido no .env'); process.exit(1); }
if (!process.env.ADMIN_PASS) { console.error('❌ ERRO FATAL: ADMIN_PASS não definido no .env'); process.exit(1); }
if (!process.env.ADMIN_USER) { console.error('❌ ERRO FATAL: ADMIN_USER não definido no .env'); process.exit(1); }

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
   CONFIGURAÇÕES
   ============================================================ */
const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_SECRET = process.env.COOKIE_SECRET;
const ADMIN_ROUTE_SECRET = process.env.ADMIN_ROUTE_SECRET;
const DYNAMIC_ADMIN_PATH = '/' + crypto.createHash('sha256').update(ADMIN_ROUTE_SECRET).digest('hex');
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (!IS_PRODUCTION) console.log(`\n[DEV] URL administrativa: http://localhost:${PORT}${DYNAMIC_ADMIN_PATH}\n`);

/* ============================================================
   CONFIGURAÇÃO DE TIMEOUT DO SERVIDOR
   ============================================================ */
app.use((req, res, next) => {
  res.setTimeout(30000, () => {
    res.status(408).json({ error: 'Timeout da requisição' });
  });
  next();
});

/* ============================================================
   SISTEMA DE SAVE EM LOTE (DEFERRED SAVE)
   ============================================================ */
let dbNeedsSave = false;
function deferredSave() { dbNeedsSave = true; }
setInterval(() => {
  if (dbNeedsSave) {
    saveDb();
    dbNeedsSave = false;
  }
}, 30000);

/* ============================================================
   SEGURANÇA BÁSICA
   ============================================================ */
app.disable('x-powered-by');
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
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: "no-referrer" },
  crossOriginEmbedderPolicy: false
}));
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser(COOKIE_SECRET));

/* ============================================================
   CORS PARA API PÚBLICA
   ============================================================ */
app.use('/api/public', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

/* ============================================================
   MIDDLEWARE DE LOG COLORIDO
   ============================================================ */
const colors = { reset: '\x1b[0m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m' };
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const color = status >= 400 ? colors.red : status >= 300 ? colors.yellow : colors.green;
    console.log(`${colors.cyan}[${new Date().toISOString()}]${colors.reset} ${color}${req.method} ${req.originalUrl} → ${status}${colors.reset} (${duration}ms)`);
  });
  next();
});

/* ============================================================
   SANITIZAÇÃO
   ============================================================ */
function sanitizeInput(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;').replace(/\//g,'&#x2F;');
}
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    for (const key in req.body) {
      if (key === 'content') continue;
      if (['name','title','description'].includes(key)) req.body[key] = sanitizeInput(req.body[key]);
    }
  }
  next();
});

/* ============================================================
   VALIDAÇÕES
   ============================================================ */
const MAX_NAME = 100, MAX_CONTENT = 500000, MAX_TITLE = 200, MAX_DESC = 2000;
const VALID_STATUS = ['online', 'offline', 'maintenance', 'development'];

function validateScript(name, content, status) {
  const errors = [];
  if (!name || typeof name !== 'string' || !name.trim()) errors.push('Nome obrigatório.');
  else if (name.length > MAX_NAME) errors.push(`Nome > ${MAX_NAME} caracteres.`);
  if (!content || typeof content !== 'string' || !content.trim()) errors.push('Conteúdo válido e não vazio é obrigatório.');
  else if (content.length > MAX_CONTENT) errors.push(`Conteúdo > ${MAX_CONTENT/1000}KB.`);
  if (status && !VALID_STATUS.includes(status)) errors.push(`Status inválido. Use: ${VALID_STATUS.join(', ')}.`);
  return errors;
}

/* ============================================================
   RATE LIMIT
   ============================================================ */
const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 3, message: { error: 'Muitas tentativas.' } });
const twofaLimiter = rateLimit({ windowMs: 5*60*1000, max: 5, message: { error: 'Muitas tentativas 2FA.' } });
const apiLimiter = rateLimit({ windowMs: 1*60*1000, max: 250 });
const loaderLimiter = rateLimit({ windowMs: 1*60*1000, max: 300 });
const masterActionLimiter = rateLimit({ windowMs: 5*60*1000, max: 15, message: { error: 'Muitas ações administrativas.' } });

/* ============================================================
   CSRF CORRIGIDO
   ============================================================ */
function genCsrf() { return crypto.randomBytes(32).toString('hex'); }
app.get('/api/csrf-token', (req, res) => {
  const t = genCsrf();
  res.cookie('csrf_token', t, { httpOnly: false, secure: IS_PRODUCTION, sameSite: 'strict', path: '/', maxAge: 8*3600*1000 });
  res.json({ csrfToken: t });
});
function csrfCheck(req, res, next) {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  if (['/api/auth/login','/api/auth/verify-2fa'].includes(req.path)) return next();
  const cookieToken = req.cookies?.csrf_token;
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'Proteção CSRF: Token inválido ou cabeçalho ausente' });
  }
  next();
}
app.use('/api/', csrfCheck);

/* ============================================================
   BLACKLIST OTIMIZADA COM SET (O(1))
   ============================================================ */
DB.tokenBlacklist = DB.tokenBlacklist || [];
const blacklistSet = new Set(DB.tokenBlacklist.map(b => b.hash));

function hashTok(t) { return crypto.createHash('sha256').update(t).digest('hex'); }
function cleanBlacklist() {
  const now = Math.floor(Date.now()/1000);
  DB.tokenBlacklist = DB.tokenBlacklist.filter(t => t.exp > now);
  blacklistSet.clear();
  DB.tokenBlacklist.forEach(b => blacklistSet.add(b.hash));
  deferredSave();
}
setInterval(cleanBlacklist, 10*60*1000);
function isBlacklisted(t) { return blacklistSet.has(hashTok(t)); }
function blacklist(t) {
  const dec = jwt.decode(t); if (!dec?.exp) return;
  const h = hashTok(t); if (blacklistSet.has(h)) return;
  DB.tokenBlacklist.push({ hash: h, exp: dec.exp });
  blacklistSet.add(h);
  if (DB.tokenBlacklist.length > 1000) {
    DB.tokenBlacklist = DB.tokenBlacklist.slice(-1000);
    blacklistSet.clear();
    DB.tokenBlacklist.forEach(b => blacklistSet.add(b.hash));
  }
  deferredSave();
}

/* ============================================================
   DB & MÓDULO DE AUDITORIA DE LOGS
   ============================================================ */
DB.scripts = DB.scripts || []; DB.admins = DB.admins || []; DB.versions = DB.versions || []; DB.backups = DB.backups || []; DB.logs = DB.logs || [];
DB.admins.forEach(a => { 
  a.twofa_secret = a.twofa_secret || null; 
  a.twofa_enabled = a.twofa_enabled || false; 
  a.failedAttempts = a.failedAttempts || 0; 
  a.lockUntil = a.lockUntil || null;
  a.passwordChangedAt = a.passwordChangedAt || Date.now();
});

function addLog(req, action, target) {
  const admin = req.user?.username || 'Sistema/Anônimo';
  const ip = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
  const userAgent = req.get('User-Agent') || 'N/A';
  DB.logs.push({ admin, action, target, ip, userAgent, date: new Date().toISOString() });
  if (DB.logs.length > 2000) DB.logs = DB.logs.slice(-2000);
  deferredSave();
}

// Controle de flood de execuções em memória
const executionCooldowns = new Map();
setInterval(() => executionCooldowns.clear(), 10000);

/* ============================================================
   HELPERS
   ============================================================ */
function shortId() { return crypto.randomBytes(8).toString('hex'); }
function secureToken() { return crypto.randomBytes(16).toString('hex'); }
function validUrl(s) { try { new URL(s); return true; } catch { return false; } }

async function discordEmbed({ title, description, banner, thumbnail, scriptName }) {
  if (!DISCORD_WEBHOOK_URL) return;
  const embed = {
    title: title || `${scriptName} foi atualizado!`,
    description: description || 'Veja as novidades.',
    color: 0x6366f1, timestamp: new Date().toISOString(), footer: { text: 'Astro Storage' }
  };
  if (banner && validUrl(banner)) embed.image = { url: banner };
  if (thumbnail && validUrl(thumbnail)) embed.thumbnail = { url: thumbnail };
  axios.post(DISCORD_WEBHOOK_URL, { embeds: [embed] }, { timeout: 5000 }).catch(e => console.error('[DISCORD]', e.message));
}

async function auth(req, res, next) {
  const t = req.signedCookies?.token; if (!t) return res.status(401).json({ error: 'Token ausente' });
  if (isBlacklisted(t)) { res.clearCookie('token', { httpOnly: true, secure: IS_PRODUCTION, sameSite: 'strict', path: '/', signed: true }); return res.status(401).json({ error: 'Token inválido' }); }
  try { 
    const decoded = jwt.verify(t, JWT_SECRET); 
    const admin = DB.admins.find(a => a.id === decoded.id);
    if (!admin) return res.status(401).json({ error: 'Administrador inválido.' });
    if (admin.passwordChangedAt && (decoded.iat * 1000) < admin.passwordChangedAt) {
      res.clearCookie('token', { httpOnly: true, secure: IS_PRODUCTION, sameSite: 'strict', path: '/', signed: true });
      return res.status(401).json({ error: 'Sessão revogada. Uma nova senha foi configurada.' });
    }
    req.user = decoded; 
    next(); 
  } catch { 
    res.clearCookie('token', { httpOnly: true, secure: IS_PRODUCTION, sameSite: 'strict', path: '/', signed: true }); 
    res.status(401).json({ error: 'Sessão expirada' }); 
  }
}
function masterOnly(req, res, next) { if (req.user?.role !== 'master') return res.status(403).json({ error: 'Apenas master' }); next(); }

const FAKE_HASH = '$2a$10$7EqJtq98hPqEX7fNZaFWoOHi5xJYq7u9fN5F5NeLSd851qwL2mM5e';

/* ============================================================
   HEALTH CHECK & PING
   ============================================================ */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    uptime: process.uptime(),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
    timestamp: new Date().toISOString(),
    scripts: DB.scripts.length,
    admins: DB.admins.length
  });
});

app.get('/api/ping', (req, res) => res.json({ pong: true, time: Date.now() }));

/* ============================================================
   AUTENTICAÇÃO
   ============================================================ */
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Dados inválidos.' });
  const admin = DB.admins.find(a => a.username.toLowerCase() === username.toLowerCase());
  if (!admin) { await bcrypt.compare(password, FAKE_HASH); return res.status(401).json({ error: 'Credenciais inválidas' }); }
  if (admin.lockUntil && admin.lockUntil > Date.now()) return res.status(423).json({ error: 'Conta bloqueada', locked: true });
  const isMatch = await bcrypt.compare(password, admin.password_hash);
  if (!isMatch) {
    admin.failedAttempts++; 
    if (admin.failedAttempts >= 5) { admin.lockUntil = Date.now() + 15*60*1000; admin.failedAttempts = 0; } 
    deferredSave();
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }
  admin.failedAttempts = 0; admin.lockUntil = null; deferredSave();
  if (admin.twofa_enabled) return res.json({ require2FA: true, tempToken: jwt.sign({ id: admin.id, username, require2FA: true }, JWT_SECRET, { expiresIn: '5m' }) });
  const token = jwt.sign({ id: admin.id, username, role: admin.role || 'admin' }, JWT_SECRET, { expiresIn: '8h' });
  res.cookie('token', token, { httpOnly: true, secure: IS_PRODUCTION, sameSite: 'strict', path: '/', signed: true, maxAge: 8*3600*1000 });
  addLog(req, 'login', username);
  res.json({ success: true, redirectPath: `${DYNAMIC_ADMIN_PATH}/dashboard` });
});

app.post('/api/auth/verify-2fa', twofaLimiter, (req, res) => {
  const { tempToken, code } = req.body;
  let p; try { p = jwt.verify(tempToken, JWT_SECRET); if (!p.require2FA) throw new Error(); } catch { return res.status(401).json({ error: 'Token temporário inválido' }); }
  const admin = DB.admins.find(a => a.id === p.id);
  if (!admin?.twofa_secret) return res.status(400).json({ error: '2FA não configurado' });
  if (!speakeasy.totp.verify({ secret: admin.twofa_secret, encoding: 'base32', token: code, window: 1 })) return res.status(401).json({ error: 'Código inválido' });
  const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role || 'admin' }, JWT_SECRET, { expiresIn: '8h' });
  res.cookie('token', token, { httpOnly: true, secure: IS_PRODUCTION, sameSite: 'strict', path: '/', signed: true, maxAge: 8*3600*1000 });
  res.json({ success: true, redirectPath: `${DYNAMIC_ADMIN_PATH}/dashboard` });
});

app.post('/api/auth/logout', (req, res) => { const t = req.signedCookies?.token; if (t) blacklist(t); res.clearCookie('token', { httpOnly: true, secure: IS_PRODUCTION, sameSite: 'strict', path: '/', signed: true }); res.clearCookie('csrf_token', { secure: IS_PRODUCTION, sameSite: 'strict', path: '/' }); res.json({ success: true, redirectPath: DYNAMIC_ADMIN_PATH }); });
app.get('/api/auth/me', auth, (req, res) => res.json({ username: req.user.username, role: req.user.role || 'admin', twofa_enabled: DB.admins.find(a => a.id === req.user.id)?.twofa_enabled || false }));

// 2FA
app.get('/api/auth/2fa/setup', auth, twofaLimiter, (req, res) => {
  const a = DB.admins.find(a => a.id === req.user.id); if (!a) return res.status(404).json({ error: 'Admin não encontrado' });
  const sec = speakeasy.generateSecret({ name: `Astro:${a.username}` }); a.twofa_secret = sec.base32; a.twofa_enabled = false; deferredSave();
  QRCode.toDataURL(sec.otpauth_url, (err, url) => { if (err) return res.status(500).json({ error: 'QR Code' }); res.json({ secret: sec.base32, qrCode: url }); });
});
app.post('/api/auth/2fa/enable', auth, twofaLimiter, (req, res) => {
  const a = DB.admins.find(a => a.id === req.user.id); if (!a?.twofa_secret) return res.status(400).json({ error: 'Segredo não gerado' });
  if (!speakeasy.totp.verify({ secret: a.twofa_secret, encoding: 'base32', token: req.body.code, window: 1 })) return res.status(400).json({ error: 'Código inválido' });
  a.twofa_enabled = true; deferredSave(); res.json({ success: true });
});
app.post('/api/auth/2fa/disable', auth, twofaLimiter, (req, res) => {
  const a = DB.admins.find(a => a.id === req.user.id); if (!a) return res.status(404).json({ error: 'Admin não encontrado' });
  if (a.twofa_enabled && !speakeasy.totp.verify({ secret: a.twofa_secret, encoding: 'base32', token: req.body.code, window: 1 })) return res.status(400).json({ error: 'Código inválido' });
  a.twofa_secret = null; a.twofa_enabled = false; deferredSave(); res.json({ success: true });
});

/* ============================================================
   ENDPOINT PARA TROCAR SENHA (INVALIDA SESSÕES)
   ============================================================ */
app.post('/api/auth/change-password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Senha atual e nova são obrigatórias.' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Nova senha deve ter no mínimo 8 caracteres.' });
  
  const admin = DB.admins.find(a => a.id === req.user.id);
  if (!admin) return res.status(404).json({ error: 'Admin não encontrado.' });
  
  const isMatch = await bcrypt.compare(currentPassword, admin.password_hash);
  if (!isMatch) return res.status(401).json({ error: 'Senha atual incorreta.' });
  
  admin.password_hash = await bcrypt.hash(newPassword, 10);
  admin.passwordChangedAt = Date.now();
  
  // Invalida todas as sessões ativas
  const token = req.signedCookies?.token;
  if (token) blacklist(token);
  
  addLog(req, 'change_password', req.user.username);
  saveDb(); // Persistência imediata
  res.json({ success: true, message: 'Senha alterada. Todas as sessões foram invalidadas.' });
});

/* ============================================================
   SCRIPTS
   ============================================================ */
app.use('/api/scripts', apiLimiter);
app.get('/api/scripts', auth, (req, res) => res.json(DB.scripts.map(s => ({ id: s.id, name: s.name, status: s.status, sandbox: s.sandbox||false, executions: s.executions||0, short_id: s.short_id, version: s.version||'1.0.0', created_at: s.created_at, updated_at: s.updated_at }))));

app.get('/api/scripts/:id', auth, (req, res) => { 
  const s = DB.scripts.find(s => s.id === req.params.id); 
  if (!s) return res.status(404).json({ error: 'Script não encontrado' }); 
  res.json({ id: s.id, name: s.name, content: s.content, status: s.status, sandbox: s.sandbox || false, short_id: s.short_id, token: s.token, version: s.version || '1.0.0' }); 
});

app.post('/api/scripts', auth, (req, res) => {
  const { name, content, status, sandbox } = req.body;
  const errors = validateScript(name, content, status);
  if (errors.length) return res.status(400).json({ errors });
  const s = { id: uuidv4(), name: name.trim(), content, status: status && VALID_STATUS.includes(status) ? status : 'online', sandbox: sandbox === true, executions:0, short_id: shortId(), token: secureToken(), version:'1.0.0', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  DB.scripts.push(s); 
  addLog(req, 'create_script', s.name);
  deferredSave(); res.status(201).json(s);
});

app.put('/api/scripts/:id', auth, (req, res) => {
  const s = DB.scripts.find(s => s.id === req.params.id); if (!s) return res.status(404).json({ error: 'Script não encontrado' });
  const { name, content, status, sandbox } = req.body;
  const errors = validateScript(name ?? s.name, content ?? s.content, status);
  if (errors.length) return res.status(400).json({ errors });
  const scriptVersions = DB.versions.filter(v => v.script_id === s.id);
  if (scriptVersions.length >= 50) {
    const oldestIdx = DB.versions.findIndex(v => v.script_id === s.id);
    if (oldestIdx !== -1) DB.versions.splice(oldestIdx, 1);
  }
  DB.versions.push({ id: uuidv4(), script_id: s.id, name: s.name, content: s.content, status: s.status, sandbox: s.sandbox||false, created_at: new Date().toISOString() });
  if (name !== undefined) s.name = name.trim();
  if (content !== undefined) s.content = content;
  if (status !== undefined) s.status = status && VALID_STATUS.includes(status) ? status : s.status;
  if (sandbox !== undefined) s.sandbox = sandbox;
  s.updated_at = new Date().toISOString(); 
  addLog(req, 'edit_script', s.name);
  deferredSave(); res.json(s);
});

app.delete('/api/scripts/:id', auth, (req, res) => { 
  const i = DB.scripts.findIndex(s => s.id === req.params.id); 
  if (i===-1) return res.status(404).json({ error: 'Script não encontrado' }); 
  const name = DB.scripts[i].name;
  DB.scripts.splice(i,1); 
  DB.versions = DB.versions.filter(v => v.script_id !== req.params.id); 
  addLog(req, 'delete_script', name);
  deferredSave(); res.json({ success: true }); 
});

app.post('/api/scripts/bulk', auth, (req, res) => { 
  const { scripts } = req.body; 
  if (!Array.isArray(scripts) || !scripts.length) return res.status(400).json({ error: 'Array obrigatório' }); 
  if (scripts.length > 500) return res.status(400).json({ error: 'Limite de 500 scripts por lote excedido.' });
  const created = []; 
  for (const sc of scripts) { 
    const errors = validateScript(sc.name, sc.content); 
    if (errors.length) continue; 
    const s = { id: uuidv4(), name: sc.name.trim(), content: sc.content, status:'online', sandbox:false, executions:0, short_id: shortId(), token: secureToken(), version:'1.0.0', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; 
    DB.scripts.push(s); 
    created.push(s); 
  } 
  if (!created.length) return res.status(400).json({ error: 'Nenhum script válido enviado.' }); 
  addLog(req, 'bulk_import', `${created.length} scripts`); 
  deferredSave(); res.status(201).json(created); 
});

app.get('/api/scripts/:id/versions', auth, (req, res) => res.json(DB.versions.filter(v => v.script_id === req.params.id).sort((a,b) => new Date(b.created_at)-new Date(a.created_at))));
app.post('/api/scripts/:id/restore', auth, (req, res) => { 
  const { versionId } = req.body; 
  const v = DB.versions.find(v => v.id === versionId); 
  if (!v || v.script_id !== req.params.id) return res.status(404).json({ error: 'Versão não encontrada' }); 
  const s = DB.scripts.find(s => s.id === req.params.id); 
  if (!s) return res.status(404).json({ error: 'Script não encontrado' }); 
  DB.versions.push({ id: uuidv4(), script_id: s.id, name: s.name, content: s.content, status: s.status, sandbox: s.sandbox||false, created_at: new Date().toISOString() }); 
  s.name = v.name; s.content = v.content; s.status = v.status; s.sandbox = v.sandbox; 
  s.updated_at = new Date().toISOString(); 
  addLog(req, 'restore_version', s.name); 
  deferredSave(); 
  res.json(s); 
});

// Changelog
app.post('/api/scripts/:id/changelog', auth, async (req, res) => {
  const s = DB.scripts.find(s => s.id === req.params.id); if (!s) return res.status(404).json({ error: 'Script não encontrado' });
  const { title, description, banner, thumbnail } = req.body;
  if (title?.length > MAX_TITLE) return res.status(400).json({ error: `Título > ${MAX_TITLE}` });
  if (description?.length > MAX_DESC) return res.status(400).json({ error: `Descrição > ${MAX_DESC}` });
  if (banner && !validUrl(banner)) return res.status(400).json({ error: 'URL do banner inválida' });
  if (thumbnail && !validUrl(thumbnail)) return res.status(400).json({ error: 'URL da thumbnail inválida' });
  await discordEmbed({ title, description, banner, thumbnail, scriptName: s.name });
  res.json({ success: true });
});

// Export/Import com histórico de Backups múltiplos
app.get('/api/export', auth, masterOnly, masterActionLimiter, (req, res) => res.json({ scripts: DB.scripts, versions: DB.versions, exported_at: new Date().toISOString() }));

app.post('/api/import', auth, masterOnly, masterActionLimiter, (req, res) => {
  const { scripts, versions, confirmation } = req.body;
  if (confirmation !== 'IMPORTAR') return res.status(400).json({ error: 'Confirmação necessária.' });
  if (!Array.isArray(scripts)) return res.status(400).json({ error: 'Formato inválido' });
  if (scripts.length > 500) return res.status(400).json({ error: 'Ação abortada: Limite máximo de 500 scripts por base.' });
  for (const s of scripts) {
    if (!s.id || !s.name || !s.content) return res.status(400).json({ error: 'Scripts devem conter id, name, content e token.' });
    if (typeof s.name !== 'string' || s.name.length > MAX_NAME) return res.status(400).json({ error: `Nome inválido ou maior que ${MAX_NAME}` });
    if (typeof s.content !== 'string' || s.content.length > MAX_CONTENT) return res.status(400).json({ error: `Conteúdo maior que o limite configurado.` });
    if (s.status && !VALID_STATUS.includes(s.status)) return res.status(400).json({ error: `Status estrutural inválido.` });
    s.token = s.token || secureToken();
  }
  DB.backups.push({ id: crypto.randomBytes(4).toString('hex'), scripts: [...DB.scripts], versions: [...DB.versions], created_at: new Date().toISOString() });
  if (DB.backups.length > 5) DB.backups.shift();
  DB.scripts = scripts;
  DB.versions = Array.isArray(versions) ? versions : [];
  addLog(req, 'import_database', `${DB.scripts.length} scripts estruturados`);
  saveDb();
  res.json({ success: true, imported: DB.scripts.length });
});

// Endpoint de recuperação de backups antigos
app.post('/api/import/restore-backup', auth, masterOnly, masterActionLimiter, (req, res) => {
  const { backupId } = req.body;
  const b = DB.backups.find(bk => bk.id === backupId);
  if (!b) return res.status(404).json({ error: 'Backup histórico não localizado.' });
  DB.scripts = [...b.scripts];
  DB.versions = [...b.versions];
  addLog(req, 'restore_backup', `ID: ${backupId}`);
  saveDb();
  res.json({ success: true, scriptsRestored: DB.scripts.length });
});

// Listar backups disponíveis
app.get('/api/backups', auth, masterOnly, (req, res) => {
  res.json(DB.backups.map(b => ({ id: b.id, scripts: b.scripts.length, created_at: b.created_at })));
});

// Ver Logs Administrativos
app.get('/api/logs', auth, masterOnly, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const logs = DB.logs.slice(-limit).reverse();
  res.json(logs);
});

// Stats
app.get('/api/stats', auth, (req, res) => { 
  const t = DB.scripts.length, o = DB.scripts.filter(s => s.status==='online').length, e = DB.scripts.reduce((a,s)=>a+(s.executions||0),0); 
  res.json({ totalScripts:t, onlineScripts:o, offlineScripts:t-o, totalExecutions:e }); 
});

/* ============================================================
   LOADER PROTEGIDO COM DUPLA CAMADA (SHORTID + TOKEN EXCLUSIVO)
   ============================================================ */
app.get('/api/load/:shortId/:token', loaderLimiter, (req, res) => {
  if (MAINTENANCE_MODE) return res.status(503).send('Em manutenção.');
  const s = DB.scripts.find(s => s.short_id === req.params.shortId);
  if (!s || s.status !== 'online') return res.status(404).send('Script indisponível.');
  if (!s.token || req.params.token !== s.token) {
    return res.status(403).send('Acesso negado: Token de execução inválido.');
  }
  if (s.sandbox) { 
    const tok = req.signedCookies?.token; 
    try { jwt.verify(tok, JWT_SECRET); } catch { return res.status(403).send('Acesso restrito.'); } 
  }
  const clientIp = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
  const trackingKey = `${clientIp}:${s.short_id}`;
  if (!executionCooldowns.has(trackingKey)) {
    s.executions = (s.executions||0) + 1;
    executionCooldowns.set(trackingKey, true);
    deferredSave();
  }
  res.type('text/plain').send(s.content);
});

// Link curto redirecionando com token
app.get('/s/:shortId', (req, res) => { 
  const s = DB.scripts.find(s => s.short_id === req.params.shortId); 
  if (!s) return res.status(404).send('Link não encontrado.'); 
  return res.redirect(`/api/load/${s.short_id}/${s.token}`); 
});

app.get('/status', (req, res) => { 
  const o = DB.scripts.filter(s=>s.status==='online').length, t = DB.scripts.length, e = DB.scripts.reduce((a,s)=>a+(s.executions||0),0); 
  res.send(`<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><title>Astro Status</title><style>body{background:#0a0a0a;color:#fff;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.card{background:#111;border:1px solid #1f1f1f;border-radius:16px;padding:2.5rem;text-align:center;max-width:400px;width:90%}h1{margin-bottom:.5rem}p{color:#a0a0a0}.stat{font-size:2rem;font-weight:800;margin:.5rem 0}.dot{display:inline-block;width:10px;height:10px;background:#10b981;border-radius:50%;margin-right:.5rem}</style></head><body><div class="card"><h1>Astro</h1><p>Sistema operacional</p><div class="stat"><span class="dot"></span>${o} / ${t} scripts online</div><p>${e} execuções totais</p></div></body></html>`); 
});

app.get('/get/:shortId', (req, res) => { 
  const s = DB.scripts.find(s => s.short_id === req.params.shortId && s.status==='online'); 
  if (!s) return res.status(404).send('Script não encontrado.'); 
  res.sendFile(path.join(__dirname,'public','get.html')); 
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname,'public','index.html')));
app.get(DYNAMIC_ADMIN_PATH, (req, res) => res.sendFile(path.join(__dirname,'public/admin/login.html')));
app.get(`${DYNAMIC_ADMIN_PATH}/dashboard`, auth, (req, res) => res.sendFile(path.join(__dirname,'public/admin/dashboard.html')));
app.get('/admin', (req, res) => res.status(404).send('Cannot GET /admin'));

/* ============================================================
   INICIALIZAÇÃO DO ADMIN MASTER
   ============================================================ */
const ADMIN_USER = process.env.ADMIN_USER, ADMIN_PASS = process.env.ADMIN_PASS;
(async () => {
  if (!DB.admins.find(a => a.username.toLowerCase() === ADMIN_USER.toLowerCase())) {
    const hashedPass = await bcrypt.hash(ADMIN_PASS, 10);
    DB.admins.push({ 
      id: uuidv4(), 
      username: ADMIN_USER, 
      password_hash: hashedPass, 
      role: 'master', 
      twofa_secret: null, 
      twofa_enabled: false, 
      failedAttempts: 0, 
      lockUntil: null,
      passwordChangedAt: Date.now() 
    });
    saveDb();
    console.log(`✅ Admin master construído: ${ADMIN_USER}`);
  }
})();

/* ============================================================
   TRATAMENTO DE ERROS GLOBAL
   ============================================================ */
app.use((err, req, res, next) => { 
  console.error('❌', err); 
  if (res.headersSent) return next(err); 
  res.status(500).json({ error: 'Erro interno detectado.' }); 
});

/* ============================================================
   GARANTIA DE PERSISTÊNCIA
   ============================================================ */
process.on('SIGTERM', () => { saveDb(); process.exit(0); });
process.on('SIGINT', () => { saveDb(); process.exit(0); });

/* ============================================================
   INICIALIZAÇÃO DO SERVIDOR
   ============================================================ */
app.listen(PORT, '0.0.0.0', () => { 
  console.log(`🪐 Astro rodando na porta ${PORT}`); 
  if (!IS_PRODUCTION) console.log(`🔗 Admin: ${DYNAMIC_ADMIN_PATH}`); 
});