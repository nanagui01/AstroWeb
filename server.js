// server.js — Storm Hub (Sem Keys, Sem Discord, Foco em Segurança e Camuflagem de Scripts)
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
const { Pool } = require('pg');

// ============================================================
// CONFIGURAÇÕES
// ============================================================
const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_SECRET = process.env.COOKIE_SECRET;
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
const ADMIN_PATH = '/lgadm';

const LOGIN_MAX_ATTEMPTS = parseInt(process.env.LOGIN_MAX_ATTEMPTS || '5', 10);
const LOGIN_LOCK_MINUTES = parseInt(process.env.LOGIN_LOCK_MINUTES || '15', 10);

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
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser(COOKIE_SECRET));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// HELPERS GERAIS
// ============================================================
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function getClientIp(req) {
  return req.ip || req.connection?.remoteAddress || '';
}

function hashIp(ip) {
  return crypto.createHmac('sha256', COOKIE_SECRET).update(ip || '').digest('hex').substring(0, 32);
}

function shortId() { return crypto.randomBytes(8).toString('hex'); }
function secureToken() { return crypto.randomBytes(16).toString('hex'); }

// ============================================================
// MIDDLEWARES DE SEGURANÇA E CAMUFLAGEM
// ============================================================

// Falsa página de erro para enganar curiosos no navegador
const fakeErrorPage = `
<html>
<head><title>404 Not Found</title></head>
<body bgcolor="white">
<center><h1>404 Not Found</h1></center>
<hr><center>nginx/1.18.0 (Ubuntu)</center>
</body>
</html>
`;

// Bloqueio de IP Admin (Painel)
app.use(ah(async (req, res, next) => {
  const ip = getClientIp(req);
  if (!ip) return next();
  try {
    const r = await pool.query('SELECT ip FROM blocked_ips WHERE ip = $1', [ip]);
    if (r.rows.length) return res.status(403).send('Acesso bloqueado.');
  } catch {}
  next();
}));

// Restrição estrita para o Roblox Client com camuflagem de erro 404
function ensureRobloxClient(req, res, next) {
  const userAgent = req.get('User-Agent') || '';
  
  // Se não possuir o identificador do Roblox, responde como se a URL nem existisse
  if (!userAgent.toLowerCase().includes('roblox') && !req.get('Roblox-Id')) {
    return res.status(404).send(fakeErrorPage);
  }
  
  next();
}

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: 'Muitas tentativas. Tente novamente mais tarde.' } });
const apiLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 300 });
const loaderLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 120 });
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
        service_id UUID REFERENCES services(id) ON DELETE SET NULL,
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

      CREATE TABLE IF NOT EXISTS loader_tokens (
        token TEXT PRIMARY KEY,
        script_id UUID REFERENCES scripts(id) ON DELETE CASCADE,
        ip_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_loader_tokens_expires ON loader_tokens (expires_at);
    `);

    console.log('✅ Banco de dados inicializado e migrado (Foco em Privacidade)');
  } finally {
    client.release();
  }
}

// Limpeza periódica de tokens de sessão expirados
setInterval(() => {
  pool.query("DELETE FROM loader_tokens WHERE expires_at < NOW() - INTERVAL '1 hour'").catch(() => {});
}, 15 * 60 * 1000);

// ============================================================
// MIDDLEWARE DE AUTENTICAÇÃO (PAINEL ADMIN)
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
// AUTENTICAÇÃO DO PAINEL
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
// GERENCIAMENTO DE IPS BLOQUEADOS
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
  const r = await pool.query('SELECT * FROM services ORDER BY created_at DESC');
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
// SCRIPTS (CRUD, Versões e Histórico)
// ============================================================
const SORTABLE_SCRIPT_COLUMNS = new Set(['name', 'status', 'created_at', 'updated_at', 'executions']);

app.get('/api/scripts', auth, ah(async (req, res) => {
  const page = parseInt(req.query.page) || 1, limit = Math.min(parseInt(req.query.limit) || 25, 200), offset = (page - 1) * limit;
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
  if (!Array.isArray(scripts) || scripts.length > 200) return res.status(400).json({ error: 'Formato inválido' });
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
// LOADER DE 2 ETAPAS COM CAMUFLAGEM NGINX 404
// ============================================================

// Etapa 1: Valida se a origem é o Roblox e gera o token temporário amarrado ao IP do executor
app.get('/api/loader/:short/:token', loaderLimiter, ensureRobloxClient, ah(async (req, res) => {
  if (MAINTENANCE_MODE) return res.status(503).send(fakeErrorPage);
  
  const { short, token } = req.params;
  const ipHash = hashIp(getClientIp(req));

  const script = (await pool.query('SELECT * FROM scripts WHERE short_id = $1 AND token = $2', [short, token])).rows[0];
  
  // Resposta camuflada caso o script não exista ou esteja inativo
  if (!script || script.status !== 'online') {
    return res.status(404).send(fakeErrorPage);
  }

  const sessionToken = crypto.randomBytes(24).toString('hex');
  
  // Salva o token efêmero atrelado unicamente a este IP (expira estritamente em 60s)
  await pool.query(
    `INSERT INTO loader_tokens (token, script_id, ip_hash, expires_at)
     VALUES ($1,$2,$3, NOW() + INTERVAL '60 seconds')`,
    [sessionToken, script.id, ipHash]
  );

  const secondLoader = `loadstring(game:HttpGet("${req.protocol}://${req.get('host')}/api/script/${script.id}?t=${sessionToken}"))()`;
  res.type('text/plain').send(secondLoader);
}));

// Etapa 2: Só libera o código do script original se o token for válido e o IP for idêntico ao da etapa 1
app.get('/api/script/:id', loaderLimiter, ensureRobloxClient, ah(async (req, res) => {
  const { t } = req.query;
  const ipHash = hashIp(getClientIp(req));
  
  if (!t || typeof t !== 'string') return res.status(404).send(fakeErrorPage);

  // Consome o token exigindo correspondência atômica do hash do IP
  const claim = await pool.query(
    `UPDATE loader_tokens SET used = true
     WHERE token = $1 AND script_id = $2 AND ip_hash = $3 AND used = false AND expires_at > NOW()
     RETURNING *`,
    [t, req.params.id, ipHash]
  );
  
  // Se o IP não bater (tentativa de compartilhar URL direta) ou o token expirou, simula erro 404 normal do servidor
  if (!claim.rows.length) {
    return res.status(404).send(fakeErrorPage);
  }

  const script = (await pool.query('SELECT content FROM scripts WHERE id = $1 AND status = $2', [req.params.id, 'online'])).rows[0];
  if (!script) return res.status(404).send(fakeErrorPage);

  // Contabiliza logs de uso e incrementa execução com sucesso
  await pool.query('UPDATE scripts SET executions = executions + 1 WHERE id = $1', [req.params.id]);
  await pool.query(
    'INSERT INTO execution_logs (script_id, ip, user_agent) VALUES ($1,$2,$3)', 
    [req.params.id, getClientIp(req), req.get('User-Agent')]
  );

  res.type('text/plain').send(script.content);
}));

// ============================================================
// ESTATÍSTICAS DO PAINEL
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

  res.json({
    totalScripts: parseInt(total),
    onlineScripts: parseInt(online),
    offlineScripts: parseInt(offline),
    totalExecutions: parseInt(totalExec),
    popular,
    daily
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
// ROTAS DE INTERFACE
// ============================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get(ADMIN_PATH, (req, res) => res.sendFile(path.join(__dirname, 'public/admin/login.html')));
app.get(`${ADMIN_PATH}/dashboard`, auth, (req, res) => res.sendFile(path.join(__dirname, 'public/admin/dashboard.html')));

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
// INICIALIZAÇÃO DO SERVIDOR
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
