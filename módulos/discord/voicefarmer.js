// voicefarmer.js — Módulo Voice Farmer (controla backend)

const VoiceFarmer = (function() {
    const API_URL = '/api/voice'; // ou 'http://localhost:3001' se separado

    let currentToken = null;
    let connected = false;

    function isConnected() {
        return connected;
    }

    async function start(token, guildId, channelId, statusCallback) {
        if (connected) {
            statusCallback('error', 'Já conectado.');
            return;
        }
        try {
            const res = await fetch(`${API_URL}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, guildId, channelId })
            });
            const data = await res.json();
            if (data.success) {
                connected = true;
                currentToken = token;
                statusCallback('connected', data.message);
            } else {
                statusCallback('error', data.error || 'Erro desconhecido.');
            }
        } catch (e) {
            statusCallback('error', `Erro de rede: ${e.message}`);
        }
    }

    async function stop(statusCallback) {
        if (!connected || !currentToken) {
            if (statusCallback) statusCallback('error', 'Não conectado.');
            return;
        }
        try {
            const res = await fetch(`${API_URL}/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: currentToken })
            });
            const data = await res.json();
            connected = false;
            currentToken = null;
            if (statusCallback) statusCallback('disconnected', data.message || 'Desconectado.');
        } catch (e) {
            if (statusCallback) statusCallback('error', `Erro: ${e.message}`);
        }
    }

    // As demais funções (getConfig, saveConfig, etc.) permanecem iguais
    function getConfig() {
        const raw = localStorage.getItem('novaHub_voiceConfig');
        return raw ? JSON.parse(raw) : {};
    }

    function saveConfig(config) {
        const current = getConfig();
        const updated = { ...current, ...config };
        localStorage.setItem('novaHub_voiceConfig', JSON.stringify(updated));
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

    function getConnectionTime() {
        return '—';
    }

    function getPing() {
        return null;
    }

    function setAutoReconnect(enabled) {
        localStorage.setItem('novaHub_autoReconnect', enabled);
    }

    function isAutoReconnectEnabled() {
        return localStorage.getItem('novaHub_autoReconnect') !== 'false';
    }

    function getSchedule() {
        const config = getConfig();
        return config.schedule || null;
    }

    function saveSchedule(schedule) {
        saveConfig({ schedule });
    }

    function checkSchedule(token, statusCallback) {
        // agendamento pode chamar start/stop diretamente
    }

    function enableSchedule(startISO, endISO, token, statusCallback) {
        saveSchedule({ start: startISO, end: endISO, enabled: true });
    }

    function disableSchedule() {
        saveSchedule({ ...getSchedule(), enabled: false });
    }

    function fullStop() {
        stop();
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