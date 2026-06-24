require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { initDatabase, getDb, saveDb } = require('./database');
const bcrypt = require('bcryptjs');

const authRoutes = require('./routes/auth');
const scriptsRoutes = require('./routes/scripts');
const keysRoutes = require('./routes/keys');
const loaderRoutes = require('./routes/loader');

const app = express();
const PORT = process.env.PORT || 3000;

const DB_PATH = path.join(__dirname, 'saturn.db');
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
  console.log('🗑️ Banco antigo removido');
}

app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

app.use((req, res, next) => {
  req.db = getDb();
  req.saveDb = saveDb;
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/scripts', scriptsRoutes);
app.use('/api/keys', keysRoutes);
app.use('/api/load', loaderRoutes);

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/reset-admin', (req, res) => {
  const db = getDb();
  const email = 'nanagui@youtubepontucom';
  const password = '001010GGZEHEN';
  db.run('DELETE FROM admins');
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO admins (email, password_hash) VALUES (?, ?)').run([email, hash]);
  saveDb();
  res.json({ success: true, email, password });
});

(async () => {
  try {
    await initDatabase();
    const db = getDb();
    const adminEmail = process.env.ADMIN_EMAIL || 'nanagui@youtubepontucom';
    const adminPassword = process.env.ADMIN_PASSWORD || '001010GGZEHEN';

    const hash = bcrypt.hashSync(adminPassword, 10);
    db.prepare('INSERT INTO admins (email, password_hash) VALUES (?, ?)').run([adminEmail, hash]);
    saveDb();

    console.log(`✅ Admin criado: ${adminEmail}`);
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🪐 Rodando na porta ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Erro:', error);
    process.exit(1);
  }
})();