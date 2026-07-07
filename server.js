const express = require('express');
const path = require('path');
const axios = require('axios');
const { Client } = require('discord.js-selfbot-v13');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// ==================== VOICE FARMER ====================
const voiceClients = new Map();

app.post('/api/voice/start', async (req, res) => {
    const { token, guildId, channelId } = req.body;
    if (!token || !guildId || !channelId) {
        return res.status(400).json({ error: 'Dados incompletos.' });
    }

    if (voiceClients.has(token)) {
        try { voiceClients.get(token).destroy(); } catch (e) {}
        voiceClients.delete(token);
    }

    const client = new Client({ checkUpdate: false });
    voiceClients.set(token, client);

    client.once('ready', async () => {
        try {
            const guild = client.guilds.cache.get(guildId);
            if (!guild) return res.json({ error: 'Servidor não encontrado.' });
            const channel = guild.channels.cache.get(channelId);
            if (!channel || (channel.type !== 'GUILD_VOICE' && channel.type !== 'GUILD_STAGE_VOICE')) {
                return res.json({ error: 'Canal de voz inválido.' });
            }
            await channel.join();
            res.json({ success: true, message: `Conectado a ${channel.name}` });
        } catch (err) {
            res.json({ error: err.message });
        }
    });

    client.login(token).catch(err => {
        res.status(401).json({ error: 'Token inválido ou erro de login.' });
        voiceClients.delete(token);
    });
});

app.post('/api/voice/stop', (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token não fornecido.' });
    if (voiceClients.has(token)) {
        try { voiceClients.get(token).destroy(); } catch (e) {}
        voiceClients.delete(token);
        res.json({ success: true, message: 'Desconectado.' });
    } else {
        res.json({ error: 'Nenhuma conexão ativa para este token.' });
    }
});

// ==================== PROXY: VERIFICAÇÃO DE NICK ====================
app.post('/api/check-username', async (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username não fornecido.' });

    try {
        const response = await axios.post(
            'https://discord.com/api/v9/unique-username/username-attempt-unauthed',
            { username },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (compatible; NovaHub/1.0)'
                },
                timeout: 5000
            }
        );
        const available = response.data.taken === false;
        res.json({ available });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao verificar a disponibilidade.' });
    }
});

// ==================== ROTAS DE PÁGINAS ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Fallback para SPA (opcional)
app.get('*', (req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});