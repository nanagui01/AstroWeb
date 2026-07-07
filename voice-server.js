// voice-server.js — Servidor de controle do Voice Farmer
const express = require('express');
const { Client } = require('discord.js-selfbot-v13');
const app = express();
app.use(express.json());

// Armazena clientes ativos por token (apenas um por vez)
const clients = new Map();

// Iniciar Voice Farmer
app.post('/api/voice/start', async (req, res) => {
    const { token, guildId, channelId } = req.body;
    if (!token || !guildId || !channelId) {
        return res.status(400).json({ error: 'Dados incompletos.' });
    }

    // Se já existe um cliente para esse token, desconecta primeiro
    if (clients.has(token)) {
        const old = clients.get(token);
        try { old.destroy(); } catch (e) {}
        clients.delete(token);
    }

    const client = new Client({ checkUpdate: false });
    clients.set(token, client);

    client.on('ready', async () => {
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
        res.status(401).json({ error: 'Token inválido.' });
    });
});

// Parar Voice Farmer
app.post('/api/voice/stop', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token não fornecido.' });
    if (clients.has(token)) {
        const client = clients.get(token);
        try { client.destroy(); } catch (e) {}
        clients.delete(token);
        res.json({ success: true, message: 'Desconectado.' });
    } else {
        res.json({ error: 'Nenhuma conexão ativa para esse token.' });
    }
});

// Status
app.get('/api/voice/status', (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token não fornecido.' });
    const client = clients.get(token);
    res.json({ connected: !!client && client.voice?.connections?.size > 0 });
});

const PORT = process.env.VOICE_PORT || 3001;
app.listen(PORT, () => {
    console.log(`Voice Farmer API rodando na porta ${PORT}`);
});