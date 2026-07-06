const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// CSS
app.get('/style.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'style.css'));
});

// Página única
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Qualquer outra rota → também mostra a página principal (evita 404)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Dashboard rodando na porta ${PORT}`);
});