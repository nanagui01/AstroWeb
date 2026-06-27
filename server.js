require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const { DB, saveDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || 'segredo_super_seguro';
const ADMIN_USER = process.env.ADMIN_USER || 'nanagui';
const ADMIN_PASS = process.env.ADMIN_PASS || '001010GGZEHEN';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

app.disable('x-powered-by');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({ windowMs: 60 * 1000, max: 200 });
app.use('/api/', limiter);

// Lista de IPs bloqueados
const blockedIPs = new Set();

// Middleware de bloqueio de IP
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (blockedIPs.has(ip)) {
    return res.status(403).send('Acesso bloqueado.');
  }
  next();
});

DB.scripts = DB.scripts || [];
DB.admins = DB.admins || [];
DB.versions = DB.versions || [];
DB.ipBlacklist = DB.ipBlacklist || [];

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

// Webhook Discord
async function sendDiscordEmbed({ title, description, banner, thumbnail, scriptName }) {
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
  try {
    await axios.post(DISCORD_WEBHOOK_URL, { embeds: [embed] }, { timeout: 5000 });
  } catch (err) {
    console.error('[DISCORD] Erro:', err.message);
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

// ------------------- BLOQUEIO DE IP -------------------
app.get('/api/admin/blocked-ips', auth, (req, res) => {
  res.json([...blockedIPs]);
});

app.post('/api/admin/block-ip', auth, (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP obrigatório' });
  blockedIPs.add(ip);
  saveDb();
  res.json({ success: true });
});

app.delete('/api/admin/block-ip/:ip', auth, (req, res) => {
  blockedIPs.delete(req.params.ip);
  saveDb();
  res.json({ success: true });
});

// ------------------- SCRIPTS CRUD -------------------
app.get('/api/scripts', auth, (req, res) => res.json(DB.scripts));

app.post('/api/scripts', auth, (req, res) => {
  const { name, content, status } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'Nome e conteúdo obrigatórios' });
  const validStatuses = ['online', 'offline', 'maintenance', 'development'];
  const s = {
    id: uuidv4(), name: name.trim(), content,
    status: validStatuses.includes(status) ? status : 'online',
    executions: 0,
    short_id: shortId(), token: secureToken(),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  };
  DB.scripts.push(s);
  saveDb();
  res.status(201).json(s);
});

// Duplicar script
app.post('/api/scripts/:id/duplicate', auth, (req, res) => {
  const original = DB.scripts.find(s => s.id === req.params.id);
  if (!original) return res.status(404).json({ error: 'Script não encontrado' });
  const duplicate = {
    ...original,
    id: uuidv4(),
    name: original.name + ' (cópia)',
    executions: 0,
    short_id: shortId(),
    token: secureToken(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  DB.scripts.push(duplicate);
  saveDb();
  res.status(201).json(duplicate);
});

app.put('/api/scripts/:id', auth, (req, res) => {
  const s = DB.scripts.find(s => s.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Script não encontrado' });
  const { name, content, status } = req.body;
  const validStatuses = ['online', 'offline', 'maintenance', 'development'];
  if (name !== undefined) s.name = name.trim();
  if (content !== undefined) s.content = content;
  if (status !== undefined && validStatuses.includes(status)) s.status = status;
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

// ------------------- CHANGELOG -------------------
app.post('/api/scripts/:id/changelog', auth, async (req, res) => {
  const script = DB.scripts.find(s => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: 'Script não encontrado' });
  const { title, description, banner, thumbnail } = req.body;
  await sendDiscordEmbed({ title, description, banner, thumbnail, scriptName: script.name });
  res.json({ success: true });
});

// ------------------- ESTATÍSTICAS -------------------
app.get('/api/stats', auth, (req, res) => {
  const total = DB.scripts.length;
  const online = DB.scripts.filter(s => s.status === 'online').length;
  const offline = DB.scripts.filter(s => s.status === 'offline').length;
  const maintenance = DB.scripts.filter(s => s.status === 'maintenance').length;
  const development = DB.scripts.filter(s => s.status === 'development').length;
  const exec = DB.scripts.reduce((a, s) => a + (s.executions || 0), 0);
  // Scripts mais populares (top 5)
  const popular = [...DB.scripts].sort((a, b) => (b.executions || 0) - (a.executions || 0)).slice(0, 5);
  // Execuções diárias (últimos 7 dias – simulado, pois não temos log)
  const daily = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    daily.push({ date: d.toISOString().split('T')[0], count: Math.floor(Math.random() * 100) });
  }
  // Taxa por hora (simulado)
  const hourly = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: Math.floor(Math.random() * 50) }));
  res.json({ totalScripts: total, onlineScripts: online, offlineScripts: offline, maintenanceScripts: maintenance, developmentScripts: development, totalExecutions: exec, popular, daily, hourly });
});

// ------------------- EXPORT / IMPORT -------------------
app.get('/api/export', auth, (req, res) => {
  res.json({ scripts: DB.scripts, exported_at: new Date().toISOString() });
});

app.post('/api/import', auth, (req, res) => {
  const { scripts, confirmation } = req.body;
  if (confirmation !== 'IMPORTAR') return res.status(400).json({ error: 'Confirmação necessária. Envie { confirmation: "IMPORTAR" }.' });
  if (!Array.isArray(scripts)) return res.status(400).json({ error: 'Formato inválido' });
  DB.scripts = scripts;
  saveDb();
  res.json({ success: true, imported: DB.scripts.length });
});

// ------------------- LOADER PROTEGIDO -------------------
app.get('/api/load/:shortId/:token', (req, res) => {
  const ua = (req.get('User-Agent') || '').toLowerCase();
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