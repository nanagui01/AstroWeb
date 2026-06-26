require('dotenv').config();
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
const { DB, saveDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

/* ============================================================
   CONFIGURAÇÕES E VARIÁVEIS DE AMBIENTE
   ============================================================ */
const JWT_SECRET = process.env.JWT_SECRET || 'saturn_secret_2024';
const ADMIN_ROUTE_SECRET = process.env.ADMIN_ROUTE_SECRET || 'saturn_secret_hash_2026';
const DYNAMIC_ADMIN_PATH = '/' + crypto.createHash('sha256').update(ADMIN_ROUTE_SECRET).digest('hex');
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';

console.log(`\n[SEGURANÇA] URL administrativa: http://localhost:${PORT}${DYNAMIC_ADMIN_PATH}\n`);
if (DISCORD_WEBHOOK_URL) console.log('[DISCORD] Webhook configurada para changelogs.');
else console.log('[DISCORD] Nenhuma webhook configurada.');

/* ============================================================
   SEGURANÇA BÁSICA
   ============================================================ */
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

/* ============================================================
   LIMITADORES DE REQUISIÇÃO (RATE LIMIT)
   ============================================================ */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Muitas tentativas de login. Tente novamente mais tarde.' }
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 200,
  message: { error: 'Muitas requisições. Aguarde um instante.' }
});

const loaderLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: 'Rate limit exceeded.'
});

/* ============================================================
   INICIALIZAÇÃO DO BANCO DE DADOS EM MEMÓRIA
   ============================================================ */
DB.scripts = DB.scripts || [];
DB.admins = DB.admins || [];
DB.versions = DB.versions || [];

/* ============================================================
   FUNÇÕES AUXILIARES
   ============================================================ */

/** Gera um ID curto (8 caracteres hex) para encurtar URLs. */
function generateShortId() {
  return crypto.randomBytes(4).toString('hex');
}

/** Envia um embed personalizado para o Discord via webhook */
async function sendChangelogWebhook({ title, description, banner, thumbnail, scriptName }) {
  if (!DISCORD_WEBHOOK_URL) return;
  const embed = {
    title: title || `📢 ${scriptName} foi atualizado!`,
    description: description || 'Veja as novidades abaixo.',
    color: 0x6366f1,
    timestamp: new Date().toISOString(),
    footer: { text: 'Saturn Storage' }
  };
  if (banner) embed.image = { url: banner };
  if (thumbnail) embed.thumbnail = { url: thumbnail };
  try {
    await axios.post(DISCORD_WEBHOOK_URL, { embeds: [embed] }, { timeout: 5000 });
  } catch (err) {
    console.error('[DISCORD] Erro ao enviar changelog:', err.message);
  }
}

/** Middleware de autenticação (verifica cookie JWT). */
function authMiddleware(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Token ausente.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    return res.status(401).json({ error: 'Sessão expirada.' });
  }
}

/* ============================================================
   ROTAS DE AUTENTICAÇÃO
   ============================================================ */
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Usuário e senha obrigatórios.' });

  const admin = DB.admins.find(a => a.username === username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash))
    return res.status(401).json({ error: 'Credenciais inválidas.' });

  const token = jwt.sign(
    { id: admin.id, username, role: admin.role || 'admin' },
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
  res.json({ success: true, redirectPath: `${DYNAMIC_ADMIN_PATH}/dashboard` });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  res.json({ success: true, redirectPath: DYNAMIC_ADMIN_PATH });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

/* ============================================================
   ROTA PÚBLICA DE SCRIPTS (PARA A PÁGINA INICIAL)
   ============================================================ */
app.get('/api/public/scripts', (req, res) => {
  const scripts = DB.scripts.map(s => ({
    id: s.id,
    name: s.name,
    status: s.status,
    image: s.image || '',
    short_id: s.short_id
  }));
  res.json(scripts);
});

/* ============================================================
   ROTAS DE SCRIPTS (CRUD, BULK, VERSÕES, ETC.)
   ============================================================ */
app.use('/api/scripts', apiLimiter);

// Listar todos os scripts (admin)
app.get('/api/scripts', authMiddleware, (req, res) => {
  res.json(DB.scripts.map(s => ({
    id: s.id,
    name: s.name,
    status: s.status,
    sandbox: s.sandbox || false,
    executions: s.executions || 0,
    short_id: s.short_id,
    created_at: s.created_at,
    updated_at: s.updated_at
  })));
});

// Obter script completo
app.get('/api/scripts/:id', authMiddleware, (req, res) => {
  const script = DB.scripts.find(s => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: 'Script não encontrado.' });
  res.json(script);
});

// Criar script
app.post('/api/scripts', authMiddleware, (req, res) => {
  const { name, content, status, sandbox } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'Nome e conteúdo obrigatórios.' });

  const script = {
    id: uuidv4(),
    name: name.trim(),
    content,
    status: status || 'online',
    sandbox: sandbox === true,
    executions: 0,
    short_id: generateShortId(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  DB.scripts.push(script);
  saveDb();
  res.status(201).json(script);
});

// Atualizar script (com histórico de versões, sem logs automáticos)
app.put('/api/scripts/:id', authMiddleware, (req, res) => {
  const script = DB.scripts.find(s => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: 'Script não encontrado.' });

  // Salva versão anterior
  DB.versions.push({
    id: uuidv4(),
    script_id: script.id,
    name: script.name,
    content: script.content,
    status: script.status,
    sandbox: script.sandbox || false,
    created_at: new Date().toISOString()
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

// Excluir script
app.delete('/api/scripts/:id', authMiddleware, (req, res) => {
  const index = DB.scripts.findIndex(s => s.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Script não encontrado.' });
  DB.scripts.splice(index, 1);
  DB.versions = DB.versions.filter(v => v.script_id !== req.params.id);
  saveDb();
  res.json({ success: true });
});

// Duplicar script
app.post('/api/scripts/:id/duplicate', authMiddleware, (req, res) => {
  const original = DB.scripts.find(s => s.id === req.params.id);
  if (!original) return res.status(404).json({ error: 'Script não encontrado.' });

  const duplicated = {
    ...original,
    id: uuidv4(),
    name: original.name + ' (cópia)',
    executions: 0,
    short_id: generateShortId(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  DB.scripts.push(duplicated);
  saveDb();
  res.status(201).json(duplicated);
});

// Upload em massa (bulk)
app.post('/api/scripts/bulk', authMiddleware, (req, res) => {
  const { scripts } = req.body;
  if (!Array.isArray(scripts) || scripts.length === 0)
    return res.status(400).json({ error: 'Array de scripts obrigatório.' });

  const created = [];
  for (const s of scripts) {
    if (!s.name || !s.content) continue;
    const script = {
      id: uuidv4(),
      name: s.name.trim(),
      content: s.content,
      status: 'online',
      sandbox: false,
      executions: 0,
      short_id: generateShortId(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    DB.scripts.push(script);
    created.push(script);
  }
  if (created.length === 0) return res.status(400).json({ error: 'Nenhum script válido.' });
  saveDb();
  res.status(201).json(created);
});

// Histórico de versões
app.get('/api/scripts/:id/versions', authMiddleware, (req, res) => {
  const versions = DB.versions
    .filter(v => v.script_id === req.params.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(versions);
});

// Restaurar versão anterior
app.post('/api/scripts/:id/restore', authMiddleware, (req, res) => {
  const { versionId } = req.body;
  const version = DB.versions.find(v => v.id === versionId);
  if (!version || version.script_id !== req.params.id)
    return res.status(404).json({ error: 'Versão não encontrada.' });

  const script = DB.scripts.find(s => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: 'Script não encontrado.' });

  // Salva estado atual antes de restaurar
  DB.versions.push({
    id: uuidv4(),
    script_id: script.id,
    name: script.name,
    content: script.content,
    status: script.status,
    sandbox: script.sandbox || false,
    created_at: new Date().toISOString()
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
   CHANGELOG VIA WEBHOOK (MANUAL)
   ============================================================ */
app.post('/api/scripts/:id/changelog', authMiddleware, async (req, res) => {
  const script = DB.scripts.find(s => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: 'Script não encontrado.' });

  const { title, description, banner, thumbnail } = req.body;
  await sendChangelogWebhook({ title, description, banner, thumbnail, scriptName: script.name });
  res.json({ success: true, message: 'Changelog enviado ao Discord!' });
});

/* ============================================================
   EXPORTAÇÃO / IMPORTAÇÃO
   ============================================================ */
app.get('/api/export', authMiddleware, (req, res) => {
  res.json({ scripts: DB.scripts, versions: DB.versions });
});

app.post('/api/import', authMiddleware, (req, res) => {
  const { scripts, versions } = req.body;
  if (!Array.isArray(scripts)) return res.status(400).json({ error: 'Formato inválido.' });
  DB.scripts = scripts;
  DB.versions = Array.isArray(versions) ? versions : [];
  saveDb();
  res.json({ success: true, imported: DB.scripts.length });
});

/* ============================================================
   ESTATÍSTICAS (DASHBOARD)
   ============================================================ */
app.get('/api/stats', authMiddleware, (req, res) => {
  const totalScripts = DB.scripts.length;
  const onlineScripts = DB.scripts.filter(s => s.status === 'online').length;
  const totalExecutions = DB.scripts.reduce((acc, s) => acc + (s.executions || 0), 0);
  const today = new Date().toISOString().split('T')[0];
  const executionsToday = DB.logs ? DB.logs.filter(l => l.action === 'SCRIPT_EXEC' && l.created_at?.startsWith(today)).length : 0;
  res.json({ totalScripts, onlineScripts, totalExecutions, executionsToday, recentLogs: [] });
});

// Dados para gráfico de execuções (a partir de DB.scripts, já que não temos logs)
app.get('/api/stats/executions', authMiddleware, (req, res) => {
  // Como não há logs, retornamos array vazio
  res.json([]);
});

/* ============================================================
   FEEDBACK DE ERRO (OPCIONAL)
   ============================================================ */
app.post('/api/report', (req, res) => {
  // Pode ser usado futuramente, por enquanto apenas acusa recebimento
  res.json({ received: true });
});

/* ============================================================
   ENCURTADOR DE URLS (LINK CURTO)
   ============================================================ */
app.get('/s/:shortId', (req, res) => {
  const script = DB.scripts.find(s => s.short_id === req.params.shortId);
  if (!script) return res.status(404).send('Link não encontrado.');

  const userAgent = (req.get('User-Agent') || '').toLowerCase();
  const isBrowser = /mozilla|chrome|safari|edge|firefox|opera/i.test(userAgent);

  if (isBrowser) return res.redirect(`/get/${script.id}`);
  return res.redirect(`/api/load/${script.id}`);
});

/* ============================================================
   LOADER PÚBLICO (COM SANDBOX E MANUTENÇÃO)
   ============================================================ */
app.get('/api/load/:id', loaderLimiter, (req, res) => {
  if (MAINTENANCE_MODE) return res.status(503).send('Serviço em manutenção.');

  const userAgent = (req.get('User-Agent') || '').toLowerCase();
  const isBrowser = /mozilla|chrome|safari|edge|firefox|opera/i.test(userAgent);
  if (isBrowser) return res.status(403).sendFile(path.join(__dirname, 'public', 'blocked.html'));

  const script = DB.scripts.find(s => s.id === req.params.id);
  if (!script) return res.status(404).send('Script não encontrado.');

  // Sandbox: apenas admin autenticado
  if (script.sandbox) {
    const token = req.cookies?.token;
    try {
      const user = jwt.verify(token, JWT_SECRET);
      if (user.role !== 'admin' && user.role !== 'master') throw new Error();
    } catch {
      return res.status(403).send('Acesso restrito ao administrador (modo sandbox).');
    }
  }

  if (script.status !== 'online') return res.status(404).send('Script offline.');

  script.executions = (script.executions || 0) + 1;
  saveDb();
  res.type('text/plain').send(script.content);
});

/* ============================================================
   PÁGINA DE STATUS PÚBLICA
   ============================================================ */
app.get('/status', (req, res) => {
  const onlineScripts = DB.scripts.filter(s => s.status === 'online').length;
  const totalScripts = DB.scripts.length;
  const totalExecutions = DB.scripts.reduce((acc, s) => acc + (s.executions || 0), 0);
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Saturn Status</title>
  <style>
    body { background:#0a0a0a; color:#fff; font-family:'Inter',sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
    .card { background:#111; border:1px solid #1f1f1f; border-radius:16px; padding:2.5rem; text-align:center; max-width:400px; width:90%; }
    h1 { margin-bottom:0.5rem; } p { color:#a0a0a0; }
    .stat { font-size:2rem; font-weight:800; margin:0.5rem 0; }
    .dot { display:inline-block; width:10px; height:10px; background:#10b981; border-radius:50%; margin-right:0.5rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Saturn</h1>
    <p>Sistema operacional</p>
    <div class="stat"><span class="dot"></span>${onlineScripts} / ${totalScripts} scripts online</div>
    <p>${totalExecutions} execuções totais</p>
  </div>
</body>
</html>`);
});

/* ============================================================
   PÁGINA DE VISUALIZAÇÃO DE SCRIPT (GET)
   ============================================================ */
app.get('/get/:scriptId', (req, res) => {
  const script = DB.scripts.find(s => s.id === req.params.scriptId && s.status === 'online');
  if (!script) return res.status(404).send('Script não encontrado.');
  res.sendFile(path.join(__dirname, 'public', 'get.html'));
});

/* ============================================================
   PÁGINAS ESTÁTICAS
   ============================================================ */
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get(DYNAMIC_ADMIN_PATH, (req, res) => res.sendFile(path.join(__dirname, 'public/admin/login.html')));
app.get(`${DYNAMIC_ADMIN_PATH}/dashboard`, authMiddleware, (req, res) => res.sendFile(path.join(__dirname, 'public/admin/dashboard.html')));
app.get('/admin', (req, res) => res.status(404).send('Cannot GET /admin'));

/* ============================================================
   ADMIN INICIAL
   ============================================================ */
const ADMIN_USER = process.env.ADMIN_USER || 'nanagui';
const ADMIN_PASS = process.env.ADMIN_PASS || '001010GGZEHEN';
if (!DB.admins.find(a => a.username === ADMIN_USER)) {
  DB.admins.push({ id: 1, username: ADMIN_USER, password_hash: bcrypt.hashSync(ADMIN_PASS, 10), role: 'master' });
  saveDb();
  console.log(`✅ Admin: ${ADMIN_USER}`);
}

/* ============================================================
   TRATAMENTO DE ERROS GLOBAL
   ============================================================ */
app.use((err, req, res, next) => {
  console.error('❌ Erro não tratado:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

/* ============================================================
   INICIALIZAÇÃO DO SERVIDOR
   ============================================================ */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🪐 Saturn Storage rodando na porta ${PORT}`);
  console.log(`🔗 URL administrativa: ${DYNAMIC_ADMIN_PATH}`);
  console.log(`📊 Página de status: /status`);
});