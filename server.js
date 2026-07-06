const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Rota para o arquivo CSS (requisitado pelas páginas)
app.get('/style.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'style.css'));
});

// Página de login
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Painel de ferramentas
app.get('/tools', (req, res) => {
  res.sendFile(path.join(__dirname, 'tools.html'));
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});