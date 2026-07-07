// voicefarmer.js — Módulo Voice Farmer completo com seleção de servidor/canal, agendamento, histórico, ping, auto-reconexão

const VoiceFarmer = (function() {
    // Estado interno
    let activeConnection = null; // { ws, guildId, channelId, heartbeatInterval, connectedAt, lastPing, ping }
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5;
    let reconnectTimeout = null;
    let autoReconnectEnabled = true; // padrão ativo
    let scheduleInterval = null;
    let pingInterval = null;

    // Configuração e persistência
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
        return config.schedule || null; // { start: ISO string, end: ISO string, enabled: boolean }
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

    // Verificar se estamos conectados
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
        return activeConnection?.ping || null;
    }

    // Parar tudo (desconectar e limpar temporizadores)
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
            // Salvar tempo no histórico
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
        if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
        reconnectAttempts = 0;
    }

    // Função principal para iniciar conexão
    async function start(token, guildId, channelId, statusCallback) {
        if (isConnected()) {
            statusCallback('error', 'Já existe uma conexão ativa. Desconecte primeiro.');
            return;
        }

        // Salvar configuração para possível reconexão
        saveConfig({ lastGuildId: guildId, lastChannelId: channelId, autoReconnect: autoReconnectEnabled });

        await connect(token, guildId, channelId, statusCallback);
    }

    async function connect(token, guildId, channelId, statusCallback) {
        try {
            // Verificar canal
            const channelRes = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
                headers: { Authorization: token }
            });
            if (!channelRes.ok) {
                statusCallback('error', 'Canal não encontrado ou sem acesso.');
                return;
            }
            const channel = await channelRes.json();
            if (channel.type !== 2 && channel.type !== 13) {
                statusCallback('error', 'O ID fornecido não é um canal de voz (precisa ser tipo 2 ou 13).');
                return;
            }

            // Gateway
            const gatewayRes = await fetch('https://discord.com/api/v10/gateway', {
                headers: { Authorization: token }
            });
            if (!gatewayRes.ok) {
                statusCallback('error', 'Não foi possível obter o gateway.');
                return;
            }
            const gatewayData = await gatewayRes.json();
            const gatewayUrl = `${gatewayData.url}/?v=10&encoding=json`;

            const ws = new WebSocket(gatewayUrl);
            let heartbeatInterval;
            let sequence = null;
            let lastPingSent = Date.now();
            let pingValue = 0;

            // Ping monitor
            function monitorPing() {
                if (!ws || ws.readyState !== WebSocket.OPEN) return;
                lastPingSent = Date.now();
                ws.send(JSON.stringify({ op: 1, d: sequence }));
            }

            ws.onopen = () => {
                statusCallback('log', 'WebSocket conectado, identificando...');
                // Iniciar monitoramento de ping
                pingInterval = setInterval(monitorPing, 5000);
                monitorPing();
            };

            ws.onmessage = (event) => {
                const payload = JSON.parse(event.data);
                const { op, d, s, t } = payload;
                if (s) sequence = s;

                if (op === 10) {
                    const { heartbeat_interval } = d;
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
                    heartbeatInterval = setInterval(() => {
                        ws.send(JSON.stringify({ op: 1, d: sequence }));
                    }, heartbeat_interval);
                }

                if (op === 11) {
                    // Heartbeat ACK → calcular ping
                    pingValue = Date.now() - lastPingSent;
                    if (activeConnection) activeConnection.ping = pingValue;
                }

                if (t === 'READY') {
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
                        connectedAt: Date.now(),
                        ping: 0
                    };
                    statusCallback('connected', `Conectado ao canal <#${channelId}>`);
                    reconnectAttempts = 0;
                }

                if (t === 'VOICE_STATE_UPDATE') {
                    // Se o próprio usuário saiu do canal, tentar reconectar se autoReconnect ativo
                    const userId = getUserIdFromToken(token);
                    if (d.user_id === userId && d.channel_id === null) {
                        if (autoReconnectEnabled && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                            statusCallback('log', `Conexão perdida. Tentando reconectar (${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})...`);
                            fullStop(); // limpa conexão atual, mas mantém schedule e histórico
                            reconnectAttempts++;
                            reconnectTimeout = setTimeout(() => {
                                connect(token, guildId, channelId, statusCallback);
                            }, 5000);
                        } else {
                            statusCallback('disconnected', 'Desconectado do canal (não será reconectado).');
                            fullStop();
                            if (statusCallback.onStop) statusCallback.onStop();
                        }
                    }
                }
            };

            ws.onclose = () => {
                if (heartbeatInterval) clearInterval(heartbeatInterval);
                if (pingInterval) clearInterval(pingInterval);
                // A reconexão é tratada no VOICE_STATE_UPDATE
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

    // Auto-reconexão toggle
    function setAutoReconnect(enabled) {
        autoReconnectEnabled = enabled;
        saveConfig({ autoReconnect: enabled });
    }

    function isAutoReconnectEnabled() {
        return autoReconnectEnabled;
    }

    // Agendamento
    function checkSchedule(token, statusCallback) {
        const schedule = getSchedule();
        if (!schedule || !schedule.enabled) return;
        const now = new Date();
        const start = new Date(schedule.start);
        const end = new Date(schedule.end);
        if (now >= start && now <= end && !isConnected()) {
            const config = getConfig();
            const guildId = config.lastGuildId;
            const channelId = config.lastChannelId;
            if (guildId && channelId) {
                statusCallback('log', 'Iniciando agendamento automático...');
                start(token, guildId, channelId, statusCallback);
            }
        } else if (now > end && isConnected()) {
            statusCallback('log', 'Encerrando agendamento automático...');
            stop(statusCallback);
        }
    }

    function enableSchedule(startISO, endISO, token, statusCallback) {
        saveSchedule({ start: startISO, end: endISO, enabled: true });
        // Configurar verificação periódica
        if (scheduleInterval) clearInterval(scheduleInterval);
        scheduleInterval = setInterval(() => checkSchedule(token, statusCallback), 30000); // verifica a cada 30s
    }

    function disableSchedule() {
        saveSchedule({ ...getSchedule(), enabled: false });
        if (scheduleInterval) { clearInterval(scheduleInterval); scheduleInterval = null; }
    }

    // Obter ID do token (base64 decode)
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