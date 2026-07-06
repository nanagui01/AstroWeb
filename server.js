const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Servir todos os arquivos estáticos da pasta atual
app.use(express.static(__dirname));

// Rota padrão (caso alguém acesse sem especificar o arquivo)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Site rodando na porta ${PORT}`);
});