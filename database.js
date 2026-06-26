const fs = require('fs');
const path = require('path');

const DB_PATH = path.join('/tmp', 'saturn-data.json');

let DB = {
  admins: [],
  scripts: [],
  versions: [],
  keys: [],
  executionLogs: []
};

function loadDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      DB = JSON.parse(raw);
      console.log('✅ Banco carregado do disco');
    } else {
      saveDb();
      console.log('🆕 Banco novo criado');
    }
  } catch (e) {
    console.error('Erro ao carregar banco:', e.message);
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(DB, null, 2), 'utf-8');
  } catch (e) {
    console.error('Erro ao salvar banco:', e.message);
  }
}

// Inicializa
loadDb();

module.exports = {
  DB,
  saveDb
};