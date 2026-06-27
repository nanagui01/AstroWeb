require('dotenv').config();

// ============================================================
// VALIDAÇÃO OBRIGATÓRIA DE AMBIENTE
// ============================================================
if (!process.env.JWT_SECRET) { console.error('❌ ERRO FATAL: JWT_SECRET não definido no .env'); process.exit(1); }
if (!process.env.COOKIE_SECRET) { console.error('❌ ERRO FATAL: COOKIE_SECRET não definido no .env'); process.exit(1); }
if (!process.env.ADMIN_USER) { console.error('❌ ERRO FATAL: ADMIN_USER não definido no .env'); process.exit(1); }
if (!process.env.ADMIN_PASS) { console.error('❌ ERRO FATAL: ADMIN_PASS não definido no .env'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('❌ ERRO FATAL: DATABASE_URL não definido no .env'); process.exit(1); }

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
   CONFIGURAÇÕES
   ============================================================ */
const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_SECRET = process.env.COOKIE_SECRET;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

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
  if (!username || !password) return res.redirect('/painel?error=1');

  const result = await pool.query('SELECT * FROM admins WHERE LOWER(username) = LOWER($1)', [username]);
  const admin = result.rows[0];
  const FAKE_HASH = '$2a$10$7EqJtq98hPqEX7fNZaFWoOHi5xJYq7u9fN5F5NeLSd851qwL2mM5e';

  if (!admin) {
    await bcrypt.compare(password, FAKE_HASH);
    return res.redirect('/painel?error=1');
  }

  if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
    return res.redirect('/painel?error=locked');
  }

  if (!bcrypt.compareSync(password, admin.password_hash)) {
    await pool.query('UPDATE admins SET failed_attempts = failed_attempts + 1 WHERE id = $1', [admin.id]);
    const updated = await pool.query('SELECT failed_attempts FROM admins WHERE id = $1', [admin.id]);
    if (updated.rows[0].failed_attempts >= 5) {
      await pool.query('UPDATE admins SET locked_until = NOW() + INTERVAL \'15 minutes\', failed_attempts = 0 WHERE id = $1', [admin.id]);
    }
    return res.redirect('/painel?error=1');
  }

  await pool.query('UPDATE admins SET failed_attempts = 0, locked_until = NULL, last_login = NOW() WHERE id = $1', [admin.id]);
  const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role }, JWT_SECRET, { expiresIn: '8h' });
  res.cookie('token', token, { httpOnly: true, secure: IS_PRODUCTION, sameSite: 'lax', path: '/', signed: true });
  return res.redirect('/painel/dashboard');
});

app.get('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/painel');
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

// Middleware de bloqueio de IP
app.use(async (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  try {
    const result = await pool.query('SELECT ip FROM blocked_ips WHERE ip = $1', [ip]);
    if (result.rows.length > 0) return res.status(403).send('Acesso bloqueado.');
  } catch (err) { /* falha silenciosa */ }
  next();
});

/* ============================================================
   SCRIPTS CRUD COM PAGINAÇÃO, ORDENAÇÃO E TAGS
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

app.post('/api/scripts/:id/duplicate', auth, async (req, res) => {
  try {
    const original = (await pool.query('SELECT * FROM scripts WHERE id = $1', [req.params.id])).rows[0];
    if (!original) return res.status(404).json({ error: 'Script não encontrado' });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO scripts (id, name, content, status, sandbox, silent, daily_limit, expires_at, short_id, token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, original.name + ' (cópia)', original.content, original.status, original.sandbox, original.silent, original.daily_limit, original.expires_at, shortId(), secureToken()]
    );
    const duplicated = await pool.query('SELECT * FROM scripts WHERE id = $1', [id]);
    res.status(201).json(duplicated.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao duplicar script' });
  }
});

app.post('/api/scripts/bulk', auth, async (req, res) => {
  const { scripts } = req.body;
  if (!Array.isArray(scripts) || scripts.length === 0) return res.status(400).json({ error: 'Array obrigatório' });
  const created = [];
  try {
    for (const sc of scripts) {
      if (!sc.name || !sc.content) continue;
      const id = uuidv4();
      await pool.query(
        `INSERT INTO scripts (id, name, content, short_id, token) VALUES ($1,$2,$3,$4,$5)`,
        [id, sc.name.trim(), sc.content, shortId(), secureToken()]
      );
      created.push((await pool.query('SELECT * FROM scripts WHERE id = $1', [id])).rows[0]);
    }
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: 'Erro na importação em massa' });
  }
});

// Histórico de versões
app.get('/api/scripts/:id/versions', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM script_versions WHERE script_id = $1 ORDER BY created_at DESC', [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar versões' });
  }
});

app.post('/api/scripts/:id/restore', auth, async (req, res) => {
  const { versionId } = req.body;
  try {
    const version = (await pool.query('SELECT * FROM script_versions WHERE id = $1', [versionId])).rows[0];
    if (!version) return res.status(404).json({ error: 'Versão não encontrada' });
    const script = (await pool.query('SELECT * FROM scripts WHERE id = $1', [req.params.id])).rows[0];
    if (!script) return res.status(404).json({ error: 'Script não encontrado' });
    await pool.query('INSERT INTO script_versions (script_id, name, content, status) VALUES ($1,$2,$3,$4)',
      [script.id, script.name, script.content, script.status]);
    await pool.query('UPDATE scripts SET name=$1, content=$2, status=$3, updated_at=NOW() WHERE id=$4',
      [version.name, version.content, version.status, script.id]);
    const restored = await pool.query('SELECT * FROM scripts WHERE id = $1', [script.id]);
    res.json(restored.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao restaurar versão' });
  }
});

// Changelog via Discord
app.post('/api/scripts/:id/changelog', auth, async (req, res) => {
  try {
    const script = (await pool.query('SELECT name FROM scripts WHERE id = $1', [req.params.id])).rows[0];
    if (!script) return res.status(404).json({ error: 'Script não encontrado' });
    const { title, description, banner, thumbnail } = req.body;
    await sendDiscordEmbed({ title, description, banner, thumbnail, scriptName: script.name });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao enviar changelog' });
  }
});

/* ============================================================
   TAGS
   ============================================================ */
app.get('/api/tags', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tags ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar tags' });
  }
});

app.post('/api/tags', auth, async (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
  try {
    const result = await pool.query('INSERT INTO tags (name, color) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET color = $2 RETURNING *', [name, color || '#6366f1']);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar tag' });
  }
});

app.delete('/api/tags/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM tags WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir tag' });
  }
});

/* ============================================================
   ESTATÍSTICAS REAIS
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
    res.json({ totalScripts: parseInt(total), onlineScripts: parseInt(online), offlineScripts: parseInt(offline), maintenanceScripts: parseInt(maintenance), developmentScripts: parseInt(development), totalExecutions: parseInt(totalExec), popular, daily, hourly, countries });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

/* ============================================================
   ALERTAS VISUAIS
   ============================================================ */
app.get('/api/alerts', auth, async (req, res) => {
  try {
    const offlineScripts = (await pool.query('SELECT id, name FROM scripts WHERE status = $1', ['offline'])).rows;
    const expiringScripts = (await pool.query('SELECT id, name, expires_at FROM scripts WHERE expires_at IS NOT NULL AND expires_at < NOW() + INTERVAL \'3 days\' AND status = $1', ['online'])).rows;
    res.json({ offline: offlineScripts, expiring: expiringScripts });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar alertas' });
  }
});

/* ============================================================
   SAÚDE DO SERVIDOR
   ============================================================ */
app.get('/api/health', (req, res) => {
  const used = process.memoryUsage();
  res.json({
    status: 'online',
    uptime: process.uptime(),
    memory: {
      rss: Math.round(used.rss / 1024 / 1024) + ' MB',
      heapTotal: Math.round(used.heapTotal / 1024 / 1024) + ' MB',
      heapUsed: Math.round(used.heapUsed / 1024 / 1024) + ' MB',
    },
    cpu: process.cpuUsage(),
    pid: process.pid,
    nodeVersion: process.version,
    timestamp: new Date().toISOString()
  });
});

/* ============================================================
   EXPORTAÇÃO DE ESTATÍSTICAS
   ============================================================ */
app.get('/api/stats/export', auth, async (req, res) => {
  const format = req.query.format || 'json';
  try {
    const stats = {
      totalScripts: (await pool.query('SELECT COUNT(*) FROM scripts')).rows[0].count,
      onlineScripts: (await pool.query('SELECT COUNT(*) FROM scripts WHERE status = $1', ['online'])).rows[0].count,
      totalExecutions: (await pool.query('SELECT SUM(executions) FROM scripts')).rows[0].sum || 0,
      generatedAt: new Date().toISOString()
    };
    if (format === 'csv') {
      const csv = 'metric,value\n' + Object.entries(stats).map(([k, v]) => `${k},${v}`).join('\n');
      res.header('Content-Type', 'text/csv');
      res.attachment('astro_stats.csv');
      return res.send(csv);
    }
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao exportar estatísticas' });
  }
});

/* ============================================================
   BACKUP AUTOMÁTICO
   ============================================================ */
app.get('/api/backup', auth, masterOnly, async (req, res) => {
  try {
    const scripts = (await pool.query('SELECT * FROM scripts')).rows;
    const versions = (await pool.query('SELECT * FROM script_versions')).rows;
    const tags = (await pool.query('SELECT * FROM tags')).rows;
    const scriptTags = (await pool.query('SELECT * FROM script_tags')).rows;
    const backup = { scripts, versions, tags, scriptTags, exported_at: new Date().toISOString() };
    res.json(backup);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao gerar backup' });
  }
});

// Backup automático a cada 6 horas (salva em arquivo local)
setInterval(async () => {
  try {
    const scripts = (await pool.query('SELECT * FROM scripts')).rows;
    const versions = (await pool.query('SELECT * FROM script_versions')).rows;
    const backup = { scripts, versions, timestamp: new Date().toISOString() };
    const fs = require('fs');
    const backupsDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
    fs.writeFileSync(path.join(backupsDir, `backup_${Date.now()}.json`), JSON.stringify(backup, null, 2));
    console.log('✅ Backup automático realizado');
  } catch (err) { console.error('❌ Erro no backup automático:', err.message); }
}, 6 * 60 * 60 * 1000);

/* ============================================================
   EXPORT / IMPORT (JSON)
   ============================================================ */
app.get('/api/export', auth, async (req, res) => {
  try {
    const scripts = (await pool.query('SELECT * FROM scripts')).rows;
    res.json({ scripts, exported_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao exportar' });
  }
});

app.post('/api/import', auth, masterOnly, async (req, res) => {
  const { scripts, confirmation } = req.body;
  if (confirmation !== 'IMPORTAR') return res.status(400).json({ error: 'Confirmação necessária. Envie { confirmation: "IMPORTAR" }.' });
  if (!Array.isArray(scripts)) return res.status(400).json({ error: 'Formato inválido' });
  try {
    await pool.query('DELETE FROM scripts');
    for (const s of scripts) {
      await pool.query(
        `INSERT INTO scripts (id, name, content, status, sandbox, silent, daily_limit, expires_at, short_id, token, executions, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [s.id, s.name, s.content, s.status || 'online', s.sandbox || false, s.silent || false, s.daily_limit || 0, s.expires_at || null, s.short_id, s.token, s.executions || 0, s.created_at || new Date().toISOString(), s.updated_at || new Date().toISOString()]
      );
    }
    res.json({ success: true, imported: scripts.length });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao importar' });
  }
});

/* ============================================================
   LOADER PROTEGIDO COM LIMITES
   ============================================================ */
app.get('/api/load/:shortId/:token', loaderLimiter, async (req, res) => {
  if (MAINTENANCE_MODE) return res.status(503).send('Em manutenção.');
  const ua = (req.get('User-Agent') || '').toLowerCase();
  if (ua && !ua.includes('roblox')) {
    return res.status(403).sendFile(path.join(__dirname, 'public', 'blocked.html'));
  }
  try {
    const script = (await pool.query('SELECT * FROM scripts WHERE short_id = $1 AND token = $2', [req.params.shortId, req.params.token])).rows[0];
    if (!script || script.status !== 'online') return res.status(404).send('Script indisponível.');
    if (script.expires_at && new Date(script.expires_at) < new Date()) {
      await pool.query('UPDATE scripts SET status = $1 WHERE id = $2', ['offline', script.id]);
      return res.status(404).send('Script expirado.');
    }
    if (script.daily_limit > 0) {
      const today = new Date().toISOString().split('T')[0];
      const todayCount = (await pool.query('SELECT COUNT(*) FROM execution_logs WHERE script_id = $1 AND DATE(created_at) = $2', [script.id, today])).rows[0].count;
      if (todayCount >= script.daily_limit) return res.status(429).send('Limite diário de execuções atingido.');
    }
    if (!script.silent) {
      await pool.query('UPDATE scripts SET executions = executions + 1 WHERE id = $1', [script.id]);
    }
    const ip = req.ip || req.connection.remoteAddress;
    const country = req.headers['cf-ipcountry'] || await getCountry(ip);
    await pool.query('INSERT INTO execution_logs (script_id, ip, country, user_agent) VALUES ($1,$2,$3,$4)', [script.id, ip, country, ua]);
    res.type('text/plain').send(script.content);
  } catch (err) {
    res.status(500).send('Erro interno');
  }
});

/* ============================================================
   PÁGINAS
   ============================================================ */
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/painel', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/login.html')));
app.get('/painel/dashboard', auth, (req, res) => res.sendFile(path.join(__dirname, 'public/admin/dashboard.html')));

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
(async () => {
  try {
    await initDatabase();
    const adminExists = await pool.query('SELECT id FROM admins WHERE LOWER(username) = LOWER($1)', [ADMIN_USER]);
    if (adminExists.rows.length === 0) {
      const hash = await bcrypt.hash(ADMIN_PASS, 10);
      await pool.query('INSERT INTO admins (username, password_hash, role) VALUES ($1, $2, $3)', [ADMIN_USER, hash, 'master']);
      console.log(`✅ Admin master criado: ${ADMIN_USER}`);
    }
  } catch (err) {
    console.error('⚠️ PostgreSQL indisponível:', err.message);
    console.error('O servidor continuará rodando, mas sem banco de dados.');
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🪐 Astro rodando na porta ${PORT}`);
  });
})();