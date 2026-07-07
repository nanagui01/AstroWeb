// voicefarmer.js — Módulo Voice Farmer (versão corrigida)

const VoiceFarmer = (function() {
    let activeConnection = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5;
    let reconnectTimeout = null;
    let autoReconnectEnabled = true;
    let scheduleInterval = null;
    let lastHeartbeatSent = 0;   // timestamp do último heartbeat enviado
    let pingValue = 0;

    function getConfig() {
        const raw = localStorage.getItem('novaHub_voiceConfig');
        return raw ? JSON.parse(raw) : {};
    }

    function saveConfig(config) {
        const current = getConfig();
        const updated = { ...current, ...config };
        localStorage.setItem('novaHub_voiceConfig', JSON.stringify(updated));
    }

    function deleteConfig() {
        localStorage.removeItem('novaHub_voiceConfig');
    }

    function getSchedule() {
        const config = getConfig();
        return config.schedule || null;
    }

    function saveSchedule(schedule) {
        saveConfig({ schedule });
    }

    function getHistory() {
        return JSON.parse(localStorage.getItem('novaHub_voiceHistory') || '[]');
    }

    function addHistoryRecord(record) {
        const history = getHistory();
        history.unshift(record);
        if (history.length > 50) history.pop();
        localStorage.setItem('novaHub_voiceHistory', JSON.stringify(history));
    }

    function isConnected() {
        return activeConnection !== null && activeConnection.ws && activeConnection.ws.readyState === WebSocket.OPEN;
    }

    function getConnectionTime() {
        if (!isConnected() || !activeConnection.connectedAt) return '0s';
        const diff = Math.floor((Date.now() - activeConnection.connectedAt) / 1000);
        const h = Math.floor(diff / 3600);
        const m = Math.floor((diff % 3600) / 60);
        const s = diff % 60;
        return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
    }

    function getPing() {
        return isConnected() ? pingValue : null;
    }

    // Envia heartbeat uma única vez (chamado pelo heartbeatInterval)
    function sendHeartbeat(ws, sequence) {
        lastHeartbeatSent = Date.now();
        ws.send(JSON.stringify({ op: 1, d: sequence ?? null }));
    }

    function fullStop() {
        if (activeConnection) {
            try {
                const { ws, heartbeatInterval } = activeConnection;
                if (heartbeatInterval) clearInterval(heartbeatInterval);
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ op: 4, d: { guild_id: null, channel_id: null, self_mute: false, self_deaf: false } }));
                }
                ws.close();
            } catch (e) {}
            if (activeConnection.connectedAt) {
                const duration = Math.floor((Date.now() - activeConnection.connectedAt) / 1000);
                addHistoryRecord({
                    guildId: activeConnection.guildId,
                    channelId: activeConnection.channelId,
                    startTime: new Date(activeConnection.connectedAt).toISOString(),
                    endTime: new Date().toISOString(),
                    durationSeconds: duration
                });
            }
            activeConnection = null;
        }
        if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
        if (scheduleInterval) { clearInterval(scheduleInterval); scheduleInterval = null; }
        reconnectAttempts = 0;
        pingValue = 0;
    }

    async function start(token, guildId, channelId, statusCallback) {
        if (isConnected()) {
            statusCallback('error', 'Já existe uma conexão ativa.');
            return;
        }
        saveConfig({ lastGuildId: guildId, lastChannelId: channelId, autoReconnect: autoReconnectEnabled });
        await connect(token, guildId, channelId, statusCallback);
    }

    async function connect(token, guildId, channelId, statusCallback) {
        try {
            // Verifica canal
            const channelRes = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
                headers: { Authorization: token }
            });
            if (!channelRes.ok) {
                statusCallback('error', 'Canal não encontrado ou sem acesso.');
                return;
            }
            const channel = await channelRes.json();
            if (channel.type !== 2 && channel.type !== 13) {
                statusCallback('error', 'O ID não é de um canal de voz (tipo 2 ou 13).');
                return;
            }

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
            let resolved = false; // para garantir que o ready só processe uma vez

            ws.onopen = () => {
                statusCallback('log', 'WebSocket conectado, identificando...');
            };

            ws.onmessage = (event) => {
                const payload = JSON.parse(event.data);
                const { op, d, s, t } = payload;
                if (s !== undefined) sequence = s;

                switch (op) {
                    case 10: { // Hello
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
                        // Inicia heartbeat com intervalo sugerido
                        heartbeatInterval = setInterval(() => sendHeartbeat(ws, sequence), heartbeat_interval);
                        break;
                    }
                    case 11: // Heartbeat ACK – calcula ping
                        pingValue = Date.now() - lastHeartbeatSent;
                        break;
                    case 0: // Dispatch
                        if (t === 'READY' && !resolved) {
                            resolved = true;
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
                            statusCallback('connected', `Conectado ao canal <#${channelId}>`);
                            reconnectAttempts = 0;
                        } else if (t === 'VOICE_STATE_UPDATE') {
                            const userId = getUserIdFromToken(token);
                            // Só age se for o nosso usuário e o canal for null (significa que saiu)
                            if (d.user_id === userId && d.channel_id === null && isConnected()) {
                                statusCallback('log', 'Você saiu do canal.');
                                fullStop();
                                if (statusCallback.onStop) statusCallback.onStop();
                                if (autoReconnectEnabled && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                                    statusCallback('log', `Tentando reconectar em 5s (${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})...`);
                                    reconnectAttempts++;
                                    reconnectTimeout = setTimeout(() => connect(token, guildId, channelId, statusCallback), 5000);
                                }
                            }
                        }
                        break;
                }
            };

            ws.onclose = () => {
                if (heartbeatInterval) clearInterval(heartbeatInterval);
                if (isConnected()) {
                    statusCallback('log', 'Conexão fechada pelo servidor.');
                    fullStop();
                    if (statusCallback.onStop) statusCallback.onStop();
                }
            };

            ws.onerror = (error) => {
                statusCallback('error', 'Erro na conexão WebSocket.');
                fullStop();
                if (statusCallback.onStop) statusCallback.onStop();
            };

        } catch (error) {
            statusCallback('error', `Erro: ${error.message}`);
            fullStop();
        }
    }

    function stop(statusCallback) {
        if (!isConnected()) return false;
        fullStop();
        if (statusCallback) statusCallback('disconnected', 'Desconectado manualmente.');
        return true;
    }

    function setAutoReconnect(enabled) {
        autoReconnectEnabled = enabled;
        saveConfig({ autoReconnect: enabled });
    }

    function isAutoReconnectEnabled() {
        return autoReconnectEnabled;
    }

    function checkSchedule(token, statusCallback) {
        const schedule = getSchedule();
        if (!schedule || !schedule.enabled) return;
        const now = new Date();
        const start = new Date(schedule.start);
        const end = new Date(schedule.end);
        if (now >= start && now <= end && !isConnected()) {
            const config = getConfig();
            if (config.lastGuildId && config.lastChannelId) {
                statusCallback('log', 'Iniciando agendamento automático...');
                start(token, config.lastGuildId, config.lastChannelId, statusCallback);
            }
        } else if (now > end && isConnected()) {
            statusCallback('log', 'Encerrando agendamento automático...');
            stop(statusCallback);
        }
    }

    function enableSchedule(startISO, endISO, token, statusCallback) {
        saveSchedule({ start: startISO, end: endISO, enabled: true });
        if (scheduleInterval) clearInterval(scheduleInterval);
        scheduleInterval = setInterval(() => checkSchedule(token, statusCallback), 30000);
    }

    function disableSchedule() {
        saveSchedule({ ...getSchedule(), enabled: false });
        if (scheduleInterval) { clearInterval(scheduleInterval); scheduleInterval = null; }
    }

    function getUserIdFromToken(token) {
        try {
            const encoded = token.split('.')[0];
            const decoded = atob(encoded);
            return JSON.parse(decoded).id || null;
        } catch (e) { return null; }
    }

    return {
        start,
        stop,
        isConnected,
        getConnectionTime,
        getPing,
        getConfig,
        getHistory,
        setAutoReconnect,
        isAutoReconnectEnabled,
        enableSchedule,
        disableSchedule,
        getSchedule,
        fullStop
    };
})();