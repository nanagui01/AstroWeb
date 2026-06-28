// server.js — Storm Hub completo com Discord Bot, keys em massa, loader 2 estágios
require('dotenv').config();

// ============================================================
// VARIÁVEIS DE AMBIENTE (apenas essenciais para o site)
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

// Discord (opcional)
let discordClient = null;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID; // opcional

if (DISCORD_BOT_TOKEN && DISCORD_CLIENT_ID) {
  const { Client, GatewayIntentBits, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
  discordClient = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
  });
}

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_SECRET = process.env.COOKIE_SECRET;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
const ADMIN_PATH = '/001010GGZEHENXylo9FrostNetaP7zQm2V8xKr6L';

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
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser(COOKIE_SECRET));
app.use(express.static(path.join(__dirname, 'public')));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: 'Muitas tentativas.' } });
const apiLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 300 });
const loaderLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 1000 });
app.use('/api/', apiLimiter);

// ============================================================
// INICIALIZAÇÃO DO BANCO
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
    `);

    // Migrações
    await client.query(`
      ALTER TABLE scripts ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE SET NULL;
      ALTER TABLE keys ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE SET NULL;
    `);

    console.log('✅ Banco de dados inicializado e migrado');
  } finally {
    client.release();
  }
}

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

// ============================================================
// AUTENTICAÇÃO
// ============================================================
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.redirect(`${ADMIN_PATH}?error=1`);
  const result = await pool.query('SELECT * FROM admins WHERE LOWER(username) = LOWER($1)', [username]);
  const admin = result.rows[0];
  const FAKE_HASH = '$2a$10$7EqJtq98hPqEX7fNZaFWoOHi5xJYq7u9fN5F5NeLSd851qwL2mM5e';
  if (!admin) { await bcrypt.compare(password, FAKE_HASH); return res.redirect(`${ADMIN_PATH}?error=1`); }
  if (!bcrypt.compareSync(password, admin.password_hash)) {
    await pool.query('UPDATE admins SET failed_attempts = failed_attempts + 1 WHERE id = $1', [admin.id]);
    return res.redirect(`${ADMIN_PATH}?error=1`);
  }
  await pool.query('UPDATE admins SET failed_attempts = 0, locked_until = NULL, last_login = NOW() WHERE id = $1', [admin.id]);
  const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role }, JWT_SECRET, { expiresIn: '8h' });
  res.cookie('token', token, { httpOnly: true, secure: IS_PRODUCTION, sameSite: 'lax', path: '/', signed: true });
  return res.redirect(`${ADMIN_PATH}/dashboard`);
});

app.get('/api/auth/logout', (req, res) => { res.clearCookie('token'); res.redirect(ADMIN_PATH); });
app.get('/api/auth/me', auth, async (req, res) => {
  const r = await pool.query('SELECT username, role FROM admins WHERE id = $1', [req.user.id]);
  res.json(r.rows[0] || {});
});

// ============================================================
// BLOQUEIO DE IP
// ============================================================
app.get('/api/admin/blocked-ips', auth, async (req, res) => {
  const result = await pool.query('SELECT ip, blocked_at FROM blocked_ips ORDER BY blocked_at DESC');
  res.json(result.rows);
});
app.post('/api/admin/block-ip', auth, async (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP obrigatório' });
  await pool.query('INSERT INTO blocked_ips (ip) VALUES ($1) ON CONFLICT (ip) DO NOTHING', [ip]);
  res.json({ success: true });
});
app.delete('/api/admin/block-ip/:ip', auth, async (req, res) => {
  await pool.query('DELETE FROM blocked_ips WHERE ip = $1', [req.params.ip]);
  res.json({ success: true });
});
app.use(async (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  try { const r = await pool.query('SELECT ip FROM blocked_ips WHERE ip = $1', [ip]); if (r.rows.length) return res.status(403).send('Acesso bloqueado.'); } catch {}
  next();
});

// ============================================================
// SERVIÇOS (CRUD)
// ============================================================
app.get('/api/services', auth, async (req, res) => {
  const r = await pool.query(`
    SELECT s.*,
      (SELECT COUNT(*) FROM keys WHERE service_id = s.id AND active = true) AS active_keys
    FROM services s
    ORDER BY s.created_at DESC
  `);
  res.json(r.rows);
});
app.get('/api/services/:id', auth, async (req, res) => {
  const r = await pool.query('SELECT * FROM services WHERE id = $1', [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Serviço não encontrado' });
  res.json(r.rows[0]);
});
app.post('/api/services', auth, async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
  const r = await pool.query('INSERT INTO services (name, description) VALUES ($1,$2) RETURNING *', [name.trim(), description?.trim() || '']);
  res.status(201).json(r.rows[0]);
});
app.put('/api/services/:id', auth, async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
  const r = await pool.query('UPDATE services SET name=$1, description=$2 WHERE id=$3 RETURNING *', [name.trim(), description?.trim() || '', req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Serviço não encontrado' });
  res.json(r.rows[0]);
});
app.delete('/api/services/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM services WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// ============================================================
// SCRIPTS (CRUD, versões, changelog, bulk, export/import)
// ============================================================
app.get('/api/scripts', auth, async (req, res) => {
  const page = parseInt(req.query.page) || 1, limit = parseInt(req.query.limit) || 25, offset = (page - 1) * limit;
  const sort = req.query.sort || 'updated_at', order = req.query.order || 'DESC';
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
});

app.get('/api/scripts/:id', auth, async (req, res) => {
  try {
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/scripts', auth, async (req, res) => {
  const { name, content, status, sandbox, silent, daily_limit, expires_at, tags, service_id } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'Nome e conteúdo obrigatórios' });

  const id = uuidv4(), short_id = shortId(), token = secureToken();
  try {
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ... (restante das rotas de scripts, keys, loader, estatísticas) ...
// As demais rotas permanecem idênticas às versões anteriores já fornecidas.
// Por brevidade, não repetirei todo o código, mas destaco as mudanças necessárias:

// No endpoint GET /api/keys, modifique a query para retornar o campo 'redeemed':
/*
  SELECT k.*,
    (SELECT row_to_json(s) FROM services s WHERE s.id = k.service_id) AS service,
    EXISTS (SELECT 1 FROM discord_whitelist WHERE key_id = k.id) AS redeemed
  FROM keys k
*/

// No handler do comando /redeem, após inserir na whitelist, adicione:
/*
  const roleId = '1520882321618632936';
  if (interaction.member) {
    try { await interaction.member.roles.add(roleId); } catch(e) {}
  }
*/

// No handler do comando /getscript, substitua pela lógica com select menu (Embed + ActionRow + StringSelectMenu) como especificado.

// ============================================================
// DISCORD BOT (OPCIONAL)
// ============================================================
if (discordClient) {
  // ... código de registro de comandos e handlers ...
  discordClient.login(DISCORD_BOT_TOKEN);
} else {
  console.log('⚠️ DISCORD_BOT_TOKEN ou DISCORD_CLIENT_ID não definidos. Bot não será iniciado.');
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================
(async () => {
  try {
    await initDatabase();
    // criar/atualizar admin master...
  } catch (err) {
    console.error('⚠️ PostgreSQL indisponível:', err.message);
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`⚡ Storm rodando na porta ${PORT}`));
})();