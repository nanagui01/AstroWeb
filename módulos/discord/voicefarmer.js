// voicefarmer.js - Módulo Voice Farmer (front-end)
const VoiceFarmer = (function() {
    let activeConnection = null; // { ws, guildId, channelId, heartbeatInterval, connectedAt }

    function getConfig() {
        const raw = localStorage.getItem('novaHub_voiceConfig');
        return raw ? JSON.parse(raw) : null;
    }

    function saveConfig(config) {
        localStorage.setItem('novaHub_voiceConfig', JSON.stringify(config));
    }

    function deleteConfig() {
        localStorage.removeItem('novaHub_voiceConfig');
    }

    function isConnected() {
        return activeConnection !== null && activeConnection.ws.readyState === WebSocket.OPEN;
    }

    function getConnectionTime() {
        if (!activeConnection || !activeConnection.connectedAt) return null;
        const diff = Math.floor((Date.now() - activeConnection.connectedAt) / 1000);
        const h = Math.floor(diff / 3600);
        const m = Math.floor((diff % 3600) / 60);
        const s = diff % 60;
        return `${h}h ${m}m ${s}s`;
    }

    async function start(token, guildId, channelId, statusCallback) {
        if (activeConnection) {
            statusCallback('error', 'Já existe uma conexão ativa.');
            return;
        }

        try {
            // Verificar canal
            const channelRes = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
                headers: { Authorization: token }
            });
            if (!channelRes.ok) {
                statusCallback('error', 'Canal não encontrado. Verifique o ID.');
                return;
            }
            const channel = await channelRes.json();
            if (channel.type !== 2 && channel.type !== 13) {
                statusCallback('error', 'O ID não é de um canal de voz.');
                return;
            }

            // Obter gateway
            const gatewayRes = await fetch('https://discord.com/api/v10/gateway', {
                headers: { Authorization: token }
            });
            if (!gatewayRes.ok) {
                statusCallback('error', 'Não foi possível obter gateway.');
                return;
            }
            const gatewayData = await gatewayRes.json();
            const gatewayUrl = `${gatewayData.url}/?v=10&encoding=json`;

            const ws = new WebSocket(gatewayUrl);
            let heartbeatInterval;
            let sequence = null;

            ws.onopen = () => {
                statusCallback('log', 'WebSocket conectado, identificando...');
            };

            ws.onmessage = (event) => {
                const payload = JSON.parse(event.data);
                const { op, d, s, t } = payload;
                if (s) sequence = s;

                if (op === 10) {
                    const { heartbeat_interval } = d;
                    // Identificar
                    ws.send(JSON.stringify({
                        op: 2,
                        d: {
                            token: token,
                            properties: {
                                '$os': 'linux',
                                '$browser': 'Discord Client',
                                '$device': 'discord.js'
                            }
                        }
                    }));
                    // Heartbeat
                    heartbeatInterval = setInterval(() => {
                        ws.send(JSON.stringify({ op: 1, d: sequence }));
                    }, heartbeat_interval);
                }

                if (t === 'READY') {
                    // Conectar ao canal de voz
                    ws.send(JSON.stringify({
                        op: 4,
                        d: {
                            guild_id: guildId,
                            channel_id: channelId,
                            self_mute: false,
                            self_deaf: false
                        }
                    }));
                    activeConnection = {
                        ws,
                        guildId,
                        channelId,
                        heartbeatInterval,
                        connectedAt: Date.now()
                    };
                    saveConfig({ guildId, channelId, connectedAt: Date.now() });
                    statusCallback('connected', `Conectado ao canal de voz!`);
                }

                if (t === 'VOICE_STATE_UPDATE') {
                    // Verifica se o próprio usuário saiu do canal
                    if (d.user_id === getUserIdFromToken(token) && d.channel_id === null) {
                        stop();
                        statusCallback('disconnected', 'Você saiu do canal de voz.');
                    }
                }
            };

            ws.onclose = () => {
                if (heartbeatInterval) clearInterval(heartbeatInterval);
                if (activeConnection) {
                    activeConnection = null;
                    statusCallback('disconnected', 'Conexão fechada.');
                }
            };

            ws.onerror = (error) => {
                statusCallback('error', 'Erro na conexão WebSocket.');
                stop();
            };

        } catch (error) {
            statusCallback('error', `Erro: ${error.message}`);
        }
    }

    function stop() {
        if (!activeConnection) return false;
        const { ws, heartbeatInterval } = activeConnection;
        try {
            ws.send(JSON.stringify({
                op: 4,
                d: {
                    guild_id: null,
                    channel_id: null,
                    self_mute: false,
                    self_deaf: false
                }
            }));
        } catch (e) {}
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        ws.close();
        activeConnection = null;
        deleteConfig();
        return true;
    }

    // Decodifica ID do token (primeira parte base64)
    function getUserIdFromToken(token) {
        try {
            const encoded = token.split('.')[0];
            const decoded = atob(encoded);
            return JSON.parse(decoded).id || null;
        } catch (e) {
            return null;
        }
    }

    return { start, stop, isConnected, getConfig, getConnectionTime, saveConfig };
})();