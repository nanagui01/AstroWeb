
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { initDatabase, getDb, saveDb } = require('./database');
const bcrypt = require('bcryptjs');

const authRoutes = require('./routes/auth');
const scriptsRoutes = require('./routes/scripts');
const loadRoutes = require('./routes/load');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Injeta banco nas requisições
app.use((req, res, next) => {
  req.db = getDb();
  req.saveDb = saveDb;
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/scripts', scriptsRoutes);
app.use('/api/load', loadRoutes);

// Rotas de páginas
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html')));

(async () => {
  await initDatabase();
  const db = getDb();

  // Criar admin padrão
  const username = process.env.ADMIN_USER || 'nanagui';
  const password = process.env.ADMIN_PASS || '001010GGZEHEN';
  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get([username]);
  if (!existing) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run([username, hash]);
    saveDb();
    console.log(`✅ Admin criado: ${username}`);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🪐 Saturn Storage rodando em http://0.0.0.0:${PORT}`);
  });
})();