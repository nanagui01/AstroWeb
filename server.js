require('dotenv').config();

// ============================================================
// VALIDAÇÃO OBRIGATÓRIA DE AMBIENTE
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
    console.error(`❌ ERRO FATAL: ${varName} não definido no .env`);
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

const app = express();
const PORT = process.env.PORT || 3000;

/* ============================================================
   CONFIGURAÇÕES (todas do .env)
   ============================================================ */
const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_SECRET = process.env.COOKIE_SECRET;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

// 🔥 URL DE ADMIN PERSONALIZADA
const ADMIN_PATH = '/001010GGZEHENXylo9FrostNetaP7zQm2V8xKr6L';

// Conexão com PostgreSQL (Render)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: IS_PRODUCTION ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
});

/* ============================================================
   SEGURANÇA BÁSICA
   ============================================================ */
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser(COOKIE_SECRET));
app.use(express.static(path.join(__dirname, 'public')));

/* ============================================================
   RATE LIMIT
   ============================================================ */
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: 'Muitas tentativas.' } });
const apiLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 300 });
const loaderLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 1000 });

app.use('/api/', apiLimiter);

/* ============================================================
   INICIALIZAÇÃO DAS TABELAS
   ============================================================ */
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

      -- 🆕 TABELAS DO SISTEMA DE KEYS
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
    `);
    console.log('✅ Tabelas inicializadas');
  } finally {
    client.release();
  }
}

/* ============================================================
   MIDDLEWARE DE AUTENTICAÇÃO
   ============================================================ */
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

function masterOnly(req, res, next) {
  if (req.user?.role !== 'master') return res.status(403).json({ error: 'Apenas master' });
  next();
}

/* ============================================================
   FUNÇÕES AUXILIARES
   ============================================================ */
function shortId() { return crypto.randomBytes(8).toString('hex'); }
function secureToken() { return crypto.randomBytes(16).toString('hex'); }

function generateKey() {
  const segments = [];
  for (let i = 0; i < 4; i++) {
    segments.push(crypto.randomBytes(2).toString('hex').toUpperCase().substring(0, 4));
  }
  return `STORM-${segments.join('-')}`;
}

async function logKeyAction(action, key, message) {
  try {
    await pool.query('INSERT INTO key_logs (action, key, message) VALUES ($1,$2,$3)', [action, key, message]);
  } catch (err) { console.error('Erro ao logar ação de key:', err.message); }
}

async function sendDiscordEmbed({ title, description, banner, thumbnail, scriptName }) {
  if (!DISCORD_WEBHOOK_URL) return;
  const embed = {
    title: title || `${scriptName} foi atualizado!`,
    description: description || 'Veja as novidades abaixo.',
    color: 0x6366f1,
    timestamp: new Date().toISOString(),
    footer: { text: 'Storm Hub' }
  };
  if (banner) embed.image = { url: banner };
  if (thumbnail) embed.thumbnail = { url: thumbnail };
  try {
    await axios.post(DISCORD_WEBHOOK_URL, { embeds: [embed] }, { timeout: 5000 });
  } catch (err) { console.error('[DISCORD]', err.message); }
}

async function getCountry(ip) {
  try {
    const res = await axios.get(`http://ip-api.com/json/${ip}?fields=country`, { timeout: 2000 });
    return res.data?.country || 'Unknown';
  } catch { return 'Unknown'; }
}

/* ============================================================
   AUTENTICAÇÃO
   ============================================================ */
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.redirect(`${ADMIN_PATH}?error=1`);

  const result = await pool.query('SELECT * FROM admins WHERE LOWER(username) = LOWER($1)', [username]);
  const admin = result.rows[0];
  const FAKE_HASH = '$2a$10$7EqJtq98hPqEX7fNZaFWoOHi5xJYq7u9fN5F5NeLSd851qwL2mM5e';

  if (!admin) {
    await bcrypt.compare(password, FAKE_HASH);
    return res.redirect(`${ADMIN_PATH}?error=1`);
  }

  if (!bcrypt.compareSync(password, admin.password_hash)) {
    await pool.query('UPDATE admins SET failed_attempts = failed_attempts + 1 WHERE id = $1', [admin.id]);
    return res.redirect(`${ADMIN_PATH}?error=1`);
  }

  await pool.query('UPDATE admins SET failed_attempts = 0, locked_until = NULL, last_login = NOW() WHERE id = $1', [admin.id]);
  const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role }, JWT_SECRET, { expiresIn: '8h' });
  res.cookie('token', token, { httpOnly: true, secure: IS_PRODUCTION, sameSite: 'lax', path: '/', signed: true });
  return res.redirect(`${ADMIN_PATH}/dashboard`);
});

app.get('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect(ADMIN_PATH);
});

app.get('/api/auth/me', auth, async (req, res) => {
  const result = await pool.query('SELECT username, role FROM admins WHERE id = $1', [req.user.id]);
  res.json(result.rows[0] || {});
});

/* ============================================================
   BLOQUEIO DE IP
   ============================================================ */
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
  try {
    const result = await pool.query('SELECT ip FROM blocked_ips WHERE ip = $1', [ip]);
    if (result.rows.length > 0) return res.status(403).send('Acesso bloqueado.');
  } catch (err) { /* falha silenciosa */ }
  next();
});

/* ============================================================
   SCRIPTS CRUD
   ============================================================ */
app.get('/api/scripts', auth, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 25;
  const offset = (page - 1) * limit;
  const sort = req.query.sort || 'updated_at';
  const order = req.query.order || 'DESC';
  const status = req.query.status;
  const tag = req.query.tag;

  let query = `SELECT s.*, 
    COALESCE(json_agg(t.*) FILTER (WHERE t.id IS NOT NULL), '[]') AS tags
    FROM scripts s
    LEFT JOIN script_tags st ON s.id = st.script_id
    LEFT JOIN tags t ON st.tag_id = t.id`;
  let countQuery = 'SELECT COUNT(*) FROM scripts s';
  const params = [];
  const conditions = [];

  if (status) {
    conditions.push(`s.status = $${params.length + 1}`);
    params.push(status);
  }
  if (tag) {
    conditions.push(`s.id IN (SELECT script_id FROM script_tags WHERE tag_id = $${params.length + 1})`);
    params.push(tag);
  }

  if (conditions.length > 0) {
    const where = ' WHERE ' + conditions.join(' AND ');
    query += where;
    countQuery += where;
  }

  query += ` GROUP BY s.id ORDER BY s.${sort} ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  try {
    const scriptsResult = await pool.query(query, params);
    const countParams = conditions.length > 0 ? params.slice(0, -2) : [];
    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);
    res.json({ data: scriptsResult.rows, page, totalPages: Math.ceil(total / limit), total });
  } catch (err) {
    console.error('Erro ao buscar scripts:', err);
    res.status(500).json({ error: 'Erro ao buscar scripts' });
  }
});

app.get('/api/scripts/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, COALESCE(json_agg(t.*) FILTER (WHERE t.id IS NOT NULL), '[]') AS tags
      FROM scripts s
      LEFT JOIN script_tags st ON s.id = st.script_id
      LEFT JOIN tags t ON st.tag_id = t.id
      WHERE s.id = $1
      GROUP BY s.id`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Script não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar script' });
  }
});

app.post('/api/scripts', auth, async (req, res) => {
  const { name, content, status, sandbox, silent, daily_limit, expires_at, tags } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'Nome e conteúdo obrigatórios' });
  const validStatuses = ['online', 'offline', 'maintenance', 'development'];
  const id = uuidv4();
  const short_id = shortId();
  const token = secureToken();
  try {
    await pool.query(
      `INSERT INTO scripts (id, name, content, status, sandbox, silent, daily_limit, expires_at, short_id, token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, name.trim(), content, validStatuses.includes(status) ? status : 'online', sandbox || false, silent || false, daily_limit || 0, expires_at || null, short_id, token]
    );
    if (Array.isArray(tags)) {
      for (const tagName of tags) {
        let tagResult = await pool.query('SELECT id FROM tags WHERE name = $1', [tagName]);
        if (tagResult.rows.length === 0) {
          tagResult = await pool.query('INSERT INTO tags (name) VALUES ($1) RETURNING id', [tagName]);
        }
        await pool.query('INSERT INTO script_tags (script_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, tagResult.rows[0].id]);
      }
    }
    const newScript = await pool.query('SELECT * FROM scripts WHERE id = $1', [id]);
    res.status(201).json(newScript.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar script' });
  }
});

app.put('/api/scripts/:id', auth, async (req, res) => {
  try {
    const script = (await pool.query('SELECT * FROM scripts WHERE id = $1', [req.params.id])).rows[0];
    if (!script) return res.status(404).json({ error: 'Script não encontrado' });
    await pool.query('INSERT INTO script_versions (script_id, name, content, status) VALUES ($1,$2,$3,$4)',
      [script.id, script.name, script.content, script.status]);
    const { name, content, status, sandbox, silent, daily_limit, expires_at, tags } = req.body;
    const validStatuses = ['online', 'offline', 'maintenance', 'development'];
    if (name !== undefined) script.name = name.trim();
    if (content !== undefined) script.content = content;
    if (status !== undefined && validStatuses.includes(status)) script.status = status;
    if (sandbox !== undefined) script.sandbox = sandbox;
    if (silent !== undefined) script.silent = silent;
    if (daily_limit !== undefined) script.daily_limit = daily_limit;
    if (expires_at !== undefined) script.expires_at = expires_at;
    await pool.query(
      `UPDATE scripts SET name=$1, content=$2, status=$3, sandbox=$4, silent=$5, daily_limit=$6, expires_at=$7, updated_at=NOW() WHERE id=$8`,
      [script.name, script.content, script.status, script.sandbox, script.silent, script.daily_limit, script.expires_at, script.id]
    );
    if (Array.isArray(tags)) {
      await pool.query('DELETE FROM script_tags WHERE script_id = $1', [script.id]);
      for (const tagName of tags) {
        let tagResult = await pool.query('SELECT id FROM tags WHERE name = $1', [tagName]);
        if (tagResult.rows.length === 0) {
          tagResult = await pool.query('INSERT INTO tags (name) VALUES ($1) RETURNING id', [tagName]);
        }
        await pool.query('INSERT INTO script_tags (script_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [script.id, tagResult.rows[0].id]);
      }
    }
    res.json(script);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar script' });
  }
});

app.delete('/api/scripts/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM scripts WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir script' });
  }
});

/* ... (rotas de duplicação, bulk, versões, restore, changelog mantidas) ... */
// (As rotas de scripts continuam as mesmas do código original – não vou repeti-las aqui por brevidade)

/* ============================================================
   KEYS API (SISTEMA DE LICENÇAS)
   ============================================================ */

// Criar key (admin)
app.post('/api/keys', auth, async (req, res) => {
  const { duration } = req.body; // 0 = permanente
  const key = generateKey();
  const expires_at = duration > 0 ? new Date(Date.now() + duration * 86400000).toISOString() : null;
  try {
    const result = await pool.query(
      'INSERT INTO keys (key, expires_at, active) VALUES ($1, $2, true) RETURNING *',
      [key, expires_at]
    );
    await logKeyAction('create', key, `Key criada (${duration || 'permanente'} dias)`);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar key' });
  }
});

// Listar keys (admin)
app.get('/api/keys', auth, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 25;
  const offset = (page - 1) * limit;
  const sort = req.query.sort || 'created_at';
  const order = req.query.order || 'DESC';
  const status = req.query.status;

  let where = '';
  const params = [];
  if (status === 'active') {
    where = 'WHERE active = true AND (expires_at IS NULL OR expires_at > NOW())';
  } else if (status === 'expired') {
    where = 'WHERE active = true AND expires_at IS NOT NULL AND expires_at <= NOW()';
  } else if (status === 'revoked') {
    where = 'WHERE active = false';
  }

  try {
    const countRes = await pool.query(`SELECT COUNT(*) FROM keys ${where}`, params);
    const total = parseInt(countRes.rows[0].count);
    params.push(limit, offset);
    const result = await pool.query(`SELECT * FROM keys ${where} ORDER BY ${sort} ${order} LIMIT $${params.length-1} OFFSET $${params.length}`, params);
    res.json({ data: result.rows, page, totalPages: Math.ceil(total / limit), total });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar keys' });
  }
});

// Verificar key (público)
app.post('/api/keys/verify', apiLimiter, async (req, res) => {
  const { key, deviceId } = req.body;
  if (!key) return res.status(400).json({ success: false, message: 'Key obrigatória' });

  try {
    const result = await pool.query('SELECT * FROM keys WHERE key = $1', [key]);
    if (result.rows.length === 0) {
      await logKeyAction('verify_fail', key, 'Key não encontrada');
      return res.status(404).json({ success: false, message: 'Key inválida' });
    }
    const k = result.rows[0];
    if (!k.active) {
      await logKeyAction('verify_fail', key, 'Key revogada');
      return res.status(403).json({ success: false, message: 'Key revogada' });
    }
    if (k.expires_at && new Date(k.expires_at) < new Date()) {
      await pool.query('UPDATE keys SET active = false WHERE id = $1', [k.id]);
      await logKeyAction('expire', key, 'Key expirada');
      return res.status(403).json({ success: false, message: 'Key expirada' });
    }
    if (k.device_id) {
      if (!deviceId || k.device_id !== deviceId) {
        await logKeyAction('verify_fail', key, `Device mismatch: esperado ${k.device_id}, recebido ${deviceId}`);
        return res.status(403).json({ success: false, message: 'Device mismatch' });
      }
    } else if (deviceId) {
      await pool.query('UPDATE keys SET device_id = $1, last_use = NOW() WHERE id = $2', [deviceId, k.id]);
      await pool.query('INSERT INTO activations (key_id, device_id) VALUES ($1, $2)', [k.id, deviceId]);
      await logKeyAction('activate', key, `Vinculada ao device ${deviceId}`);
    }
    await pool.query('UPDATE keys SET last_use = NOW() WHERE id = $1', [k.id]);
    await logKeyAction('verify', key, 'Verificação bem-sucedida');
    res.json({ success: true, key: { id: k.id, expires_at: k.expires_at, device_id: k.device_id } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

// Revogar key (admin)
app.post('/api/keys/:id/revoke', auth, async (req, res) => {
  try {
    await pool.query('UPDATE keys SET active = false WHERE id = $1', [req.params.id]);
    await logKeyAction('revoke', req.params.id, 'Key revogada');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao revogar key' });
  }
});

// Renovar key (admin)
app.post('/api/keys/:id/renew', auth, async (req, res) => {
  const { days } = req.body;
  try {
    const key = (await pool.query('SELECT * FROM keys WHERE id = $1', [req.params.id])).rows[0];
    if (!key) return res.status(404).json({ error: 'Key não encontrada' });
    const newExpiry = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
    await pool.query('UPDATE keys SET expires_at = $1, active = true WHERE id = $2', [newExpiry, key.id]);
    await logKeyAction('renew', key.key, `Renovada por ${days} dias`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao renovar key' });
  }
});

// Excluir key (admin)
app.delete('/api/keys/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM keys WHERE id = $1', [req.params.id]);
    await logKeyAction('delete', req.params.id, 'Key excluída');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir key' });
  }
});

// Buscar key por ID
app.get('/api/keys/:id', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM keys WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Key não encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar key' });
  }
});

// Loader com key
app.get('/api/load-with-key', loaderLimiter, async (req, res) => {
  if (MAINTENANCE_MODE) return res.status(503).send('Em manutenção.');
  const { key, script, device } = req.query;
  if (!key || !script) return res.status(400).send('Parâmetros obrigatórios: key, script');

  try {
    const keyResult = await pool.query('SELECT * FROM keys WHERE key = $1', [key]);
    if (keyResult.rows.length === 0) return res.status(403).send('Key inválida.');
    const k = keyResult.rows[0];
    if (!k.active) return res.status(403).send('Key revogada.');
    if (k.expires_at && new Date(k.expires_at) < new Date()) {
      await pool.query('UPDATE keys SET active = false WHERE id = $1', [k.id]);
      return res.status(403).send('Key expirada.');
    }
    if (k.device_id && device && k.device_id !== device) {
      return res.status(403).send('Device mismatch.');
    }
    if (!k.device_id && device) {
      await pool.query('UPDATE keys SET device_id = $1, last_use = NOW() WHERE id = $2', [device, k.id]);
      await pool.query('INSERT INTO activations (key_id, device_id) VALUES ($1, $2)', [k.id, device]);
    }
    await pool.query('UPDATE keys SET last_use = NOW() WHERE id = $1', [k.id]);

    const scriptResult = await pool.query('SELECT * FROM scripts WHERE short_id = $1 AND status = $2', [script, 'online']);
    if (scriptResult.rows.length === 0) return res.status(404).send('Script indisponível.');
    const s = scriptResult.rows[0];
    if (s.daily_limit > 0) {
      const today = new Date().toISOString().split('T')[0];
      const todayCount = (await pool.query('SELECT COUNT(*) FROM execution_logs WHERE script_id = $1 AND DATE(created_at) = $2', [s.id, today])).rows[0].count;
      if (todayCount >= s.daily_limit) return res.status(429).send('Limite diário de execuções atingido.');
    }
    await pool.query('UPDATE scripts SET executions = executions + 1 WHERE id = $1', [s.id]);
    const ip = req.ip || req.connection.remoteAddress;
    await pool.query('INSERT INTO execution_logs (script_id, ip, country, user_agent) VALUES ($1,$2,$3,$4)', [s.id, ip, req.headers['cf-ipcountry'] || 'Unknown', (req.get('User-Agent') || '').toLowerCase()]);
    res.type('text/plain').send(s.content);
  } catch (err) {
    res.status(500).send('Erro interno');
  }
});

/* ============================================================
   ESTATÍSTICAS (com keys)
   ============================================================ */
app.get('/api/stats', auth, async (req, res) => {
  try {
    const total = (await pool.query('SELECT COUNT(*) FROM scripts')).rows[0].count;
    const online = (await pool.query('SELECT COUNT(*) FROM scripts WHERE status = $1', ['online'])).rows[0].count;
    const offline = (await pool.query('SELECT COUNT(*) FROM scripts WHERE status = $1', ['offline'])).rows[0].count;
    const maintenance = (await pool.query('SELECT COUNT(*) FROM scripts WHERE status = $1', ['maintenance'])).rows[0].count;
    const development = (await pool.query('SELECT COUNT(*) FROM scripts WHERE status = $1', ['development'])).rows[0].count;
    const totalExec = (await pool.query('SELECT SUM(executions) FROM scripts')).rows[0].sum || 0;
    const popular = (await pool.query('SELECT name, executions FROM scripts ORDER BY executions DESC LIMIT 5')).rows;
    const daily = (await pool.query(`
      SELECT DATE(created_at) as date, COUNT(*) as count 
      FROM execution_logs 
      WHERE created_at > NOW() - INTERVAL '7 days' 
      GROUP BY date ORDER BY date
    `)).rows;
    const hourly = (await pool.query(`
      SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as count 
      FROM execution_logs 
      WHERE created_at > NOW() - INTERVAL '24 hours' 
      GROUP BY hour ORDER BY hour
    `)).rows;
    const countries = (await pool.query(`
      SELECT country, COUNT(*) as count 
      FROM execution_logs 
      WHERE created_at > NOW() - INTERVAL '30 days' 
      GROUP BY country ORDER BY count DESC LIMIT 10
    `)).rows;

    // Estatísticas de keys
    const keyStats = {
      total: parseInt((await pool.query('SELECT COUNT(*) FROM keys')).rows[0].count),
      active: parseInt((await pool.query('SELECT COUNT(*) FROM keys WHERE active = true AND (expires_at IS NULL OR expires_at > NOW())')).rows[0].count),
      expired: parseInt((await pool.query('SELECT COUNT(*) FROM keys WHERE active = true AND expires_at IS NOT NULL AND expires_at <= NOW()')).rows[0].count),
      revoked: parseInt((await pool.query('SELECT COUNT(*) FROM keys WHERE active = false')).rows[0].count),
      activationsToday: parseInt((await pool.query('SELECT COUNT(*) FROM activations WHERE DATE(created_at) = CURRENT_DATE')).rows[0].count),
    };

    res.json({
      totalScripts: parseInt(total), onlineScripts: parseInt(online), offlineScripts: parseInt(offline),
      maintenanceScripts: parseInt(maintenance), developmentScripts: parseInt(development),
      totalExecutions: parseInt(totalExec), popular, daily, hourly, countries,
      keyStats
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

/* ============================================================
   PÁGINAS
   ============================================================ */
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get(ADMIN_PATH, (req, res) => res.sendFile(path.join(__dirname, 'public/admin/login.html')));
app.get(`${ADMIN_PATH}/dashboard`, auth, (req, res) => res.sendFile(path.join(__dirname, 'public/admin/dashboard.html')));
app.get(`${ADMIN_PATH}/keys`, auth, (req, res) => res.sendFile(path.join(__dirname, 'public/admin/keys.html')));

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
(async () => {
  try {
    await initDatabase();
    const adminResult = await pool.query('SELECT * FROM admins WHERE LOWER(username) = LOWER($1)', [ADMIN_USER]);
    if (adminResult.rows.length === 0) {
      const hash = await bcrypt.hash(ADMIN_PASS, 10);
      await pool.query('INSERT INTO admins (username, password_hash, role) VALUES ($1, $2, $3)', [ADMIN_USER, hash, 'master']);
      console.log(`✅ Admin master criado: ${ADMIN_USER}`);
    } else {
      const admin = adminResult.rows[0];
      const senhaCorreta = bcrypt.compareSync(ADMIN_PASS, admin.password_hash);
      if (!senhaCorreta) {
        const novoHash = await bcrypt.hash(ADMIN_PASS, 10);
        await pool.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [novoHash, admin.id]);
        console.log(`🔐 Senha do admin ${ADMIN_USER} atualizada automaticamente.`);
      }
    }
  } catch (err) {
    console.error('⚠️ PostgreSQL indisponível:', err.message);
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`⚡ Storm rodando na porta ${PORT}`);
  });
})();