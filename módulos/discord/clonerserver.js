// clonerserver.js - Módulo de clonagem de servidores (front-end)
const ClonerServer = (function() {
    let abortController = null;

    async function clonarServidor(token, origemId, destinoId, tipo, excluir, logCallback, signal) {
        const headers = { Authorization: token, 'Content-Type': 'application/json' };
        const base = 'https://discord.com/api/v10';
        const opts = {
            cargos: tipo === 'tudo' || tipo.includes('cargos'),
            canais: tipo === 'tudo' || tipo.includes('canais'),
            emojis: tipo === 'tudo' || tipo.includes('emojis')
        };

        logCallback('Verificando servidores...');
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const [orig, dest] = await Promise.all([
            fetch(`${base}/guilds/${origemId}`, { headers, signal }).then(r => r.ok ? r.json() : Promise.reject(new Error('Origem inacessível'))),
            fetch(`${base}/guilds/${destinoId}`, { headers, signal }).then(r => r.ok ? r.json() : Promise.reject(new Error('Destino inacessível')))
        ]);

        const everyoneId = dest.roles.find(r => r.name === '@everyone')?.id;
        if (!everyoneId) throw new Error('@everyone não encontrado no destino');

        const roleMap = {};
        const totalSteps = (opts.cargos ? 1 : 0) + (opts.canais ? 1 : 0) + (opts.emojis ? 1 : 0) + (excluir ? 1 : 0);
        let step = 0;

        if (opts.cargos && excluir) {
            logCallback(`[${++step}/${totalSteps}] Deletando cargos...`);
            const roles = dest.roles.filter(r => r.name !== '@everyone');
            for (const r of roles) {
                if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
                await fetch(`${base}/guilds/${destinoId}/roles/${r.id}`, { method: 'DELETE', headers, signal });
                await new Promise(r => setTimeout(r, 200));
            }
        }
        if (opts.canais && excluir) {
            logCallback(`[${++step}/${totalSteps}] Deletando canais...`);
            const chs = await fetch(`${base}/guilds/${destinoId}/channels`, { headers, signal }).then(r => r.json());
            for (const c of chs) {
                if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
                await fetch(`${base}/channels/${c.id}`, { method: 'DELETE', headers, signal });
                await new Promise(r => setTimeout(r, 200));
            }
        }
        if (opts.cargos) {
            logCallback(`[${++step}/${totalSteps}] Clonando cargos...`);
            const roles = await fetch(`${base}/guilds/${origemId}/roles`, { headers, signal }).then(r => r.json());
            for (const role of roles.filter(r => r.name !== '@everyone')) {
                if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
                const res = await fetch(`${base}/guilds/${destinoId}/roles`, {
                    method: 'POST', headers, signal,
                    body: JSON.stringify({ name: role.name, permissions: role.permissions, color: role.color, hoist: role.hoist, mentionable: role.mentionable })
                });
                if (res.ok) { const c = await res.json(); roleMap[role.id] = c.id; }
                await new Promise(r => setTimeout(r, 400));
            }
        }
        const catMap = {};
        if (opts.canais) {
            logCallback(`[${++step}/${totalSteps}] Clonando canais...`);
            const channels = (await fetch(`${base}/guilds/${origemId}/channels`, { headers, signal }).then(r => r.json())).sort((a, b) => a.position - b.position);
            for (const ch of channels.filter(c => c.type === 4)) {
                if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
                const overwrites = ch.permission_overwrites?.map(p => ({ id: roleMap[p.id] || p.id, type: p.type, allow: p.allow, deny: p.deny })) || [];
                const res = await fetch(`${base}/guilds/${destinoId}/channels`, {
                    method: 'POST', headers, signal,
                    body: JSON.stringify({ name: ch.name, type: 4, permission_overwrites: overwrites })
                });
                if (res.ok) { const c = await res.json(); catMap[ch.id] = c.id; }
                await new Promise(r => setTimeout(r, 400));
            }
            for (const ch of channels.filter(c => c.type !== 4)) {
                if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
                const overwrites = ch.permission_overwrites?.map(p => ({ id: roleMap[p.id] || p.id, type: p.type, allow: p.allow, deny: p.deny })) || [];
                await fetch(`${base}/guilds/${destinoId}/channels`, {
                    method: 'POST', headers, signal,
                    body: JSON.stringify({ name: ch.name, type: ch.type, parent_id: catMap[ch.parent_id] || null, permission_overwrites: overwrites, topic: ch.topic, nsfw: ch.nsfw })
                });
                await new Promise(r => setTimeout(r, 400));
            }
        }
        if (opts.emojis) {
            logCallback(`[${++step}/${totalSteps}] Clonando emojis...`);
            const emojis = await fetch(`${base}/guilds/${origemId}/emojis`, { headers, signal }).then(r => r.json());
            for (const emoji of emojis) {
                if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
                const blob = await fetch(`https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}`).then(r => r.blob());
                const dataUrl = await new Promise(res => { const reader = new FileReader(); reader.onload = () => res(reader.result); reader.readAsDataURL(blob); });
                await fetch(`${base}/guilds/${destinoId}/emojis`, {
                    method: 'POST', headers, signal,
                    body: JSON.stringify({ name: emoji.name, image: dataUrl })
                });
                await new Promise(r => setTimeout(r, 600));
            }
        }
    }

    function createAbortController() {
        abortController = new AbortController();
        return abortController;
    }

    function abort() {
        if (abortController) abortController.abort();
    }

    // Histórico
    function saveHistory(origem, destino, status) {
        const history = JSON.parse(localStorage.getItem('novaHub_clonerHistory') || '[]');
        history.unshift({ origem, destino, status, time: new Date().toLocaleString() });
        if (history.length > 5) history.pop();
        localStorage.setItem('novaHub_clonerHistory', JSON.stringify(history));
    }

    function getHistory() {
        return JSON.parse(localStorage.getItem('novaHub_clonerHistory') || '[]');
    }

    return { clonarServidor, createAbortController, abort, saveHistory, getHistory };
})();