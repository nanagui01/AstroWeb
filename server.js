// server.js — Storm Hub completo (login /lgadm, Discord bot, serviços, keys, loader 2 estágios)
//
// [REVISÃO DE SEGURANÇA]
// - Corrigido: keys podiam ser resgatadas por múltiplas contas do Discord (sem constraint única).
// - Corrigido: endpoint da 2ª etapa do loader entregava o script sem nenhuma validação de key/device.
// - Corrigido: condição de corrida na ativação de device_id de uma key.
// - Adicionado: token de sessão de uso único (60s) entre a 1ª e 2ª etapa do loader.
// - Adicionado: detecção de abuso por diversidade de IP (auto-revoga key suspeita).
// - Adicionado: lockout de conta admin após tentativas falhas de login.
// - Adicionado: rate limit dedicado para verificação de key / loader.
// - Corrigido: SQL injection potencial via `sort`/`order` em /api/scripts (whitelist).
// - Adicionado: hashing de IP para privacidade em logs de atividade de key.
// - Adicionado: tratamento global de erros (nenhuma rota derruba o processo mais).
require('dotenv').config();

// ============================================================
// VARIÁVEIS DE AMBIENTE
// ============================================================
const requiredEnvVars = [
  'JWT_SECRET',
  'COOKIE_SECRET',
  'ADMIN_USER',
  'ADMIN_PASS',
  'DATABASE_URL'
];

for (const varName of requiredEnvVars) {
  if (!process.env[varName]) {
    console.error(`❌ ERRO FATAL: ${varName} não definido no ambiente`);
    process.exit(1);
  }
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
const { Pool } = require('pg');

// ============================================================
// DISCORD.JS – importação global (cliente criado sob condição)
// ============================================================
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  AttachmentBuilder
} = require('discord.js');

// ============================================================
// CONFIGURAÇÕES
// ============================================================
const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_SECRET = process.env.COOKIE_SECRET;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
const ADMIN_PATH = '/lgadm';

// Parâmetros de detecção de abuso de key (ajustáveis por env)
const ABUSE_IP_THRESHOLD = parseInt(process.env.KEY_ABUSE_IP_THRESHOLD || '3', 10);
const ABUSE_WINDOW_MINUTES = parseInt(process.env.KEY_ABUSE_WINDOW_MINUTES || '15', 10);
const LOGIN_MAX_ATTEMPTS = parseInt(process.env.LOGIN_MAX_ATTEMPTS || '5', 10);
const LOGIN_LOCK_MINUTES = parseInt(process.env.LOGIN_LOCK_MINUTES || '15', 10);

// Discord opcional
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

// Cliente Discord será criado apenas se as credenciais existirem
let discordClient = null;
if (DISCORD_BOT_TOKEN && DISCORD_CLIENT_ID) {
  discordClient = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
  });
}

// Banco de dados
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: IS_PRODUCTION ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
});

// ============================================================
// APP CONFIG
// ============================================================
app.disable('x-powered-by');
// [NOTA] 'trust proxy': 1 confia em 1 hop de proxy reverso. Se você estiver atrás de
// Cloudflare + outro proxy (2 hops), ajuste esse número, senão o IP usado para rate
// limit e bloqueio de IP pode ser forjável via X-Forwarded-For.
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser(COOKIE_SECRET));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// HELPERS GERAIS
// ============================================================
// Envolve rotas async para que erros caiam no error handler global em vez de
// derrubar o processo (unhandledRejection) ou travar a requisição sem resposta.
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function getClientIp(req) {
  return req.ip || req.connection?.remoteAddress || '';
}

// Hash do IP (não reversível) para uso em logs de atividade — protege privacidade
// mantendo a capacidade de detectar padrões de abuso (IPs repetidos/distintos).
function hashIp(ip) {
  return crypto.createHmac('sha256', COOKIE_SECRET).update(ip || '').digest('hex').substring(0, 32);
}

// ============================================================
// BLOQUEIO DE IP — aplicado ANTES de qualquer rota
// ============================================================
app.use(ah(async (req, res, next) => {
  const ip = getClientIp(req);
  if (!ip) return next();
  try {
    const r = await pool.query('SELECT ip FROM blocked_ips WHERE ip = $1', [ip]);
    if (r.rows.length) return res.status(403).send('Acesso bloqueado.');
  } catch {
    // se o banco estiver indisponível, não derruba a aplicação inteira por isso
  }
  next();
}));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: 'Muitas tentativas. Tente novamente mais tarde.' } });
const apiLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 300 });
const loaderLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 120 });
const keyLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 20, message: { success: false, message: 'Muitas tentativas, aguarde um momento.' } });
app.use('/api/', apiLimiter);

// ============================================================
// BANCO DE DADOS
// ============================================================
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_login TIMESTAMPTZ,
        failed_attempts INT DEFAULT 0,
        locked_until TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS services (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS scripts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT DEFAULT 'online',
        sandbox BOOLEAN DEFAULT false,
        silent BOOLEAN DEFAULT false,
        daily_limit INT DEFAULT 0,
        expires_at TIMESTAMPTZ,
        executions INT DEFAULT 0,
        short_id TEXT UNIQUE,
        token TEXT UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS script_versions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        script_id UUID REFERENCES scripts(id) ON DELETE CASCADE,
        name TEXT,
        content TEXT,
        status TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT UNIQUE NOT NULL,
        color TEXT DEFAULT '#6366f1'
      );

      CREATE TABLE IF NOT EXISTS script_tags (
        script_id UUID REFERENCES scripts(id) ON DELETE CASCADE,
        tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (script_id, tag_id)
      );

      CREATE TABLE IF NOT EXISTS execution_logs (
        id SERIAL PRIMARY KEY,
        script_id UUID REFERENCES scripts(id) ON DELETE SET NULL,
        ip TEXT,
        country TEXT DEFAULT 'Unknown',
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS blocked_ips (
        ip TEXT PRIMARY KEY,
        blocked_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        key TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        active BOOLEAN DEFAULT true,
        device_id TEXT,
        last_use TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS activations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        key_id UUID REFERENCES keys(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS key_logs (
        id SERIAL PRIMARY KEY,
        action TEXT NOT NULL,
        key TEXT,
        message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS discord_whitelist (
        discord_id TEXT NOT NULL,
        key_id UUID REFERENCES keys(id) ON DELETE CASCADE,
        activated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS discord_config (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS key_activity (
        id SERIAL PRIMARY KEY,
        key_id UUID REFERENCES keys(id) ON DELETE CASCADE,
        ip_hash TEXT,
        device_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS loader_tokens (
        token TEXT PRIMARY KEY,
        script_id UUID REFERENCES scripts(id) ON DELETE CASCADE,
        key_id UUID REFERENCES keys(id) ON DELETE SET NULL,
        device_id TEXT,
        ip_hash TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_key_activity_key_time ON key_activity (key_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_loader_tokens_expires ON loader_tokens (expires_at);
    `);

    // Migrações para colunas service_id (caso tabelas já existam)
    await client.query(`
      ALTER TABLE scripts ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE SET NULL;
      ALTER TABLE keys ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE SET NULL;
    `);

    // [FIX CRÍTICO] Antes disso, uma mesma key podia ser resgatada por várias contas
    // do Discord porque não existia nenhuma constraint única em discord_whitelist.
    // Primeiro removemos duplicatas existentes (mantendo o resgate mais antigo),
    // depois travamos a tabela com uma constraint única em key_id.
    await client.query(`
      DELETE FROM discord_whitelist a USING discord_whitelist b
      WHERE a.key_id = b.key_id AND a.ctid > b.ctid;
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uq_discord_whitelist_key'
        ) THEN
          ALTER TABLE discord_whitelist ADD CONSTRAINT uq_discord_whitelist_key UNIQUE (key_id);
        END IF;
      END $$;
    `);

    console.log('✅ Banco de dados inicializado e migrado');
  } finally {
    client.release();
  }
}

// Limpeza periódica de tokens de sessão expirados e atividade antiga (privacidade + espaço)
setInterval(() => {
  pool.query("DELETE FROM loader_tokens WHERE expires_at < NOW() - INTERVAL '1 hour'").catch(() => {});
}, 15 * 60 * 1000);
setInterval(() => {
  pool.query("DELETE FROM key_activity WHERE created_at < NOW() - INTERVAL '30 days'").catch(() => {});
}, 24 * 60 * 60 * 1000);

// ============================================================
// MIDDLEWARE DE AUTENTICAÇÃO
// ============================================================
function auth(req, res, next) {
  const token = req.signedCookies?.token || req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Token ausente' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('token');
    res.status(401).json({ error: 'Sessão expirada' });
  }
}

// ============================================================
// HELPERS
// ============================================================
function shortId() { return crypto.randomBytes(8).toString('hex'); }
function secureToken() { return crypto.randomBytes(16).toString('hex'); }
function generateKey() {
  const segs = [];
  for (let i = 0; i < 4; i++) segs.push(crypto.randomBytes(2).toString('hex').toUpperCase().substring(0, 4));
  return `STORM-${segs.join('-')}`;
}

async function logKeyAction(action, key, message) {
  try { await pool.query('INSERT INTO key_logs (action, key, message) VALUES ($1,$2,$3)', [action, key, message]); } catch {}
}

async function sendDiscordLog(message) {
  if (!discordClient) return;
  try {
    const channelId = (await pool.query("SELECT value FROM discord_config WHERE key = 'log_channel'")).rows[0]?.value;
    if (!channelId) return;
    const channel = await discordClient.channels.fetch(channelId);
    if (channel) await channel.send(message);
  } catch {}
}

async function sendDiscordEmbed({ title, description, banner, thumbnail, scriptName }) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    await axios.post(DISCORD_WEBHOOK_URL, {
      embeds: [{
        title: title || `${scriptName} foi atualizado!`,
        description: description || 'Veja as novidades.',
        color: 0x6366f1,
        timestamp: new Date().toISOString(),
        footer: { text: 'Storm Hub' },
        image: banner ? { url: banner } : undefined,
        thumbnail: thumbnail ? { url: thumbnail } : undefined
      }]
    }, { timeout: 5000 });
  } catch (err) { console.error('[DISCORD]', err.message); }
}

// [PROTEÇÃO] Registra atividade de uma key e auto-revoga se detectar uso a partir
// de muitos IPs distintos em uma janela curta de tempo — pega compartilhamento de
// key mesmo quando o device_id em si não pega (ex: cliente forjando o device).
async function recordKeyActivity(keyId, ipHash, deviceId) {
  if (!keyId) return;
  try {
    await pool.query('INSERT INTO key_activity (key_id, ip_hash, device_id) VALUES ($1,$2,$3)', [keyId, ipHash, deviceId || null]);
    const distinct = await pool.query(
      `SELECT COUNT(DISTINCT ip_hash) AS c FROM key_activity WHERE key_id = $1 AND created_at > NOW() - ($2 || ' minutes')::interval`,
      [keyId, ABUSE_WINDOW_MINUTES]
    );
    const distinctIps = parseInt(distinct.rows[0].c, 10);
    if (distinctIps >= ABUSE_IP_THRESHOLD) {
      await pool.query('UPDATE keys SET active = false WHERE id = $1', [keyId]);
      await logKeyAction('auto_revoke', keyId, `Revogada automaticamente: uso a partir de ${distinctIps} IPs distintos em ${ABUSE_WINDOW_MINUTES} min`);
      await sendDiscordLog(`🚨 Key \`${keyId}\` revogada automaticamente por suspeita de compartilhamento (${distinctIps} IPs distintos em ${ABUSE_WINDOW_MINUTES} min).`);
    }
  } catch (err) {
    console.error('[KEY_ACTIVITY]', err.message);
  }
}

// ============================================================
// AUTENTICAÇÃO
// ============================================================
app.post('/api/auth/login', loginLimiter, ah(async (req, res) => {
  const { username, password } = req.body;
  if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
    return res.redirect(`${ADMIN_PATH}?error=1`);
  }

  const result = await pool.query('SELECT * FROM admins WHERE LOWER(username) = LOWER($1)', [username]);
  const admin = result.rows[0];
  const FAKE_HASH = '$2a$10$7EqJtq98hPqEX7fNZaFWoOHi5xJYq7u9fN5F5NeLSd851qwL2mM5e';

  if (!admin) {
    await bcrypt.compare(password, FAKE_HASH);
    return res.redirect(`${ADMIN_PATH}?error=1`);
  }

  // [FIX] failed_attempts/locked_until já existiam no schema mas nunca eram checados.
  if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
    return res.redirect(`${ADMIN_PATH}?error=locked`);
  }

  const validPassword = await bcrypt.compare(password, admin.password_hash);
  if (!validPassword) {
    const attempts = admin.failed_attempts + 1;
    const lockUntil = attempts >= LOGIN_MAX_ATTEMPTS ? new Date(Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000) : null;
    await pool.query('UPDATE admins SET failed_attempts = $1, locked_until = $2 WHERE id = $3', [attempts, lockUntil, admin.id]);
    return res.redirect(`${ADMIN_PATH}?error=1`);
  }

  await pool.query('UPDATE admins SET failed_attempts = 0, locked_until = NULL, last_login = NOW() WHERE id = $1', [admin.id]);
  const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role }, JWT_SECRET, { expiresIn: '8h' });
  res.cookie('token', token, { httpOnly: true, secure: IS_PRODUCTION, sameSite: 'lax', path: '/', signed: true });
  return res.redirect(`${ADMIN_PATH}/dashboard`);
}));

app.get('/api/auth/logout', (req, res) => { res.clearCookie('token'); res.redirect(ADMIN_PATH); });
app.get('/api/auth/me', auth, ah(async (req, res) => {
  const r = await pool.query('SELECT username, role FROM admins WHERE id = $1', [req.user.id]);
  res.json(r.rows[0] || {});
}));

// ============================================================
// BLOQUEIO DE IP (gerenciamento via painel)
// ============================================================
app.get('/api/admin/blocked-ips', auth, ah(async (req, res) => {
  const result = await pool.query('SELECT ip, blocked_at FROM blocked_ips ORDER BY blocked_at DESC');
  res.json(result.rows);
}));
app.post('/api/admin/block-ip', auth, ah(async (req, res) => {
  const { ip } = req.body;
  if (!ip || typeof ip !== 'string') return res.status(400).json({ error: 'IP obrigatório' });
  await pool.query('INSERT INTO blocked_ips (ip) VALUES ($1) ON CONFLICT (ip) DO NOTHING', [ip]);
  res.json({ success: true });
}));
app.delete('/api/admin/block-ip/:ip', auth, ah(async (req, res) => {
  await pool.query('DELETE FROM blocked_ips WHERE ip = $1', [req.params.ip]);
  res.json({ success: true });
}));

// ============================================================
// SERVIÇOS (CRUD)
// ============================================================
app.get('/api/services', auth, ah(async (req, res) => {
  const r = await pool.query(`
    SELECT s.*,
      (SELECT COUNT(*) FROM keys WHERE service_id = s.id AND active = true) AS active_keys
    FROM services s
    ORDER BY s.created_at DESC
  `);
  res.json(r.rows);
}));
app.get('/api/services/:id', auth, ah(async (req, res) => {
  const r = await pool.query('SELECT * FROM services WHERE id = $1', [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Serviço não encontrado' });
  res.json(r.rows[0]);
}));
app.post('/api/services', auth, ah(async (req, res) => {
  const { name, description } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Nome obrigatório' });
  const r = await pool.query('INSERT INTO services (name, description) VALUES ($1,$2) RETURNING *', [name.trim(), description?.trim() || '']);
  res.status(201).json(r.rows[0]);
}));
app.put('/api/services/:id', auth, ah(async (req, res) => {
  const { name, description } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Nome obrigatório' });
  const r = await pool.query('UPDATE services SET name=$1, description=$2 WHERE id=$3 RETURNING *', [name.trim(), description?.trim() || '', req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Serviço não encontrado' });
  res.json(r.rows[0]);
}));
app.delete('/api/services/:id', auth, ah(async (req, res) => {
  await pool.query('DELETE FROM services WHERE id = $1', [req.params.id]);
  res.json({ success: true });
}));

// ============================================================
// SCRIPTS (CRUD, versões, changelog, bulk, export/import)
// ============================================================
const SORTABLE_SCRIPT_COLUMNS = new Set(['name', 'status', 'created_at', 'updated_at', 'executions']);

app.get('/api/scripts', auth, ah(async (req, res) => {
  const page = parseInt(req.query.page) || 1, limit = Math.min(parseInt(req.query.limit) || 25, 200), offset = (page - 1) * limit;
  // [FIX] sort/order antes iam direto para a query SQL sem validação (SQL injection).
  const sort = SORTABLE_SCRIPT_COLUMNS.has(req.query.sort) ? req.query.sort : 'updated_at';
  const order = (req.query.order || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const status = req.query.status, tag = req.query.tag;

  let conds = [], params = [];
  if (status) { conds.push(`s.status = $${params.length+1}`); params.push(status); }
  if (tag) { conds.push(`s.id IN (SELECT script_id FROM script_tags WHERE tag_id = $${params.length+1})`); params.push(tag); }
  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';

  try {
    const dataQuery = `
      SELECT s.*,
        COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color)) FILTER (WHERE t.id IS NOT NULL), '[]') AS tags,
        (SELECT row_to_json(svc) FROM services svc WHERE svc.id = s.service_id) AS service
      FROM scripts s
      LEFT JOIN script_tags st ON s.id = st.script_id
      LEFT JOIN tags t ON st.tag_id = t.id
      ${where}
      GROUP BY s.id
      ORDER BY s.${sort} ${order}
      LIMIT $${params.length+1} OFFSET $${params.length+2}
    `;
    const countQuery = `SELECT COUNT(*) FROM scripts s ${where}`;
    const countParams = [...params];
    params.push(limit, offset);

    const [dataRes, countRes] = await Promise.all([
      pool.query(dataQuery, params),
      pool.query(countQuery, countParams)
    ]);
    const total = parseInt(countRes.rows[0].count);
    res.json({ data: dataRes.rows, page, totalPages: Math.ceil(total / limit), total });
  } catch (err) {
    console.error('Erro ao buscar scripts:', err);
    res.status(500).json({ error: 'Erro ao buscar scripts' });
  }
}));

app.get('/api/scripts/:id', auth, ah(async (req, res) => {
  const r = await pool.query(`
    SELECT s.*,
      COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color)) FILTER (WHERE t.id IS NOT NULL), '[]') AS tags
    FROM scripts s
    LEFT JOIN script_tags st ON s.id = st.script_id
    LEFT JOIN tags t ON st.tag_id = t.id
    WHERE s.id = $1
    GROUP BY s.id
  `, [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Script não encontrado' });
  res.json(r.rows[0]);
}));

app.post('/api/scripts', auth, ah(async (req, res) => {
  const { name, content, status, sandbox, silent, daily_limit, expires_at, tags, service_id } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'Nome e conteúdo obrigatórios' });

  const id = uuidv4(), short_id = shortId(), token = secureToken();
  await pool.query(
    `INSERT INTO scripts (id, name, content, status, sandbox, silent, daily_limit, expires_at, short_id, token, service_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, name.trim(), content, status || 'online', sandbox || false, silent || false, daily_limit || 0, expires_at || null, short_id, token, service_id || null]
  );
  if (Array.isArray(tags)) {
    for (const tagName of tags) {
      let tr = await pool.query('INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id', [tagName.trim()]);
      if (!tr.rows.length) tr = await pool.query('SELECT id FROM tags WHERE name = $1', [tagName.trim()]);
      await pool.query('INSERT INTO script_tags (script_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, tr.rows[0].id]);
    }
  }
  const newScript = await pool.query('SELECT * FROM scripts WHERE id = $1', [id]);
  res.status(201).json(newScript.rows[0]);
}));

app.put('/api/scripts/:id', auth, ah(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const old = (await client.query('SELECT * FROM scripts WHERE id = $1', [req.params.id])).rows[0];
    if (!old) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Script não encontrado' }); }

    await client.query('INSERT INTO script_versions (script_id, name, content, status) VALUES ($1,$2,$3,$4)', [old.id, old.name, old.content, old.status]);

    const { name, content, status, sandbox, silent, daily_limit, expires_at, tags, service_id } = req.body;
    const newData = {
      name: name !== undefined ? name.trim() : old.name,
      content: content !== undefined ? content : old.content,
      status: status !== undefined ? status : old.status,
      sandbox: sandbox !== undefined ? sandbox : old.sandbox,
      silent: silent !== undefined ? silent : old.silent,
      daily_limit: daily_limit !== undefined ? daily_limit : old.daily_limit,
      expires_at: expires_at !== undefined ? expires_at : old.expires_at,
      service_id: service_id !== undefined ? service_id : old.service_id,
    };

    await client.query(
      `UPDATE scripts SET name=$1, content=$2, status=$3, sandbox=$4, silent=$5, daily_limit=$6, expires_at=$7, service_id=$8, updated_at=NOW() WHERE id=$9`,
      [newData.name, newData.content, newData.status, newData.sandbox, newData.silent, newData.daily_limit, newData.expires_at, newData.service_id, old.id]
    );

    if (Array.isArray(tags)) {
      await client.query('DELETE FROM script_tags WHERE script_id = $1', [old.id]);
      for (const tagName of tags) {
        let tr = await client.query('INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id', [tagName.trim()]);
        if (!tr.rows.length) tr = await client.query('SELECT id FROM tags WHERE name = $1', [tagName.trim()]);
        await client.query('INSERT INTO script_tags (script_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [old.id, tr.rows[0].id]);
      }
    }

    await client.query('COMMIT');
    res.json({ ...old, ...newData, id: old.id });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
}));

app.delete('/api/scripts/:id', auth, ah(async (req, res) => {
  await pool.query('DELETE FROM scripts WHERE id = $1', [req.params.id]);
  res.json({ success: true });
}));

app.post('/api/scripts/:id/duplicate', auth, ah(async (req, res) => {
  const original = (await pool.query('SELECT * FROM scripts WHERE id = $1', [req.params.id])).rows[0];
  if (!original) return res.status(404).json({ error: 'Script não encontrado' });
  const newId = uuidv4(), newShort = shortId(), newToken = secureToken();
  await pool.query(
    `INSERT INTO scripts (id, name, content, status, sandbox, silent, daily_limit, expires_at, short_id, token, service_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [newId, `${original.name} (cópia)`, original.content, original.status, original.sandbox, original.silent, original.daily_limit, original.expires_at, newShort, newToken, original.service_id]
  );
  res.json({ success: true });
}));

app.post('/api/scripts/bulk', auth, ah(async (req, res) => {
  const { scripts } = req.body;
  if (!Array.isArray(scripts) || scripts.length > 200) return res.status(400).json({ error: 'Formato inválido (máx. 200 por vez)' });
  for (const s of scripts) {
    const id = uuidv4(), short = shortId(), token = secureToken();
    await pool.query('INSERT INTO scripts (id, name, content, short_id, token) VALUES ($1,$2,$3,$4,$5)', [id, s.name, s.content, short, token]);
  }
  res.json({ success: true });
}));

app.get('/api/scripts/:id/versions', auth, ah(async (req, res) => {
  const r = await pool.query('SELECT * FROM script_versions WHERE script_id = $1 ORDER BY created_at DESC', [req.params.id]);
  res.json(r.rows);
}));

app.post('/api/scripts/:id/restore', auth, ah(async (req, res) => {
  const { versionId } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const version = (await client.query('SELECT * FROM script_versions WHERE id = $1', [versionId])).rows[0];
    if (!version) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Versão não encontrada' }); }
    const current = (await client.query('SELECT * FROM scripts WHERE id = $1', [req.params.id])).rows[0];
    await client.query('INSERT INTO script_versions (script_id, name, content, status) VALUES ($1,$2,$3,$4)', [current.id, current.name, current.content, current.status]);
    await client.query('UPDATE scripts SET name=$1, content=$2, status=$3, updated_at=NOW() WHERE id=$4', [version.name, version.content, version.status, current.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
}));

app.post('/api/scripts/:id/changelog', auth, ah(async (req, res) => {
  const { title, description } = req.body;
  const script = (await pool.query('SELECT name FROM scripts WHERE id = $1', [req.params.id])).rows[0];
  if (!script) return res.status(404).json({ error: 'Script não encontrado' });
  await sendDiscordEmbed({ title, description, scriptName: script.name });
  res.json({ success: true });
}));

app.get('/api/tags', auth, ah(async (req, res) => {
  const r = await pool.query('SELECT * FROM tags ORDER BY name');
  res.json(r.rows);
}));

app.get('/api/export', auth, ah(async (req, res) => {
  const [scripts, tags, relations] = await Promise.all([
    pool.query('SELECT * FROM scripts'),
    pool.query('SELECT * FROM tags'),
    pool.query('SELECT * FROM script_tags'),
  ]);
  res.json({ scripts: scripts.rows, tags: tags.rows, relations: relations.rows });
}));

app.post('/api/import', auth, ah(async (req, res) => {
  const { scripts, tags, relations, confirmation } = req.body;
  if (confirmation !== 'IMPORTAR') return res.status(400).json({ error: 'Confirmação necessária' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (Array.isArray(scripts)) {
      for (const s of scripts) {
        await client.query(
          `INSERT INTO scripts (id, name, content, status, sandbox, silent, daily_limit, expires_at, short_id, token, service_id, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
          [s.id, s.name, s.content, s.status, s.sandbox, s.silent, s.daily_limit, s.expires_at, s.short_id, s.token, s.service_id, s.created_at, s.updated_at]
        );
      }
    }
    if (Array.isArray(tags)) for (const t of tags) await client.query('INSERT INTO tags (id, name, color) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [t.id, t.name, t.color]);
    if (Array.isArray(relations)) for (const r of relations) await client.query('INSERT INTO script_tags (script_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [r.script_id, r.tag_id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
}));

// ============================================================
// KEYS (CRUD + bulk)
// ============================================================
app.post('/api/keys', auth, ah(async (req, res) => {
  const { duration, service_id } = req.body;
  if (!service_id) return res.status(400).json({ error: 'service_id obrigatório' });
  const svc = await pool.query('SELECT id FROM services WHERE id = $1', [service_id]);
  if (!svc.rows.length) return res.status(400).json({ error: 'Serviço não encontrado' });
  const key = generateKey();
  const expires_at = duration > 0 ? new Date(Date.now() + duration * 86400000).toISOString() : null;
  const r = await pool.query('INSERT INTO keys (key, service_id, expires_at, active) VALUES ($1,$2,$3,true) RETURNING *', [key, service_id, expires_at]);
  await logKeyAction('create', key, `Key criada (serviço ${service_id})`);
  res.status(201).json(r.rows[0]);
}));

app.post('/api/keys/bulk', auth, ah(async (req, res) => {
  const { service_id, count = 1, duration } = req.body;
  const n = parseInt(count, 10);
  if (!service_id || !Number.isInteger(n) || n < 1 || n > 200) {
    return res.status(400).json({ error: 'service_id obrigatório e count deve ser entre 1 e 200' });
  }
  const svc = await pool.query('SELECT id FROM services WHERE id = $1', [service_id]);
  if (!svc.rows.length) return res.status(400).json({ error: 'Serviço não encontrado' });
  const expires_at = duration > 0 ? new Date(Date.now() + duration * 86400000).toISOString() : null;
  const keys = [];
  for (let i = 0; i < n; i++) {
    const key = generateKey();
    await pool.query('INSERT INTO keys (key, service_id, expires_at, active) VALUES ($1,$2,$3,true)', [key, service_id, expires_at]);
    await logKeyAction('create', key, `Key em lote (serviço ${service_id})`);
    keys.push(key);
  }
  res.status(201).json({ keys, service_id, count: n });
}));

app.get('/api/keys', auth, ah(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 25, 200);
  const offset = (page - 1) * limit;
  const status = req.query.status;
  const service_id = req.query.service_id;

  let conds = [], params = [];
  if (status === 'active') conds.push('k.active = true AND (k.expires_at IS NULL OR k.expires_at > NOW())');
  else if (status === 'expired') conds.push('k.active = true AND k.expires_at IS NOT NULL AND k.expires_at <= NOW()');
  else if (status === 'revoked') conds.push('k.active = false');
  if (service_id) { conds.push(`k.service_id = $${params.length+1}`); params.push(service_id); }

  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';

  const dataQuery = `
    SELECT k.*,
      (SELECT row_to_json(s) FROM services s WHERE s.id = k.service_id) AS service,
      EXISTS (SELECT 1 FROM discord_whitelist WHERE key_id = k.id) AS redeemed
    FROM keys k ${where}
    ORDER BY k.created_at DESC
    LIMIT $${params.length+1} OFFSET $${params.length+2}
  `;
  const countQuery = `SELECT COUNT(*) FROM keys k ${where}`;
  const countParams = [...params];
  params.push(limit, offset);

  const [dataRes, countRes] = await Promise.all([
    pool.query(dataQuery, params),
    pool.query(countQuery, countParams)
  ]);

  const total = parseInt(countRes.rows[0].count);
  res.json({ data: dataRes.rows, page, totalPages: Math.ceil(total / limit), total });
}));

// [FIX] Verificação de key: binding de device_id agora é atômico (evita corrida
// entre duas requisições simultâneas "vencendo" a mesma key), e a atividade é
// registrada para detecção de abuso por diversidade de IP.
app.post('/api/keys/verify', keyLimiter, ah(async (req, res) => {
  const { key, deviceId } = req.body;
  if (!key || typeof key !== 'string') return res.status(400).json({ success: false, message: 'Key obrigatória' });

  const ipHash = hashIp(getClientIp(req));

  const r = await pool.query('SELECT * FROM keys WHERE key = $1', [key]);
  if (!r.rows.length) {
    await logKeyAction('verify_fail', key, 'não encontrada');
    return res.status(404).json({ success: false, message: 'Key inválida' });
  }
  let k = r.rows[0];
  if (!k.active) {
    await logKeyAction('verify_fail', key, 'revogada');
    return res.status(403).json({ success: false, message: 'Key revogada' });
  }
  if (k.expires_at && new Date(k.expires_at) < new Date()) {
    await pool.query('UPDATE keys SET active = false WHERE id = $1', [k.id]);
    await logKeyAction('expire', key, 'expirada');
    return res.status(403).json({ success: false, message: 'Key expirada' });
  }

  if (deviceId) {
    if (!k.device_id) {
      const claim = await pool.query(
        'UPDATE keys SET device_id = $1, last_use = NOW() WHERE id = $2 AND device_id IS NULL RETURNING *',
        [deviceId, k.id]
      );
      if (claim.rows.length) {
        k = claim.rows[0];
        await pool.query('INSERT INTO activations (key_id, device_id) VALUES ($1,$2)', [k.id, deviceId]);
        await logKeyAction('activate', key, `vinculada ao device ${deviceId}`);
      } else {
        // outra requisição venceu a corrida entre o SELECT e o UPDATE — recarrega o estado atual
        k = (await pool.query('SELECT * FROM keys WHERE id = $1', [k.id])).rows[0];
      }
    }
    if (k.device_id !== deviceId) {
      await logKeyAction('verify_fail', key, `device mismatch: esperado ${k.device_id}, recebido ${deviceId}`);
      return res.status(403).json({ success: false, message: 'Device mismatch' });
    }
  }

  await pool.query('UPDATE keys SET last_use = NOW() WHERE id = $1', [k.id]);
  await recordKeyActivity(k.id, ipHash, deviceId);
  await logKeyAction('verify', key, 'sucesso');
  res.json({ success: true, key: { id: k.id, expires_at: k.expires_at, device_id: k.device_id, service_id: k.service_id } });
}));

app.get('/api/keys/:id', auth, ah(async (req, res) => {
  const r = await pool.query('SELECT k.*, (SELECT row_to_json(s) FROM services s WHERE s.id = k.service_id) AS service, EXISTS (SELECT 1 FROM discord_whitelist WHERE key_id = k.id) AS redeemed FROM keys k WHERE id = $1', [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Key não encontrada' });
  res.json(r.rows[0]);
}));

app.post('/api/keys/:id/revoke', auth, ah(async (req, res) => {
  await pool.query('UPDATE keys SET active = false WHERE id = $1', [req.params.id]);
  await logKeyAction('revoke', req.params.id, 'Key revogada');
  res.json({ success: true });
}));

app.post('/api/keys/:id/renew', auth, ah(async (req, res) => {
  const { days } = req.body;
  const key = (await pool.query('SELECT * FROM keys WHERE id = $1', [req.params.id])).rows[0];
  if (!key) return res.status(404).json({ error: 'Key não encontrada' });
  const newExpiry = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
  await pool.query('UPDATE keys SET expires_at = $1, active = true WHERE id = $2', [newExpiry, key.id]);
  await logKeyAction('renew', key.key, `Renovada por ${days} dias`);
  res.json({ success: true });
}));

app.delete('/api/keys/:id', auth, ah(async (req, res) => {
  await pool.query('DELETE FROM keys WHERE id = $1', [req.params.id]);
  await logKeyAction('delete', req.params.id, 'Key excluída');
  res.json({ success: true });
}));

// ============================================================
// LOADER EM DOIS ESTÁGIOS
// ============================================================
// [FIX CRÍTICO] Antes, a 2ª etapa (/api/script/:id) entregava o conteúdo do script
// para QUALQUER pessoa que soubesse o UUID do script, sem checar key nem device.
// Isso significava que, uma vez obtido esse link, ele funcionava para sempre e
// para qualquer pessoa — a validação de key da 1ª etapa era só decorativa.
// Agora a 1ª etapa gera um token de sessão de uso único, válido por 60s, e a 2ª
// etapa exige e consome esse token.
app.get('/api/loader/:short/:token', loaderLimiter, ah(async (req, res) => {
  if (MAINTENANCE_MODE) return res.status(503).send('Em manutenção.');
  const { short, token } = req.params;
  const { key, device } = req.query;
  const ipHash = hashIp(getClientIp(req));

  const script = (await pool.query('SELECT * FROM scripts WHERE short_id = $1 AND token = $2', [short, token])).rows[0];
  if (!script) return res.status(404).send('Script não encontrado.');
  if (script.status !== 'online') return res.status(403).send('Script indisponível.');

  let keyId = null;

  if (script.service_id) {
    if (!key) return res.status(403).send('Key obrigatória para este script.');
    const keyRes = await pool.query('SELECT * FROM keys WHERE key = $1', [key]);
    if (!keyRes.rows.length) return res.status(403).send('Key inválida.');
    let k = keyRes.rows[0];
    if (!k.active) return res.status(403).send('Key revogada.');
    if (k.expires_at && new Date(k.expires_at) < new Date()) {
      await pool.query('UPDATE keys SET active = false WHERE id = $1', [k.id]);
      return res.status(403).send('Key expirada.');
    }
    if (k.service_id !== script.service_id) return res.status(403).send('Key não pertence a este serviço.');

    if (device) {
      if (!k.device_id) {
        const claim = await pool.query(
          'UPDATE keys SET device_id = $1, last_use = NOW() WHERE id = $2 AND device_id IS NULL RETURNING *',
          [device, k.id]
        );
        if (claim.rows.length) {
          k = claim.rows[0];
          await pool.query('INSERT INTO activations (key_id, device_id) VALUES ($1,$2)', [k.id, device]);
          await logKeyAction('activate', key, `vinculada ao device ${device}`);
        } else {
          k = (await pool.query('SELECT * FROM keys WHERE id = $1', [k.id])).rows[0];
        }
      }
      if (k.device_id !== device) {
        await logKeyAction('verify_fail', key, `device mismatch: esperado ${k.device_id}, recebido ${device}`);
        return res.status(403).send('Device mismatch.');
      }
    }

    await pool.query('UPDATE keys SET last_use = NOW() WHERE id = $1', [k.id]);
    await recordKeyActivity(k.id, ipHash, device);
    keyId = k.id;
  }

  const sessionToken = crypto.randomBytes(24).toString('hex');
  await pool.query(
    `INSERT INTO loader_tokens (token, script_id, key_id, device_id, ip_hash, expires_at)
     VALUES ($1,$2,$3,$4,$5, NOW() + INTERVAL '60 seconds')`,
    [sessionToken, script.id, keyId, device || null, ipHash]
  );

  const secondLoader = `loadstring(game:HttpGet("${req.protocol}://${req.get('host')}/api/script/${script.id}?t=${sessionToken}"))()`;
  res.type('text/plain').send(secondLoader);
}));

app.get('/api/script/:id', loaderLimiter, ah(async (req, res) => {
  const { t } = req.query;
  if (!t || typeof t !== 'string') return res.status(403).send('Token de sessão ausente.');

  // Consumo atômico: marca como usado e só serve o conteúdo se essa foi a
  // primeira (e única) vez que o token foi usado, dentro da validade.
  const claim = await pool.query(
    `UPDATE loader_tokens SET used = true
     WHERE token = $1 AND script_id = $2 AND used = false AND expires_at > NOW()
     RETURNING *`,
    [t, req.params.id]
  );
  if (!claim.rows.length) return res.status(403).send('Token inválido, expirado ou já utilizado.');

  const script = (await pool.query('SELECT content FROM scripts WHERE id = $1 AND status = $2', [req.params.id, 'online'])).rows[0];
  if (!script) return res.status(404).send('Script indisponível.');
  res.type('text/plain').send(script.content);
}));

// ============================================================
// ESTATÍSTICAS & ALERTAS
// ============================================================
app.get('/api/stats', auth, ah(async (req, res) => {
  const total = (await pool.query('SELECT COUNT(*) FROM scripts')).rows[0].count;
  const online = (await pool.query('SELECT COUNT(*) FROM scripts WHERE status = $1', ['online'])).rows[0].count;
  const offline = (await pool.query('SELECT COUNT(*) FROM scripts WHERE status = $1', ['offline'])).rows[0].count;
  const totalExec = (await pool.query('SELECT SUM(executions) FROM scripts')).rows[0].sum || 0;
  const popular = (await pool.query('SELECT name, executions FROM scripts ORDER BY executions DESC LIMIT 5')).rows;
  const daily = (await pool.query(`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM execution_logs
    WHERE created_at > NOW() - INTERVAL '7 days'
    GROUP BY date ORDER BY date
  `)).rows;
  const keyStats = {
    total: parseInt((await pool.query('SELECT COUNT(*) FROM keys')).rows[0].count),
    active: parseInt((await pool.query('SELECT COUNT(*) FROM keys WHERE active = true AND (expires_at IS NULL OR expires_at > NOW())')).rows[0].count),
    expired: parseInt((await pool.query('SELECT COUNT(*) FROM keys WHERE active = true AND expires_at IS NOT NULL AND expires_at <= NOW()')).rows[0].count),
    revoked: parseInt((await pool.query('SELECT COUNT(*) FROM keys WHERE active = false')).rows[0].count),
    activationsToday: parseInt((await pool.query('SELECT COUNT(*) FROM activations WHERE DATE(created_at) = CURRENT_DATE')).rows[0].count),
  };
  res.json({
    totalScripts: parseInt(total),
    onlineScripts: parseInt(online),
    offlineScripts: parseInt(offline),
    totalExecutions: parseInt(totalExec),
    popular,
    daily,
    keyStats
  });
}));

app.get('/api/alerts', auth, ah(async (req, res) => {
  const offline = (await pool.query('SELECT name FROM scripts WHERE status = $1', ['offline'])).rows;
  const expiring = (await pool.query(`
    SELECT name, expires_at FROM scripts
    WHERE expires_at IS NOT NULL AND expires_at <= NOW() + INTERVAL '3 days' AND expires_at > NOW()
  `)).rows;
  res.json({ offline, expiring });
}));

app.get('/api/stats/export', auth, ah(async (req, res) => {
  const format = req.query.format || 'json';
  const stats = (await pool.query('SELECT * FROM execution_logs ORDER BY created_at DESC LIMIT 10000')).rows;
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="storm_stats.csv"');
    // Escapa campos para evitar quebra de CSV e "CSV injection" em planilhas (=, +, -, @)
    const esc = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    let csv = 'id,script_id,ip,country,user_agent,created_at\n';
    stats.forEach(r => csv += `${esc(r.id)},${esc(r.script_id)},${esc(r.ip)},${esc(r.country)},${esc(r.user_agent)},${esc(r.created_at)}\n`);
    return res.send(csv);
  }
  res.json(stats);
}));

// ============================================================
// PÁGINAS ESTÁTICAS
// ============================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get(ADMIN_PATH, (req, res) => res.sendFile(path.join(__dirname, 'public/admin/login.html')));
app.get(`${ADMIN_PATH}/dashboard`, auth, (req, res) => res.sendFile(path.join(__dirname, 'public/admin/dashboard.html')));

// ============================================================
// DISCORD BOT
// ============================================================
if (discordClient) {
  discordClient.once('ready', async () => {
    console.log(`🤖 Bot Discord logado como ${discordClient.user.tag}`);

    const commands = [
      new SlashCommandBuilder()
        .setName('redeem')
        .setDescription('Resgata uma key e libera seu acesso ao script')
        .addStringOption(opt => opt.setName('key').setDescription('Sua key').setRequired(true)),
      new SlashCommandBuilder()
        .setName('getscript')
        .setDescription('Recebe o script (apenas para usuários com key resgatada)')
        .addStringOption(opt => opt.setName('script').setDescription('Nome do script (ex: kaitun)').setRequired(true)),
      new SlashCommandBuilder()
        .setName('resethwid')
        .setDescription('Reseta o device ID de uma key (Admin)')
        .addStringOption(opt => opt.setName('key').setDescription('Key a resetar').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
      new SlashCommandBuilder()
        .setName('setlogs')
        .setDescription('Define o canal onde as logs serão enviadas (Admin)')
        .addChannelOption(opt => opt.setName('channel').setDescription('Canal de texto').setRequired(true).addChannelTypes(ChannelType.GuildText))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    ];

    try {
      if (DISCORD_GUILD_ID) {
        const guild = await discordClient.guilds.fetch(DISCORD_GUILD_ID);
        await guild.commands.set(commands);
      } else {
        await discordClient.application.commands.set(commands);
      }
      console.log('✅ Comandos do Discord registrados');
    } catch (error) {
      console.error('Erro ao registrar comandos:', error);
    }
  });

  discordClient.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    const { commandName } = interaction;

    if (commandName === 'redeem') {
      const keyInput = interaction.options.getString('key');
      try {
        const r = await pool.query('SELECT * FROM keys WHERE key = $1', [keyInput]);
        if (!r.rows.length) return interaction.reply({ content: 'Key inválida.', ephemeral: true });
        const k = r.rows[0];
        if (!k.active) return interaction.reply({ content: 'Key já foi revogada.', ephemeral: true });
        if (k.expires_at && new Date(k.expires_at) < new Date()) {
          await pool.query('UPDATE keys SET active = false WHERE id = $1', [k.id]);
          return interaction.reply({ content: 'Key expirada.', ephemeral: true });
        }

        // [FIX CRÍTICO] Antes disso, esse insert usava "ON CONFLICT DO NOTHING" sem
        // nenhuma constraint única existir na tabela — ou seja, nunca havia conflito,
        // e QUALQUER pessoa podia resgatar a mesma key. Agora a constraint única em
        // key_id garante, de forma atômica, que só a primeira conta a resgatar vence.
        const claim = await pool.query(
          'INSERT INTO discord_whitelist (discord_id, key_id) VALUES ($1,$2) ON CONFLICT (key_id) DO NOTHING RETURNING *',
          [interaction.user.id, k.id]
        );
        if (!claim.rows.length) {
          const existing = await pool.query('SELECT discord_id FROM discord_whitelist WHERE key_id = $1', [k.id]);
          if (existing.rows[0]?.discord_id === interaction.user.id) {
            return interaction.reply({ content: 'Você já resgatou esta key anteriormente.', ephemeral: true });
          }
          await logKeyAction('redeem_blocked', keyInput, `Tentativa de resgate duplicado por ${interaction.user.tag}`);
          return interaction.reply({ content: 'Esta key já foi resgatada por outra conta.', ephemeral: true });
        }

        await logKeyAction('redeem_discord', keyInput, `Resgatada por ${interaction.user.tag}`);

        const roleId = '1520882321618632936';
        if (interaction.member && roleId) {
          try { await interaction.member.roles.add(roleId); } catch (e) {}
        }

        await sendDiscordLog(`✅ ${interaction.user.tag} resgatou a key \`${keyInput}\``);
        interaction.reply({ content: 'Key resgatada com sucesso! Agora você pode usar /getscript.', ephemeral: true });
      } catch (err) {
        console.error('[REDEEM]', err);
        interaction.reply({ content: 'Erro ao processar.', ephemeral: true });
      }
    }

    else if (commandName === 'getscript') {
      const wl = await pool.query('SELECT key_id FROM discord_whitelist WHERE discord_id = $1', [interaction.user.id]);
      if (!wl.rows.length) return interaction.reply({ content: 'Você não resgatou nenhuma key. Use /redeem primeiro.', ephemeral: true });

      let valid = false;
      for (const row of wl.rows) {
        const k = (await pool.query('SELECT * FROM keys WHERE id = $1', [row.key_id])).rows[0];
        if (k && k.active && (!k.expires_at || new Date(k.expires_at) > new Date())) {
          valid = true;
          break;
        }
      }
      if (!valid) return interaction.reply({ content: 'Sua key expirou ou foi revogada.', ephemeral: true });

      const row = new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('script_select')
            .setPlaceholder('Selecione o script desejado')
            .addOptions([
              { label: 'Main', value: 'main' },
              { label: 'Kaitun', value: 'kaitun' }
            ])
        );

      const embed = new EmbedBuilder()
        .setTitle('Seleção de Script')
        .setDescription('Escolha qual script deseja receber:')
        .setColor(0x6366f1);

      const msg = await interaction.reply({ embeds: [embed], components: [row], ephemeral: true, fetchReply: true });

      const filter = i => i.customId === 'script_select' && i.user.id === interaction.user.id;
      const collector = msg.createMessageComponentCollector({ filter, time: 60000, max: 1 });

      collector.on('collect', async i => {
        const scriptName = i.values[0];
        const script = (await pool.query('SELECT content FROM scripts WHERE LOWER(name) = $1 AND status = $2', [scriptName, 'online'])).rows[0];
        if (!script) {
          await i.update({ content: 'Script indisponível.', embeds: [], components: [] });
          return;
        }
        // [FIX] Scripts grandes estouravam o limite de 2000 caracteres do Discord.
        // Agora, acima de 1900 caracteres, o script é enviado como arquivo anexo.
        if (script.content.length > 1900) {
          const file = new AttachmentBuilder(Buffer.from(script.content, 'utf-8'), { name: `${scriptName}.lua` });
          await i.update({ content: `Aqui está o script **${scriptName}** (enviado como arquivo por ser muito grande):`, embeds: [], components: [], files: [file] });
        } else {
          await i.update({ content: `Conteúdo do script **${scriptName}**:\n\`\`\`lua\n${script.content}\n\`\`\``, embeds: [], components: [] });
        }
        await sendDiscordLog(`📜 ${interaction.user.tag} solicitou o script **${scriptName}** via menu`);
      });

      collector.on('end', collected => {
        if (collected.size === 0) {
          interaction.editReply({ content: 'Tempo esgotado.', embeds: [], components: [] });
        }
      });
    }

    else if (commandName === 'resethwid') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'Apenas administradores.', ephemeral: true });
      }
      const keyInput = interaction.options.getString('key');
      const r = await pool.query('SELECT * FROM keys WHERE key = $1', [keyInput]);
      if (!r.rows.length) return interaction.reply({ content: 'Key não encontrada.', ephemeral: true });
      const k = r.rows[0];
      await pool.query('UPDATE keys SET device_id = NULL WHERE id = $1', [k.id]);
      await logKeyAction('reset_hwid', keyInput, `Resetado por ${interaction.user.tag}`);
      await sendDiscordLog(`🔄 ${interaction.user.tag} resetou o HWID da key \`${keyInput}\``);
      interaction.reply({ content: 'Device ID resetado com sucesso.', ephemeral: true });
    }

    else if (commandName === 'setlogs') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'Apenas administradores.', ephemeral: true });
      }
      const channel = interaction.options.getChannel('channel');
      await pool.query("INSERT INTO discord_config (key, value) VALUES ('log_channel', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [channel.id]);
      await sendDiscordLog(`📝 Canal de logs definido para ${channel.toString()} por ${interaction.user.tag}`);
      interaction.reply({ content: `Logs serão enviadas para ${channel.toString()}.`, ephemeral: true });
    }
  });

  discordClient.login(DISCORD_BOT_TOKEN);
} else {
  console.log('⚠️ DISCORD_BOT_TOKEN ou DISCORD_CLIENT_ID não definidos. Bot não será iniciado.');
}

// ============================================================
// TRATAMENTO GLOBAL DE ERROS
// ============================================================
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

app.use((err, req, res, next) => {
  console.error('❌ Erro não tratado:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err);
});

// ============================================================
// INICIALIZAÇÃO
// ============================================================
(async () => {
  try {
    await initDatabase();

    const adminResult = await pool.query('SELECT * FROM admins WHERE LOWER(username) = LOWER($1)', [ADMIN_USER]);
    if (adminResult.rows.length === 0) {
      const hash = await bcrypt.hash(ADMIN_PASS, 12);
      await pool.query('INSERT INTO admins (username, password_hash, role) VALUES ($1, $2, $3)', [ADMIN_USER, hash, 'master']);
      console.log(`✅ Admin master criado: ${ADMIN_USER}`);
    } else {
      const admin = adminResult.rows[0];
      const matches = await bcrypt.compare(ADMIN_PASS, admin.password_hash);
      if (!matches) {
        const novoHash = await bcrypt.hash(ADMIN_PASS, 12);
        await pool.query('UPDATE admins SET password_hash = $1, failed_attempts = 0, locked_until = NULL WHERE id = $2', [novoHash, admin.id]);
        console.log(`🔐 Senha do admin ${ADMIN_USER} atualizada automaticamente.`);
      }
    }
  } catch (err) {
    console.error('⚠️ PostgreSQL indisponível:', err.message);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`⚡ Storm rodando na porta ${PORT}`);
    console.log(`🔗 Painel de login: /lgadm`);
  });
})();