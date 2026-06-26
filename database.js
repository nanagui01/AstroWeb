const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

let DB = {
  admins: [],
  scripts: []
};

// Carregar do arquivo
try {
  if (fs.existsSync(DB_PATH)) {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    DB = JSON.parse(raw);
  } else {
    saveDb(); // cria o arquivo
  }
} catch (e) {
  console.error('Erro ao carregar banco:', e.message);
}

function saveDb() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(DB, null, 2));
  } catch (e) {
    console.error('Erro ao salvar banco:', e.message);
  }
}

module.exports = { DB, saveDb };