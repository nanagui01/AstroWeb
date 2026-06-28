// server.js — Backend completo Storm com Discord Bot, keys em massa e comandos
require('dotenv').config();

const requiredEnvVars = [
  'JWT_SECRET', 'COOKIE_SECRET', 'ADMIN_USER', 'ADMIN_PASS', 'DATABASE_URL',
  'DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID'
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
const { Client, GatewayIntentBits, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

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
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: IS_PRODUCTION ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
});

// Discord client
const discordClient = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

// Segurança
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

/* ============================================================
   BANCO DE DADOS
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
      -- Tabelas para o Discord
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

/* ============================================================
   HELPERS
   ============================================================ */
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
  try {
    const channelId = (await pool.query("SELECT value FROM discord_config WHERE key = 'log_channel'")).rows[0]?.value;
    if (!channelId) return;
    const channel = await discordClient.channels.fetch(channelId);
    if (channel) await channel.send(message);
  } catch {}
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
  try { const r = await pool.query('SELECT ip FROM blocked_ips WHERE ip = $1', [ip]); if (r.rows.length) return res.status(403).send('Acesso bloqueado.'); } catch {}
  next();
});

/* ============================================================
   SERVIÇOS (CRUD)
   ============================================================ */
app.get('/api/services', auth, async (req, res) => {
  const r = await pool.query('SELECT s.*, (SELECT COUNT(*) FROM keys WHERE service_id = s.id AND active = true) AS active_keys FROM services s ORDER BY s.created_at DESC');
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

/* ============================================================
   SCRIPTS (CRUD, versões, changelog, bulk, export/import)
   ============================================================ */
// (mantido igual ao anterior)
app.get('/api/scripts', auth, async (req, res) => { /* ... */ });
app.get('/api/scripts/:id', auth, async (req, res) => { /* ... */ });
app.post('/api/scripts', auth, async (req, res) => { /* ... */ });
app.put('/api/scripts/:id', auth, async (req, res) => { /* ... */ });
app.delete('/api/scripts/:id', auth, async (req, res) => { /* ... */ });
app.post('/api/scripts/:id/duplicate', auth, async (req, res) => { /* ... */ });
app.post('/api/scripts/bulk', auth, async (req, res) => { /* ... */ });
app.get('/api/scripts/:id/versions', auth, async (req, res) => { /* ... */ });
app.post('/api/scripts/:id/restore', auth, async (req, res) => { /* ... */ });
app.post('/api/scripts/:id/changelog', auth, async (req, res) => { /* ... */ });
app.get('/api/tags', auth, async (req, res) => { /* ... */ });
app.get('/api/export', auth, async (req, res) => { /* ... */ });
app.post('/api/import', auth, async (req, res) => { /* ... */ });

/* ============================================================
   KEYS (CRUD + bulk)
   ============================================================ */
app.post('/api/keys', auth, async (req, res) => {
  const { duration, service_id } = req.body;
  if (!service_id) return res.status(400).json({ error: 'service_id obrigatório' });
  const key = generateKey();
  const expires_at = duration > 0 ? new Date(Date.now() + duration * 86400000).toISOString() : null;
  const r = await pool.query('INSERT INTO keys (key, service_id, expires_at, active) VALUES ($1,$2,$3,true) RETURNING *', [key, service_id, expires_at]);
  await logKeyAction('create', key, `Key criada (serviço ${service_id})`);
  res.status(201).json(r.rows[0]);
});

// Geração em massa
app.post('/api/keys/bulk', auth, async (req, res) => {
  const { service_id, count = 1, duration } = req.body;
  if (!service_id || !count || count < 1) return res.status(400).json({ error: 'service_id e count obrigatórios' });
  const expires_at = duration > 0 ? new Date(Date.now() + duration * 86400000).toISOString() : null;
  const keys = [];
  for (let i = 0; i < count; i++) {
    const key = generateKey();
    await pool.query('INSERT INTO keys (key, service_id, expires_at, active) VALUES ($1,$2,$3,true)', [key, service_id, expires_at]);
    await logKeyAction('create', key, `Key em lote (serviço ${service_id})`);
    keys.push(key);
  }
  res.status(201).json({ keys, service_id, count });
});

app.get('/api/keys', auth, async (req, res) => { /* ... */ });
app.post('/api/keys/verify', apiLimiter, async (req, res) => { /* ... */ });
app.get('/api/keys/:id', auth, async (req, res) => { /* ... */ });
app.post('/api/keys/:id/revoke', auth, async (req, res) => { /* ... */ });
app.post('/api/keys/:id/renew', auth, async (req, res) => { /* ... */ });
app.delete('/api/keys/:id', auth, async (req, res) => { /* ... */ });

/* ============================================================
   LOADER EM DOIS ESTÁGIOS
   ============================================================ */
app.get('/api/loader/:short/:token', loaderLimiter, async (req, res) => { /* ... */ });
app.get('/api/script/:id', async (req, res) => { /* ... */ });

/* ============================================================
   ESTATÍSTICAS & ALERTAS
   ============================================================ */
app.get('/api/stats', auth, async (req, res) => { /* ... */ });
app.get('/api/alerts', auth, async (req, res) => { /* ... */ });
app.get('/api/stats/export', auth, async (req, res) => { /* ... */ });

/* ============================================================
   DISCORD BOT
   ============================================================ */
discordClient.once('ready', async () => {
  console.log(`🤖 Bot Discord logado como ${discordClient.user.tag}`);

  // Registrar slash commands
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
    await discordClient.application.commands.set(commands, process.env.DISCORD_GUILD_ID); // ou global: await discordClient.application.commands.set(commands);
    console.log('✅ Comandos registrados');
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
      // Salvar na whitelist
      await pool.query('INSERT INTO discord_whitelist (discord_id, key_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [interaction.user.id, k.id]);
      await logKeyAction('redeem_discord', keyInput, `Resgatada por ${interaction.user.tag}`);
      await sendDiscordLog(`✅ ${interaction.user.tag} resgatou a key \`${keyInput}\``);
      interaction.reply({ content: 'Key resgatada com sucesso! Agora você pode usar /getscript.', ephemeral: true });
    } catch (err) {
      interaction.reply({ content: 'Erro ao processar.', ephemeral: true });
    }
  }

  else if (commandName === 'getscript') {
    const scriptName = interaction.options.getString('script').toLowerCase();
    // Verifica se o usuário está na whitelist
    const wl = await pool.query('SELECT key_id FROM discord_whitelist WHERE discord_id = $1', [interaction.user.id]);
    if (!wl.rows.length) return interaction.reply({ content: 'Você não resgatou nenhuma key. Use /redeem primeiro.', ephemeral: true });

    // Verifica se a key ainda está ativa
    let valid = false;
    for (const row of wl.rows) {
      const k = (await pool.query('SELECT * FROM keys WHERE id = $1', [row.key_id])).rows[0];
      if (k && k.active && (!k.expires_at || new Date(k.expires_at) > new Date())) {
        valid = true;
        break;
      }
    }
    if (!valid) return interaction.reply({ content: 'Sua key expirou ou foi revogada.', ephemeral: true });

    // Busca script (suporta apenas "kaitun" por enquanto)
    const script = (await pool.query('SELECT content FROM scripts WHERE LOWER(name) = $1 AND status = $2', [scriptName, 'online'])).rows[0];
    if (!script) return interaction.reply({ content: 'Script não encontrado ou indisponível.', ephemeral: true });

    // Envia o script em mensagem efêmera
    await interaction.reply({ content: `Conteúdo do script **${scriptName}**:\n\`\`\`lua\n${script.content}\n\`\`\``, ephemeral: true });
    await sendDiscordLog(`📜 ${interaction.user.tag} solicitou o script **${scriptName}**`);
  }

  else if (commandName === 'resethwid') {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Apenas administradores podem usar este comando.', ephemeral: true });
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

/* ============================================================
   PÁGINAS
   ============================================================ */
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get(ADMIN_PATH, (req, res) => res.sendFile(path.join(__dirname, 'public/admin/login.html')));
app.get(`${ADMIN_PATH}/dashboard`, auth, (req, res) => res.sendFile(path.join(__dirname, 'public/admin/dashboard.html')));

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
      if (!bcrypt.compareSync(ADMIN_PASS, admin.password_hash)) {
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