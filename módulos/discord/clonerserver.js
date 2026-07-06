const { loadTokens } = require('./tokenManager');
const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, ButtonBuilder } = require('discord.js');

const activeServerCloners = new Map();

async function clonarServidor(interaction, token, servidorOrigemId, servidorDestinoId, options = {}) {
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    const baseUrl = 'https://discord.com/api/v10';
    const userId = interaction.user.id;

    const abortController = new AbortController();
    activeServerCloners.set(userId, { abortController, interaction });

    const headers = {
        'Authorization': token,
        'Content-Type': 'application/json'
    };
    const {
        clonarCargos = true,
        clonarCanais = true,
        clonarEmojis = true,
        excluirExistentes = true
    } = options;
    
    console.log('=== INICIANDO CLONAGEM ===');
    console.log('Options recebidas:', options);
    console.log('Clonar Cargos:', clonarCargos);
    console.log('Clonar Canais:', clonarCanais);
    console.log('Clonar Emojis:', clonarEmojis);
    console.log('Excluir Existentes:', excluirExistentes);

    async function updateStatus(content) {
        try {
            await interaction.editReply({
                content,
                embeds: [],
                components: [{
                    type: 1,
                    components: [{
                        type: 2,
                        label: 'Parar Execução',
                        style: 4,
                        custom_id: `stop_server_cloner_${userId}`
                    }]
                }]
            });
        } catch (error) {
            console.error('Não foi possível atualizar status:', error.message);
        }
    }

    async function finalStatus(content) {
        try {
            await interaction.editReply({
                content,
                embeds: [],
                components: []
            });
        } catch (error) {
            console.error('Não foi possível enviar status final:', error.message);
        }
    }

    const origemResponse = await fetch(`${baseUrl}/guilds/${servidorOrigemId}?with_counts=false`, { headers, signal: abortController.signal });
    
    if (!origemResponse.ok) {
        let errorMessage = 'Não foi possível acessar o servidor de origem.';
        
        if (origemResponse.status === 401) {
            errorMessage = 'Token inválido ou expirado. Configure um novo token.';
        } else if (origemResponse.status === 403) {
            errorMessage = 'Sem permissões para acessar o servidor de origem. Verifique se sua conta está no servidor.';
        } else if (origemResponse.status === 404) {
            errorMessage = 'Servidor de origem não encontrado. Verifique o ID.';
        } else {
            errorMessage += ` Status: ${origemResponse.status}`;
        }
        
        throw new Error(errorMessage);
    }
    
    const servidorOrigem = await origemResponse.json();
    const nomeServidorOrigem = servidorOrigem.name;

    const destinoResponse = await fetch(`${baseUrl}/guilds/${servidorDestinoId}?with_counts=false`, { headers, signal: abortController.signal });
    
    if (!destinoResponse.ok) {
        let errorMessage = 'Não foi possível acessar o servidor de destino.';
        
        if (destinoResponse.status === 401) {
            errorMessage = 'Token inválido ou expirado. Configure um novo token.';
        } else if (destinoResponse.status === 403) {
            errorMessage = 'Sem permissões para acessar o servidor de destino. Verifique se sua conta está no servidor.';
        } else if (destinoResponse.status === 404) {
            errorMessage = 'Servidor de destino não encontrado. Verifique o ID.';
        } else {
            errorMessage += ` Status: ${destinoResponse.status}`;
        }
        
        throw new Error(errorMessage);
    }
    
    const servidorDestino = await destinoResponse.json();
    const everyoneDestinoId = servidorDestino.roles.find(r => r.name === '@everyone')?.id;

    if (!everyoneDestinoId) {
        throw new Error('Não foi possível encontrar o cargo @everyone no servidor de destino.');
    }
    if (clonarCargos && excluirExistentes) {
        await updateStatus('**Deletando cargos existentes...**');

        const existingRolesResponse = await fetch(`${baseUrl}/guilds/${servidorDestinoId}/roles`, { headers, signal: abortController.signal });
        if (existingRolesResponse.ok) {
            const existingRoles = await existingRolesResponse.json();
            for (const role of existingRoles.filter(r => r.name !== '@everyone')) {
                if (abortController.signal.aborted) {
                    activeServerCloners.delete(userId);
                    await interaction.editReply({ content: '**Execução parada!**', components: [] });
                    return;
                }
                try {
                    await fetch(`${baseUrl}/guilds/${servidorDestinoId}/roles/${role.id}`, {
                        method: 'DELETE',
                        headers,
                        signal: abortController.signal
                    });
                    await new Promise(resolve => setTimeout(resolve, 300));
                } catch (error) {
                    if (error.name === 'AbortError') {
                        activeServerCloners.delete(userId);
                        await interaction.editReply({ content: '**Execução parada!**', components: [] });
                        return;
                    }
                    console.error(`Erro ao deletar cargo ${role.name}:`, error.message);
                }
            }
        }
    }
    const roleMap = {};
    if (clonarCargos) {
        await updateStatus('**Clonando cargos...**');

        const rolesResponse = await fetch(`${baseUrl}/guilds/${servidorOrigemId}/roles`, { headers, signal: abortController.signal });
        
        if (!rolesResponse.ok) {
            throw new Error(`Erro ao buscar cargos do servidor de origem. Status: ${rolesResponse.status}`);
        }
        
        const roles = await rolesResponse.json();
        const everyoneOrigem = roles.find(r => r.name === '@everyone');

        if (everyoneOrigem) {
            try {
                const updateResponse = await fetch(`${baseUrl}/guilds/${servidorDestinoId}/roles/${everyoneDestinoId}`, {
                    method: 'PATCH',
                    headers,
                    signal: abortController.signal,
                    body: JSON.stringify({
                        permissions: everyoneOrigem.permissions,
                        color: everyoneOrigem.color,
                        hoist: everyoneOrigem.hoist,
                        mentionable: everyoneOrigem.mentionable
                    })
                });
                
                if (updateResponse.ok) {
                    roleMap[everyoneOrigem.id] = everyoneDestinoId;
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    activeServerCloners.delete(userId);
                    await interaction.editReply({ content: '**Execução parada!**', components: [] });
                    return;
                }
            }
        }

        const createdRoles = [];
        const rolesToCreate = roles.filter(r => r.name !== '@everyone');

        for (const role of rolesToCreate) {
            if (abortController.signal.aborted) {
                activeServerCloners.delete(userId);
                await interaction.editReply({ content: '**Execução parada!**', components: [] });
                return;
            }
            
            try {
                const newRoleResponse = await fetch(`${baseUrl}/guilds/${servidorDestinoId}/roles`, {
                    method: 'POST',
                    headers,
                    signal: abortController.signal,
                    body: JSON.stringify({
                        name: role.name,
                        permissions: role.permissions,
                        color: role.color,
                        hoist: role.hoist,
                        mentionable: role.mentionable
                    })
                });
                
                if (newRoleResponse.ok) {
                    const createdRole = await newRoleResponse.json();
                    roleMap[role.id] = createdRole.id;
                    createdRoles.push({ ...createdRole, originalPosition: role.position });
                }
                
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                if (error.name === 'AbortError') {
                    activeServerCloners.delete(userId);
                    await interaction.editReply({ content: '**Execução parada!**', components: [] });
                    return;
                }
            }
        }

        if (createdRoles.length > 0) {
            const positionUpdates = createdRoles
                .sort((a, b) => a.originalPosition - b.originalPosition)
                .map((role, index) => ({
                    id: role.id,
                    position: index + 1
                }));

            try {
                await fetch(`${baseUrl}/guilds/${servidorDestinoId}/roles`, {
                    method: 'PATCH',
                    headers,
                    signal: abortController.signal,
                    body: JSON.stringify(positionUpdates)
                });
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                if (error.name === 'AbortError') {
                    activeServerCloners.delete(userId);
                    await interaction.editReply({ content: '**Execução parada!**', components: [] });
                    return;
                }
            }
        }
    }
    if (clonarCanais && excluirExistentes) {
        await updateStatus('**Deletando canais existentes...**');

        const existingChannelsResponse = await fetch(`${baseUrl}/guilds/${servidorDestinoId}/channels`, { headers, signal: abortController.signal });
        if (existingChannelsResponse.ok) {
            const existingChannels = await existingChannelsResponse.json();
            for (const channel of existingChannels) {
                if (abortController.signal.aborted) {
                    activeServerCloners.delete(userId);
                    await interaction.editReply({ content: '**Execução parada!**', components: [] });
                    return;
                }
                try {
                    await fetch(`${baseUrl}/channels/${channel.id}`, {
                        method: 'DELETE',
                        headers,
                        signal: abortController.signal
                    });
                    await new Promise(resolve => setTimeout(resolve, 300));
                } catch (error) {
                    if (error.name === 'AbortError') {
                        activeServerCloners.delete(userId);
                        await interaction.editReply({ content: '**Execução parada!**', components: [] });
                        return;
                    }
                }
            }
        }
    }
    const categoryMap = {};
    if (clonarCanais) {
        await updateStatus('**Clonando canais...**');

        const channelsResponse = await fetch(`${baseUrl}/guilds/${servidorOrigemId}/channels`, { headers, signal: abortController.signal });
        
        if (!channelsResponse.ok) {
            throw new Error(`Erro ao buscar canais do servidor de origem. Status: ${channelsResponse.status}`);
        }
        
        const channels = (await channelsResponse.json()).sort((a, b) => a.position - b.position);

        for (const channel of channels.filter(c => c.type === 4)) {
        if (abortController.signal.aborted) {
            activeServerCloners.delete(userId);
            await interaction.editReply({ content: '**Execução parada!**', components: [] });
            return;
        }
        
        try {
            const permissionOverwrites = channel.permission_overwrites?.map(po => ({
                id: roleMap[po.id] || po.id,
                type: po.type,
                allow: po.allow,
                deny: po.deny
            })) || [];

            const newChannelResponse = await fetch(`${baseUrl}/guilds/${servidorDestinoId}/channels`, {
                method: 'POST',
                headers,
                signal: abortController.signal,
                body: JSON.stringify({
                    name: channel.name,
                    type: channel.type,
                    position: channel.position,
                    permission_overwrites: permissionOverwrites
                })
            });
            
            if (newChannelResponse.ok) {
                const created = await newChannelResponse.json();
                categoryMap[channel.id] = created.id;
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            if (error.name === 'AbortError') {
                activeServerCloners.delete(userId);
                await interaction.editReply({ content: '**Execução parada!**', components: [] });
                return;
            }
        }
        }

        for (const channel of channels.filter(c => c.type !== 4)) {
            if (abortController.signal.aborted) {
                activeServerCloners.delete(userId);
                await interaction.editReply({ content: '**Execução parada!**', components: [] });
                return;
            }
            
            try {
                const permissionOverwrites = channel.permission_overwrites?.map(po => ({
                    id: roleMap[po.id] || po.id,
                    type: po.type,
                    allow: po.allow,
                    deny: po.deny
                })) || [];

                const channelData = {
                    name: channel.name,
                    type: channel.type,
                    position: channel.position,
                    permission_overwrites: permissionOverwrites,
                    parent_id: categoryMap[channel.parent_id] || null
                };

                if (channel.topic) channelData.topic = channel.topic;
                if (channel.nsfw !== undefined) channelData.nsfw = channel.nsfw;
                if (channel.rate_limit_per_user) channelData.rate_limit_per_user = channel.rate_limit_per_user;

                await fetch(`${baseUrl}/guilds/${servidorDestinoId}/channels`, {
                    method: 'POST',
                    headers,
                    signal: abortController.signal,
                    body: JSON.stringify(channelData)
                });
                
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                if (error.name === 'AbortError') {
                    activeServerCloners.delete(userId);
                    await interaction.editReply({ content: '**Execução parada!**', components: [] });
                    return;
                }
            }
        }
    }
    if (clonarEmojis && excluirExistentes) {
        await updateStatus('**Deletando emojis existentes...**');

        const existingEmojisResponse = await fetch(`${baseUrl}/guilds/${servidorDestinoId}/emojis`, { headers, signal: abortController.signal });
        if (existingEmojisResponse.ok) {
            const existingEmojis = await existingEmojisResponse.json();
            for (const emoji of existingEmojis) {
                if (abortController.signal.aborted) {
                    activeServerCloners.delete(userId);
                    await interaction.editReply({ content: '**Execução parada!**', components: [] });
                    return;
                }
                try {
                    await fetch(`${baseUrl}/guilds/${servidorDestinoId}/emojis/${emoji.id}`, {
                        method: 'DELETE',
                        headers,
                        signal: abortController.signal
                    });
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (error) {
                    if (error.name === 'AbortError') {
                        activeServerCloners.delete(userId);
                        await interaction.editReply({ content: '**Execução parada!**', components: [] });
                        return;
                    }
                }
            }
        }
    }
    if (clonarEmojis) {
        await updateStatus('**Clonando emojis...**');

        const emojisResponse = await fetch(`${baseUrl}/guilds/${servidorOrigemId}/emojis`, { headers, signal: abortController.signal });
        
        if (emojisResponse.ok) {
            const emojis = await emojisResponse.json();

            for (const emoji of emojis) {
                if (abortController.signal.aborted) {
                    activeServerCloners.delete(userId);
                    await interaction.editReply({ content: '**Execução parada!**', components: [] });
                    return;
                }
                
                try {
                    const imageUrl = `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}`;
                    const imageResponse = await fetch(imageUrl);
                    
                    if (!imageResponse.ok) continue;
                    
                    const imageBuffer = await imageResponse.arrayBuffer();
                    const base64Image = `data:image/${emoji.animated ? 'gif' : 'png'};base64,${Buffer.from(imageBuffer).toString('base64')}`;

                    await fetch(`${baseUrl}/guilds/${servidorDestinoId}/emojis`, {
                        method: 'POST',
                        headers,
                        signal: abortController.signal,
                        body: JSON.stringify({
                            name: emoji.name,
                            image: base64Image,
                            roles: emoji.roles?.map(r => roleMap[r]).filter(Boolean) || []
                        })
                    });
                    
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    if (error.name === 'AbortError') {
                        activeServerCloners.delete(userId);
                        await interaction.editReply({ content: '**Execução parada!**', components: [] });
                        return;
                    }
                }
            }
        }
    }

    activeServerCloners.delete(userId);
    await finalStatus(`Servidor clonado com sucesso!\n\nNovo servidor: ${nomeServidorOrigem} (${servidorDestinoId})`);

    const { sendLogEmbed } = require('../Eventos/logsManager');
    await sendLogEmbed(interaction.client, userId, interaction.guildId, 'Clonar Servidor');
}

async function stopServerCloner(userId) {
    if (activeServerCloners.has(userId)) {
        const { abortController } = activeServerCloners.get(userId);
        abortController.abort();
        return true;
    }
    return false;
}

async function handleClonarServidorModal(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const servidorOrigemId = interaction.fields.getTextInputValue('servidor_origem').trim();
    const servidorDestinoId = interaction.fields.getTextInputValue('servidor_destino').trim();
    
    const tipoClonagem = interaction.fields.fields.get('tipo_clonagem')?.values?.[0] || 'tudo';
    const excluirExistentes = interaction.fields.fields.get('excluir_existentes')?.values?.[0] === 'sim';
    const userId = interaction.user.id;
    
    console.log('Tipo de clonagem selecionado:', tipoClonagem);
    console.log('Excluir existentes:', excluirExistentes);

    const tokens = loadTokens();
    const token = tokens[userId];

    if (!token) {
        await interaction.editReply({
            content: 'Token não encontrado. Configure seu token primeiro.'
        });
        return true;
    }

    if (!servidorOrigemId || !servidorDestinoId) {
        await interaction.editReply({
            content: 'Por favor, forneça os IDs dos servidores de origem e destino.'
        });
        return true;
    }
    const options = {
        clonarCargos: false,
        clonarCanais: false,
        clonarEmojis: false,
        excluirExistentes: excluirExistentes
    };

    switch (tipoClonagem) {
        case 'tudo':
            options.clonarCargos = true;
            options.clonarCanais = true;
            options.clonarEmojis = true;
            break;
        case 'apenas_cargos':
            options.clonarCargos = true;
            break;
        case 'apenas_canais':
            options.clonarCanais = true;
            break;
        case 'apenas_emojis':
            options.clonarEmojis = true;
            break;
        case 'cargos_canais':
            options.clonarCargos = true;
            options.clonarCanais = true;
            break;
        case 'cargos_emojis':
            options.clonarCargos = true;
            options.clonarEmojis = true;
            break;
        case 'canais_emojis':
            options.clonarCanais = true;
            options.clonarEmojis = true;
            break;
    }

    try {
        const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
        const baseUrl = 'https://discord.com/api/v10';
        const headers = {
            'Authorization': token,
            'Content-Type': 'application/json'
        };

        const origemResponse = await fetch(`${baseUrl}/guilds/${servidorOrigemId}?with_counts=false`, { headers });
        if (!origemResponse.ok) {
            let errorMessage = 'Não foi possível acessar o servidor de origem.';
            if (origemResponse.status === 401) {
                errorMessage = 'Token inválido ou expirado. Configure um novo token.';
            } else if (origemResponse.status === 403) {
                errorMessage = 'Sem permissões para acessar o servidor de origem. Verifique se sua conta está no servidor.';
            } else if (origemResponse.status === 404) {
                errorMessage = 'Servidor de origem não encontrado. Verifique o ID.';
            }
            await interaction.editReply({ content: errorMessage });
            return true;
        }
        const servidorOrigem = await origemResponse.json();

        const destinoResponse = await fetch(`${baseUrl}/guilds/${servidorDestinoId}?with_counts=false`, { headers });
        if (!destinoResponse.ok) {
            let errorMessage = 'Não foi possível acessar o servidor de destino.';
            if (destinoResponse.status === 401) {
                errorMessage = 'Token inválido ou expirado. Configure um novo token.';
            } else if (destinoResponse.status === 403) {
                errorMessage = 'Sem permissões para acessar o servidor de destino. Verifique se sua conta está no servidor.';
            } else if (destinoResponse.status === 404) {
                errorMessage = 'Servidor de destino não encontrado. Verifique o ID.';
            }
            await interaction.editReply({ content: errorMessage });
            return true;
        }
        const servidorDestino = await destinoResponse.json();
        
        console.log('Options antes da confirmação:', options);
        
        let clonagemInfo = [];
        if (options.clonarCargos) clonagemInfo.push('-# **Cargos**');
        if (options.clonarCanais) clonagemInfo.push('-# **Canais**');
        if (options.clonarEmojis) clonagemInfo.push('-# **Emojis**');
        
        const excluirInfo = options.excluirExistentes ? 'Sim, deletar conteúdo existente' : 'Não, manter conteúdo existente';

        const embed = new EmbedBuilder()
            .setTitle('Confirmação de Clonagem')
            .setDescription(`-# Antes de iniciar a clonagem, confirme as informações:\n\n**Servidor Origem**\n-# \`${servidorOrigem.name}\`\n\n**Servidor Destino**\n-# \`${servidorDestino.name}\`\n\nO que será clonado:\n${clonagemInfo.join('\n')}\n\n**Excluir conteúdo existente?**\n\`${excluirInfo}\``)
            .setColor(0x8a2be2)
            .setThumbnail(interaction.client.user.displayAvatarURL());

        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`confirmar_clonagem_${servidorOrigemId}_${servidorDestinoId}_${tipoClonagem}_${excluirExistentes}`)
                .setLabel('Confirmar')
                .setStyle(3),
            new ButtonBuilder()
                .setCustomId('cancelar_clonagem')
                .setLabel('Cancelar')
                .setStyle(2)
        );

        await interaction.editReply({
            embeds: [embed],
            components: [actionRow]
        });
    } catch (error) {
        await interaction.editReply({
            content: `Erro ao verificar servidores: ${error.message}`,
            components: []
        });
    }
    return true;
}

async function handleConfirmarClonagemButton(interaction) {
    const customId = interaction.customId;
    console.log('CustomId completo:', customId);
    
    const match = customId.match(/confirmar_clonagem_(\d+)_(\d+)_(.+)_(true|false)/);
    
    if (!match) {
        console.error('Erro ao fazer parse do customId:', customId);
        return true;
    }
    
    const servidorOrigemId = match[1];
    const servidorDestinoId = match[2];
    const tipoClonagem = match[3];
    const excluirExistentes = match[4] === 'true';
    const userId = interaction.user.id;
    
    console.log('Parsed - Origem:', servidorOrigemId);
    console.log('Parsed - Destino:', servidorDestinoId);
    console.log('Parsed - Tipo:', tipoClonagem);
    console.log('Parsed - Excluir:', excluirExistentes);

    const tokens = loadTokens();
    const token = tokens[userId];

    if (!token) {
        await interaction.update({
            content: 'Token não encontrado. Configure seu token primeiro.',
            components: []
        });
        return true;
    }
    const options = {
        clonarCargos: false,
        clonarCanais: false,
        clonarEmojis: false,
        excluirExistentes: excluirExistentes
    };

    switch (tipoClonagem) {
        case 'tudo':
            options.clonarCargos = true;
            options.clonarCanais = true;
            options.clonarEmojis = true;
            break;
        case 'apenas_cargos':
            options.clonarCargos = true;
            break;
        case 'apenas_canais':
            options.clonarCanais = true;
            break;
        case 'apenas_emojis':
            options.clonarEmojis = true;
            break;
        case 'cargos_canais':
            options.clonarCargos = true;
            options.clonarCanais = true;
            break;
        case 'cargos_emojis':
            options.clonarCargos = true;
            options.clonarEmojis = true;
            break;
        case 'canais_emojis':
            options.clonarCanais = true;
            options.clonarEmojis = true;
            break;
    }

    await interaction.deferUpdate();

    try {
        await clonarServidor(interaction, token, servidorOrigemId, servidorDestinoId, options);
    } catch (error) {
        try {
            await interaction.editReply({
                content: `Erro ao clonar servidor: ${error.message}`,
                embeds: [],
                components: []
            });
        } catch (editError) {
            console.error('Erro ao editar resposta:', editError.message);
        }
    }
    return true;
}

async function handleCancelarClonagemButton(interaction) {
    await interaction.update({
        content: 'Operação cancelada pelo usuário.',
        embeds: [],
        components: []
    });
    return true;
}

async function handleClonarServidorButton(interaction) {
    const { ModalBuilder: ModalBuilderV2, LabelBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
    
    const modal = new ModalBuilderV2()
        .setCustomId('modal_clonar_servidor')
        .setTitle('Clonar Servidor')
        .addLabelComponents(
            new LabelBuilder()
                .setLabel('Original')
                .setDescription('ID Do servidor que Sera Clonado')
                .setTextInputComponent(
                    new TextInputBuilder()
                        .setCustomId('servidor_origem')
                        .setStyle(TextInputStyle.Short)
                )
        )
        .addLabelComponents(
            new LabelBuilder()
                .setLabel('Destino')
                .setDescription('ID Do servidor que Recebera a Clonagem')
                .setTextInputComponent(
                    new TextInputBuilder()
                        .setCustomId('servidor_destino')
                        .setStyle(TextInputStyle.Short)
                )
        )
        .addLabelComponents(
            new LabelBuilder()
                .setLabel('Tipo de Clonagem')
                .setStringSelectMenuComponent(
                    new StringSelectMenuBuilder()
                        .setCustomId('tipo_clonagem')
                        .addOptions(
                            new StringSelectMenuOptionBuilder()
                                .setLabel('Tudo')
                                .setValue('tudo')
                                .setDefault(true),
                            new StringSelectMenuOptionBuilder()
                                .setLabel('Apenas Cargos')
                                .setValue('apenas_cargos'),
                            new StringSelectMenuOptionBuilder()
                                .setLabel('Apenas Canais')
                                .setValue('apenas_canais'),
                            new StringSelectMenuOptionBuilder()
                                .setLabel('Apenas Emojis')
                                .setValue('apenas_emojis'),
                            new StringSelectMenuOptionBuilder()
                                .setLabel('Cargos + Canais')
                                .setValue('cargos_canais'),
                            new StringSelectMenuOptionBuilder()
                                .setLabel('Cargos + Emojis')
                                .setValue('cargos_emojis'),
                            new StringSelectMenuOptionBuilder()
                                .setLabel('Canais + Emojis')
                                .setValue('canais_emojis')
                        )
                )
        )
        .addLabelComponents(
            new LabelBuilder()
                .setLabel('Deseja Excluir as coisas do server atual?')
                .setDescription('Ex: Cargos, Canais, Emojis, etc...')
                .setStringSelectMenuComponent(
                    new StringSelectMenuBuilder()
                        .setCustomId('excluir_existentes')
                        .addOptions(
                            new StringSelectMenuOptionBuilder()
                                .setLabel('Sim')
                                .setValue('sim')
                                .setDefault(true),
                            new StringSelectMenuOptionBuilder()
                                .setLabel('Não')
                                .setValue('nao')
                        )
                )
        );
    
    await interaction.showModal(modal);
    return true;
}

module.exports = { clonarServidor, handleClonarServidorModal, handleClonarServidorButton, stopServerCloner, handleConfirmarClonagemButton, handleCancelarClonagemButton };


