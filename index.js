require('dotenv').config();
const { Client, Collection, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const express = require('express');

// Configuración
const config = {
    defaultCoinEmoji: '💰',
    currencyName: 'Elix',
    initialBalance: 0,
    claimAmount: 25000,
    claimCooldown: 60 * 60 * 1000, // 1 hora
    roles: {
        '1376773295172489277': { min: 0, max: 999999, name: 'Muerto de Hambre' },
        '1376765075964039229': { min: 1000000, max: 19999999, name: 'Pobreza' },
        '1376764631745560727': { min: 20000000, max: 49999999, name: 'Clase Media' },
        '1376765297922674730': { min: 50000000, max: 99999999, name: 'Emprendedores' },
        '1376765453153730574': { min: 100000000, max: 149999999, name: 'Empresarios' },
        '1377045517955104858': { min: 150000000, max: 199999999, name: 'Millonarios' },
        '1377046271281336420': { min: 200000000, max: 350000000, name: 'Multimillonario' }
    },
    scrim: {
        maxPlayersPerTeam: 5
    }
};

// Archivos JSON
const economyPath = './economy.json';
const betsPath = './bets.json';
const duelsPath = './duels.json';
const scrimsPath = './scrims.json';

// Inicializar archivos
function initJSONFile(filePath, defaultValue = {}) {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaultValue));
    }
}
initJSONFile(economyPath);
initJSONFile(betsPath, { activeBets: {}, userBets: {} });
initJSONFile(duelsPath, { activeDuels: {} });
initJSONFile(scrimsPath, { activeScrims: {} });

// Funciones de economía
async function getEconomyData() {
    return JSON.parse(fs.readFileSync(economyPath));
}

async function updateEconomyData(data) {
    fs.writeFileSync(economyPath, JSON.stringify(data, null, 2));
}

async function getBalance(userId) {
    const data = await getEconomyData();
    return data[userId]?.balance || config.initialBalance;
}

async function updateBalance(userId, amount) {
    const data = await getEconomyData();
    if (!data[userId]) data[userId] = { balance: config.initialBalance };
    data[userId].balance = amount;
    await updateEconomyData(data);
    await updateUserRole(userId, amount);
    return amount;
}

// Sistema de roles
async function updateUserRole(userId, balance) {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    // Eliminar roles antiguos
    for (const roleId of Object.keys(config.roles)) {
        if (member.roles.cache.has(roleId)) {
            await member.roles.remove(roleId).catch(console.error);
        }
    }

    // Asignar nuevo rol
    for (const [roleId, { min, max }] of Object.entries(config.roles)) {
        if (balance >= min && balance <= max) {
            await member.roles.add(roleId).catch(console.error);
            break;
        }
    }
}

// Keep alive para Replit
const app = express();
app.get('/', (req, res) => res.send('EconomyBot está en línea!'));
app.listen(3000, () => console.log('Keep-alive server en puerto 3000'));

// Cliente de Discord
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ] 
});

// Comandos slash
client.commands = new Collection();

// ========================
// 🎯 COMANDOS DE ECONOMÍA
// ========================

// /balance
const balanceCommand = new SlashCommandBuilder()
    .setName('balance')
    .setDescription(`Muestra el balance de ${config.currencyName}`)
    .addUserOption(option =>
        option.setName('usuario')
            .setDescription('Usuario cuyo balance quieres ver')
            .setRequired(false));

client.commands.set('balance', {
    data: balanceCommand,
    async execute(interaction) {
        const user = interaction.options.getUser('usuario') || interaction.user;
        const balance = await getBalance(user.id);

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle(`Balance de ${user.username}`)
            .setDescription(`${config.defaultCoinEmoji} **Tiene:** ${balance.toLocaleString()} ${config.currencyName}`)
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
});

// /limosna (reemplaza a /claim)
const limosnaCommand = new SlashCommandBuilder()
    .setName('limosna')
    .setDescription(`Reclama tus ${config.currencyName} cada hora (exactamente)`);

client.commands.set('limosna', {
    data: limosnaCommand,
    async execute(interaction) {
        const userId = interaction.user.id;
        const now = Date.now();
        const data = await getEconomyData();

        // Verificar si existe registro de última limosna
        if (!data[userId]) data[userId] = { balance: config.initialBalance };

        // Si no tiene registro de última limosna o ha pasado exactamente 1 hora
        if (!data[userId].lastLimosna || now - data[userId].lastLimosna >= config.claimCooldown) {
            const newBalance = (data[userId].balance || config.initialBalance) + config.claimAmount;
            data[userId].balance = newBalance;
            data[userId].lastLimosna = now; // Registrar el momento exacto del claim

            await updateEconomyData(data);
            await interaction.reply({ 
                content: `🎉 Has reclamado ${config.claimAmount.toLocaleString()} ${config.currencyName}! Tu nuevo balance: ${newBalance.toLocaleString()}`,
                ephemeral: true 
            });
        } else {
            const timeLeft = Math.ceil((config.claimCooldown - (now - data[userId].lastLimosna)) / 60000);
            await interaction.reply({ 
                content: `⏳ Debes esperar exactamente 1 hora entre limosnas. Tiempo restante: ${timeLeft} minutos`,
                ephemeral: true 
            });
        }
    }
});

// /give (admin)
const giveCommand = new SlashCommandBuilder()
    .setName('give')
    .setDescription(`Dar ${config.currencyName} a un usuario (Admin)`)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option => 
        option.setName('user')
            .setDescription('Usuario a darle la cantidad')
            .setRequired(true))
    .addIntegerOption(option => 
        option.setName('amount')
            .setDescription('Cantidad a dar')
            .setRequired(true)
            .setMinValue(1));
client.commands.set('give', {
    data: giveCommand,
    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        const currentBalance = await getBalance(user.id);
        await updateBalance(user.id, currentBalance + amount);
        await interaction.reply({ 
            content: `✅ Se dieron ${amount.toLocaleString()} ${config.currencyName} a ${user.username}. Su nuevo balance: ${(currentBalance + amount).toLocaleString()}`,
            ephemeral: true 
        });
    }
});

// /take (admin)
const takeCommand = new SlashCommandBuilder()
    .setName('take')
    .setDescription(`Quitar ${config.currencyName} a un usuario (Admin)`)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option => 
        option.setName('user')
            .setDescription('Usuario a quitarle la cantidad')
            .setRequired(true))
    .addIntegerOption(option => 
        option.setName('amount')
            .setDescription('Cantidad a quitar')
            .setRequired(true)
            .setMinValue(1));
client.commands.set('take', {
    data: takeCommand,
    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        const currentBalance = await getBalance(user.id);
        const newBalance = Math.max(0, currentBalance - amount);
        await updateBalance(user.id, newBalance);
        await interaction.reply({ 
            content: `✅ Se quitaron ${amount.toLocaleString()} ${config.currencyName} a ${user.username}. Su nuevo balance: ${newBalance.toLocaleString()}`,
            ephemeral: true 
        });
    }
});

// /pay
const payCommand = new SlashCommandBuilder()
    .setName('pay')
    .setDescription(`Transferir ${config.currencyName} a otro usuario`)
    .addUserOption(option => 
        option.setName('user')
            .setDescription('Usuario a transferir')
            .setRequired(true))
    .addIntegerOption(option => 
        option.setName('amount')
            .setDescription('Cantidad a transferir')
            .setRequired(true)
            .setMinValue(1));
client.commands.set('pay', {
    data: payCommand,
    async execute(interaction) {
        const senderId = interaction.user.id;
        const receiver = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');

        const senderBalance = await getBalance(senderId);
        if (senderBalance < amount) {
            return interaction.reply({ 
                content: `❌ No tienes suficiente ${config.currencyName} para transferir. Tu balance: ${senderBalance.toLocaleString()}`,
                ephemeral: true 
            });
        }

        const receiverBalance = await getBalance(receiver.id);
        await updateBalance(senderId, senderBalance - amount);
        await updateBalance(receiver.id, receiverBalance + amount);

        await interaction.reply({ 
            content: `✅ Transferiste ${amount.toLocaleString()} ${config.currencyName} a ${receiver.username}. Tu nuevo balance: ${(senderBalance - amount).toLocaleString()}`,
            ephemeral: true 
        });
    }
});

// ========================
// 🎲 COMANDOS DE APUESTAS
// ========================

// /apostar crear
const betCreateCommand = new SlashCommandBuilder()
    .setName('apostar')
    .setDescription('Crea una apuesta o apuesta en un evento')
    .addSubcommand(subcommand =>
        subcommand.setName('crear')
            .setDescription('Crea una nueva apuesta (Admin)')
            .addStringOption(option =>
                option.setName('evento')
                    .setDescription('Nombre del evento (ej: "Barcelona vs Madrid")')
                    .setRequired(true))
            .addNumberOption(option =>
                option.setName('cuota_local')
                    .setDescription('Cuota para el equipo local (ej: 1.5)')
                    .setRequired(true))
            .addNumberOption(option =>
                option.setName('cuota_empate')
                    .setDescription('Cuota para el empate (ej: 2.0)')
                    .setRequired(true))
            .addNumberOption(option =>
                option.setName('cuota_visita')
                    .setDescription('Cuota para el equipo visitante (ej: 3.0)')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand.setName('apostar')
            .setDescription('Apostar en un evento existente')
            .addStringOption(option =>
                option.setName('evento_id')
                    .setDescription('ID del evento (usa /apuestas para ver los IDs)')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('opcion')
                    .setDescription('Opción a apostar')
                    .addChoices(
                        { name: 'Local', value: 'local' },
                        { name: 'Empate', value: 'empate' },
                        { name: 'Visita', value: 'visita' }
                    )
                    .setRequired(true))
            .addIntegerOption(option =>
                option.setName('cantidad')
                    .setDescription('Cantidad a apostar')
                    .setRequired(true)
                    .setMinValue(1)));
client.commands.set('apostar', {
    data: betCreateCommand,
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'crear') {
            // Solo admin puede crear apuestas
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ 
                    content: '❌ Solo los administradores pueden crear apuestas.', 
                    ephemeral: true 
                });
            }

            const eventName = interaction.options.getString('evento');
            const localOdds = interaction.options.getNumber('cuota_local');
            const drawOdds = interaction.options.getNumber('cuota_empate');
            const awayOdds = interaction.options.getNumber('cuota_visita');

            const betsData = JSON.parse(fs.readFileSync(betsPath));
            const eventId = Date.now().toString();

            betsData.activeBets[eventId] = {
                name: eventName,
                odds: { local: localOdds, empate: drawOdds, visita: awayOdds },
                bets: { local: [], empate: [], visita: [] }
            };

            fs.writeFileSync(betsPath, JSON.stringify(betsData, null, 2));

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`🎲 Nueva apuesta: ${eventName}`)
                .addFields(
                    { name: '🏠 Local', value: `Cuota: ${localOdds}x`, inline: true },
                    { name: '⚖ Empate', value: `Cuota: ${drawOdds}x`, inline: true },
                    { name: '✈ Visita', value: `Cuota: ${awayOdds}x`, inline: true },
                    { name: 'ID del Evento', value: `\`${eventId}\`` }
                )
                .setFooter({ text: 'Usa /apostar apostar <ID> <opción> <cantidad> para participar!' });

            await interaction.reply({ embeds: [embed] });

        } else if (subcommand === 'apostar') {
            const eventId = interaction.options.getString('evento_id');
            const option = interaction.options.getString('opcion');
            const amount = interaction.options.getInteger('cantidad');

            const betsData = JSON.parse(fs.readFileSync(betsPath));
            const event = betsData.activeBets[eventId];

            if (!event) {
                return interaction.reply({ 
                    content: '❌ Evento no encontrado. Usa /apuestas para ver los IDs.', 
                    ephemeral: true 
                });
            }

            const userId = interaction.user.id;
            const balance = await getBalance(userId);

            if (balance < amount) {
                return interaction.reply({ 
                    content: `❌ No tienes suficiente ${config.currencyName} para apostar. Tu balance: ${balance.toLocaleString()}`,
                    ephemeral: true 
                });
            }

            // Descontar el dinero
            await updateBalance(userId, balance - amount);

            // Registrar apuesta
            event.bets[option].push({
                userId,
                amount,
                username: interaction.user.username
            });

            fs.writeFileSync(betsPath, JSON.stringify(betsData, null, 2));

            await interaction.reply({ 
                content: `✅ Apostaste ${amount.toLocaleString()} ${config.currencyName} en **${option}** (Cuota: ${event.odds[option]}x). ¡Buena suerte!`,
                ephemeral: true 
            });
        }
    }
});

// /resolverapuesta (admin)
const resolveBetCommand = new SlashCommandBuilder()
    .setName('resolverapuesta')
    .setDescription('Define el resultado de una apuesta (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
        option.setName('evento_id')
            .setDescription('ID del evento a resolver')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('resultado')
            .setDescription('Resultado del evento')
            .addChoices(
                { name: 'Local', value: 'local' },
                { name: 'Empate', value: 'empate' },
                { name: 'Visita', value: 'visita' }
            )
            .setRequired(true));
client.commands.set('resolverapuesta', {
    data: resolveBetCommand,
    async execute(interaction) {
        const eventId = interaction.options.getString('evento_id');
        const result = interaction.options.getString('resultado');

        const betsData = JSON.parse(fs.readFileSync(betsPath));
        const event = betsData.activeBets[eventId];

        if (!event) {
            return interaction.reply({ 
                content: '❌ Evento no encontrado.', 
                ephemeral: true 
            });
        }

        // Pagar a los ganadores
        const winners = event.bets[result];
        const odds = event.odds[result];

        for (const bet of winners) {
            const winnings = Math.floor(bet.amount * odds);
            const currentBalance = await getBalance(bet.userId);
            await updateBalance(bet.userId, currentBalance + winnings);
        }

        // Eliminar apuesta
        delete betsData.activeBets[eventId];
        fs.writeFileSync(betsPath, JSON.stringify(betsData, null, 2));

        const embed = new EmbedBuilder()
            .setColor('#4CAF50')
            .setTitle(`🎲 Apuesta resuelta: ${event.name}`)
            .setDescription(`**Resultado:** ${result}\n**Ganadores:** ${winners.length}\n**Cuota pagada:** ${odds}x`)
            .setFooter({ text: `Resuelto por ${interaction.user.username}` });

        await interaction.reply({ embeds: [embed] });
    }
});

// ========================
// ⚔️ COMANDOS DE DUELOS
// ========================

const duelCommand = new SlashCommandBuilder()
    .setName('duelo')
    .setDescription('Crea, acepta o resuelve un duelo')
    .addSubcommand(subcommand =>
        subcommand
            .setName('crear')
            .setDescription('Desafía a otro jugador a un duelo')
            .addUserOption(option =>
                option
                    .setName('jugador')
                    .setDescription('Jugador a desafiar')
                    .setRequired(true))
            .addIntegerOption(option =>
                option
                    .setName('cantidad')
                    .setDescription('Cantidad a apostar')
                    .setRequired(true)
                    .setMinValue(1)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('aceptar')
            .setDescription('Acepta un duelo pendiente')
            .addStringOption(option =>
                option
                    .setName('duelo_id')
                    .setDescription('ID del duelo')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('resolver')
            .setDescription('Resuelve un duelo (Solo admin)')
            .addStringOption(option =>
                option
                    .setName('duelo_id')
                    .setDescription('ID del duelo')
                    .setRequired(true)));

client.commands.set('duelo', {
    data: duelCommand,
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const duelsData = JSON.parse(fs.readFileSync(duelsPath));

        try {
            if (subcommand === 'crear') {
                // Lógica para crear duelo
                const targetUser = interaction.options.getUser('jugador');
                const amount = interaction.options.getInteger('cantidad');

                if (targetUser.bot || targetUser.id === interaction.user.id) {
                    return interaction.reply({ 
                        content: '❌ No puedes desafiar a un bot o a ti mismo.', 
                        ephemeral: true 
                    });
                }

                const challengerBalance = await getBalance(interaction.user.id);
                if (challengerBalance < amount) {
                    return interaction.reply({ 
                        content: `❌ No tienes suficiente ${config.currencyName} para apostar. Tu balance: ${challengerBalance.toLocaleString()}`,
                        ephemeral: true 
                    });
                }

                const duelId = Date.now().toString();
                duelsData.activeDuels[duelId] = {
                    challenger: {
                        id: interaction.user.id,
                        username: interaction.user.username,
                        amount
                    },
                    target: {
                        id: targetUser.id,
                        username: targetUser.username,
                        accepted: false
                    },
                    winner: null
                };

                await updateBalance(interaction.user.id, challengerBalance - amount);
                fs.writeFileSync(duelsPath, JSON.stringify(duelsData, null, 2));

                const embed = new EmbedBuilder()
                    .setColor('#FFA500')
                    .setTitle('⚔️ ¡Nuevo duelo!')
                    .setDescription(`${interaction.user.username} ha desafiado a ${targetUser.username} por ${amount.toLocaleString()} ${config.currencyName}!`)
                    .addFields(
                        { name: 'ID del Duelo', value: `\`${duelId}\`` },
                        { name: 'Para aceptar', value: `Usa \`/duelo aceptar ${duelId}\`` }
                    );

                await interaction.reply({ embeds: [embed] });

            } else if (subcommand === 'aceptar') {
                // Lógica para aceptar duelo
                const duelId = interaction.options.getString('duelo_id');
                const duel = duelsData.activeDuels[duelId];

                if (!duel) {
                    return interaction.reply({ 
                        content: '❌ Duelo no encontrado.', 
                        ephemeral: true 
                    });
                }

                if (duel.target.id !== interaction.user.id) {
                    return interaction.reply({ 
                        content: '❌ Este duelo no es para ti.', 
                        ephemeral: true 
                    });
                }

                if (duel.target.accepted) {
                    return interaction.reply({ 
                        content: '❌ Ya habías aceptado este duelo.', 
                        ephemeral: true 
                    });
                }

                const targetBalance = await getBalance(interaction.user.id);
                if (targetBalance < duel.challenger.amount) {
                    return interaction.reply({ 
                        content: `❌ No tienes suficiente ${config.currencyName} para aceptar. Tu balance: ${targetBalance.toLocaleString()}`,
                        ephemeral: true 
                    });
                }

                await updateBalance(interaction.user.id, targetBalance - duel.challenger.amount);
                duel.target.accepted = true;
                fs.writeFileSync(duelsPath, JSON.stringify(duelsData, null, 2));

                const embed = new EmbedBuilder()
                    .setColor('#4CAF50')
                    .setTitle('⚔️ ¡Duelo aceptado!')
                    .setDescription(`${interaction.user.username} ha aceptado el duelo por ${duel.challenger.amount.toLocaleString()} ${config.currencyName}!`)
                    .addFields(
                        { name: 'Retador', value: duel.challenger.username },
                        { name: 'Retado', value: duel.target.username },
                        { name: 'Premio', value: `${(duel.challenger.amount * 2).toLocaleString()} ${config.currencyName}` }
                    )
                    .setFooter({ text: 'Un admin debe resolver el duelo con /duelo resolver.' });

                await interaction.reply({ embeds: [embed] });

            } else if (subcommand === 'resolver') {
                // Lógica para resolver duelo
                if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.reply({ 
                        content: '❌ Solo los administradores pueden resolver duelos.', 
                        ephemeral: true 
                    });
                }

                const duelId = interaction.options.getString('duelo_id');
                const duel = duelsData.activeDuels[duelId];

                if (!duel) {
                    return interaction.reply({ 
                        content: '❌ Duelo no encontrado.', 
                        ephemeral: true 
                    });
                }

                if (!duel.target.accepted) {
                    return interaction.reply({ 
                        content: '❌ El duelo no ha sido aceptado aún.', 
                        ephemeral: true 
                    });
                }

                if (duel.winner) {
                    return interaction.reply({ 
                        content: '❌ Este duelo ya fue resuelto.', 
                        ephemeral: true 
                    });
                }

                // Decidir ganador aleatoriamente (50% de probabilidad)
                const randomWinner = Math.random() < 0.5 ? duel.challenger.id : duel.target.id;
                const winnerUser = await client.users.fetch(randomWinner);

                const prize = duel.challenger.amount * 2;
                await updateBalance(randomWinner, (await getBalance(randomWinner)) + prize);

                duel.winner = randomWinner;
                fs.writeFileSync(duelsPath, JSON.stringify(duelsData, null, 2));

                const embed = new EmbedBuilder()
                    .setColor('#FFD700')
                    .setTitle('⚔️ ¡Duelo resuelto automáticamente!')
                    .setDescription(`**${winnerUser.username}** ha ganado el duelo por azar y recibe **${prize.toLocaleString()} ${config.currencyName}**!`)
                    .addFields(
                        { name: 'Retador', value: duel.challenger.username },
                        { name: 'Retado', value: duel.target.username },
                        { name: 'Apuesta total', value: `${prize.toLocaleString()} ${config.currencyName}` }
                    );

                await interaction.reply({ embeds: [embed] });
            }
        } catch (error) {
            console.error('Error en comando duelo:', error);
            await interaction.reply({ 
                content: '❌ Ocurrió un error al procesar el duelo.', 
                ephemeral: true 
            });
        }
    }
});

// ========================
// 🎮 COMANDOS DE SCRIMS
// ========================

const scrimCommand = new SlashCommandBuilder()
    .setName('scrim')
    .setDescription('Crea o administra scrims por equipos')
    .addSubcommand(subcommand =>
        subcommand.setName('crear')
            .setDescription('Crea un nuevo scrim')
            .addIntegerOption(option =>
                option.setName('jugadores')
                    .setDescription('Número de jugadores por equipo (1-5)')
                    .setRequired(true)
                    .setMinValue(1)
                    .setMaxValue(5))
            .addIntegerOption(option =>
                option.setName('apuesta')
                    .setDescription('Cantidad a apostar por jugador')
                    .setRequired(true)
                    .setMinValue(1)))
    .addSubcommand(subcommand =>
        subcommand.setName('unirse')
            .setDescription('Únete a un scrim existente')
            .addStringOption(option =>
                option.setName('scrim_id')
                    .setDescription('ID del scrim')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('equipo')
                    .setDescription('Equipo al que unirse')
                    .addChoices(
                        { name: 'Equipo A', value: 'equipoA' },
                        { name: 'Equipo B', value: 'equipoB' }
                    )
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand.setName('resolver')
            .setDescription('Resuelve un scrim (Admin)')
            .addStringOption(option =>
                option.setName('scrim_id')
                    .setDescription('ID del scrim')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('ganador')
                    .setDescription('Equipo ganador')
                    .addChoices(
                        { name: 'Equipo A', value: 'equipoA' },
                        { name: 'Equipo B', value: 'equipoB' }
                    )
                    .setRequired(true)));

client.commands.set('scrim', {
    data: scrimCommand,
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const scrimsData = JSON.parse(fs.readFileSync(scrimsPath));

        try {
            if (subcommand === 'crear') {
                // Lógica para crear scrim
                const playersPerTeam = interaction.options.getInteger('jugadores');
                const amount = interaction.options.getInteger('apuesta');
                const creatorId = interaction.user.id;

                // Verificar balance
                const balance = await getBalance(creatorId);
                if (balance < amount) {
                    return interaction.reply({
                        content: `❌ No tienes suficiente ${config.currencyName} para crear el scrim. Necesitas: ${amount}`,
                        ephemeral: true
                    });
                }

                // Congelar dinero del creador
                await updateBalance(creatorId, balance - amount);

                const scrimId = Date.now().toString();
                scrimsData.activeScrims[scrimId] = {
                    playersPerTeam,
                    amount,
                    status: 'waiting',
                    teams: {
                        equipoA: {
                            players: [{
                                id: creatorId,
                                username: interaction.user.username,
                                paid: true
                            }],
                            complete: false
                        },
                        equipoB: {
                            players: [],
                            complete: false
                        }
                    },
                    prizePool: amount
                };

                fs.writeFileSync(scrimsPath, JSON.stringify(scrimsData, null, 2));

                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('🎮 Nuevo Scrim Creado!')
                    .setDescription(`**${interaction.user.username}** ha creado un scrim de ${playersPerTeam} vs ${playersPerTeam}`)
                    .addFields(
                        { name: 'Apuesta por jugador', value: `${amount} ${config.currencyName}` },
                        { name: 'ID del Scrim', value: scrimId },
                        { name: 'Para unirse', value: 'Usa `/scrim unirse <ID> <equipo>`' }
                    );

                await interaction.reply({ embeds: [embed] });

            } else if (subcommand === 'unirse') {
                // Lógica para unirse a scrim
                const scrimId = interaction.options.getString('scrim_id');
                const team = interaction.options.getString('equipo');
                const userId = interaction.user.id;
                const scrim = scrimsData.activeScrims[scrimId];

                if (!scrim) {
                    return interaction.reply({ 
                        content: '❌ Scrim no encontrado.', 
                        ephemeral: true 
                    });
                }

                if (scrim.status !== 'waiting') {
                    return interaction.reply({ 
                        content: '❌ Este scrim ya no acepta jugadores.', 
                        ephemeral: true 
                    });
                }

                // Verificar si el usuario ya está en algún equipo
                const alreadyInTeam = 
                    scrim.teams.equipoA.players.some(p => p.id === userId) || 
                    scrim.teams.equipoB.players.some(p => p.id === userId);

                if (alreadyInTeam) {
                    return interaction.reply({ 
                        content: '❌ Ya estás participando en este scrim.', 
                        ephemeral: true 
                    });
                }

                // Verificar si el equipo está lleno
                if (scrim.teams[team].players.length >= scrim.playersPerTeam) {
                    return interaction.reply({ 
                        content: '❌ Este equipo ya está completo', 
                        ephemeral: true 
                    });
                }

                // Verificar balance y congelar dinero
                const balance = await getBalance(userId);
                if (balance < scrim.amount) {
                    return interaction.reply({
                        content: `❌ No tienes suficiente ${config.currencyName} para unirte. Necesitas: ${scrim.amount}`,
                        ephemeral: true
                    });
                }

                await updateBalance(userId, balance - scrim.amount);

                // Añadir jugador al equipo
                scrim.teams[team].players.push({
                    id: userId,
                    username: interaction.user.username,
                    paid: true
                });

                // Actualizar prize pool
                scrim.prizePool += scrim.amount;

                // Verificar si ambos equipos están completos
                const teamAComplete = scrim.teams.equipoA.players.length === scrim.playersPerTeam;
                const teamBComplete = scrim.teams.equipoB.players.length === scrim.playersPerTeam;

                if (teamAComplete && teamBComplete) {
                    scrim.status = 'ready';
                    // Notificar que el scrim puede comenzar
                    const readyEmbed = new EmbedBuilder()
                        .setColor('#4CAF50')
                        .setTitle('🎮 Scrim Listo!')
                        .setDescription(`El scrim ${scrimId} está listo para comenzar con equipos completos!`)
                        .addFields(
                            { name: 'Equipo A', value: scrim.teams.equipoA.players.map(p => p.username).join('\n') },
                            { name: 'Equipo B', value: scrim.teams.equipoB.players.map(p => p.username).join('\n') },
                            { name: 'Premio total', value: `${scrim.prizePool} ${config.currencyName}` }
                        );

                    await interaction.channel.send({ embeds: [readyEmbed] });
                }

                fs.writeFileSync(scrimsPath, JSON.stringify(scrimsData, null, 2));
                await interaction.reply({ 
                    content: `✅ Te has unido al scrim ${scrimId} en el ${team}. Apuesta: ${scrim.amount} ${config.currencyName}`,
                    ephemeral: true 
                });

            } else if (subcommand === 'resolver') {
                // Solo para admins
                if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.reply({ 
                        content: '❌ Solo los administradores pueden resolver scrims.', 
                        ephemeral: true 
                    });
                }

                const scrimId = interaction.options.getString('scrim_id');
                const winningTeam = interaction.options.getString('ganador');
                const scrim = scrimsData.activeScrims[scrimId];

                if (!scrim) {
                    return interaction.reply({ 
                        content: '❌ Scrim no encontrado.', 
                        ephemeral: true 
                    });
                }

                if (scrim.status !== 'ready') {
                    return interaction.reply({ 
                        content: '❌ Este scrim no está listo para resolverse.', 
                        ephemeral: true 
                    });
                }

                // Distribuir premio a los ganadores
                const prizePerWinner = scrim.prizePool / scrim.teams[winningTeam].players.length;

                for (const player of scrim.teams[winningTeam].players) {
                    const currentBalance = await getBalance(player.id);
                    await updateBalance(player.id, currentBalance + prizePerWinner);
                }

                // Eliminar scrim
                delete scrimsData.activeScrims[scrimId];
                fs.writeFileSync(scrimsPath, JSON.stringify(scrimsData, null, 2));

                // Crear embed de resultado
                const embed = new EmbedBuilder()
                    .setColor('#4CAF50')
                    .setTitle('🏆 Scrim Resuelto!')
                    .setDescription(`El ${winningTeam} ha ganado el scrim!`)
                    .addFields(
                        { name: 'Premio por jugador', value: `${prizePerWinner.toLocaleString()} ${config.currencyName}` },
                        { name: 'Total apostado', value: `${scrim.prizePool.toLocaleString()} ${config.currencyName}` },
                        { 
                            name: 'Jugadores ganadores', 
                            value: scrim.teams[winningTeam].players.map(p => p.username).join('\n') || 'Ninguno'
                        }
                    )
                    .setFooter({ text: `Resuelto por ${interaction.user.username}` });

                await interaction.reply({ embeds: [embed] });
            }
        } catch (error) {
            console.error('Error en comando scrim:', error);
            await interaction.reply({
                content: '❌ Ocurrió un error al procesar el scrim.',
                ephemeral: true
            });
        }
    }
});

// ========================
// 📊 COMANDO TOP (NUEVO)
// ========================

const topCommand = new SlashCommandBuilder()
    .setName('top')
    .setDescription('Muestra el ranking de usuarios (Solo admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

client.commands.set('top', {
    data: topCommand,
    async execute(interaction) {
        const data = await getEconomyData();

        // Convertir a array y ordenar
        const users = Object.entries(data)
            .map(([id, userData]) => ({
                id,
                balance: userData.balance,
                username: client.users.cache.get(id)?.username || 'Usuario desconocido'
            }))
            .sort((a, b) => b.balance - a.balance);

        // Crear embed con el top
        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle(`🏆 Top ${config.currencyName}`)
            .setDescription(`Ranking de usuarios por riqueza`);

        // Añadir campos (limitamos a 25 para no sobrecargar)
        users.slice(0, 25).forEach((user, index) => {
            embed.addFields({
                name: `${index + 1}. ${user.username}`,
                value: `${config.defaultCoinEmoji} ${user.balance.toLocaleString()}`,
                inline: true
            });
        });

        await interaction.reply({ embeds: [embed] });
    }
});

// ========================
// 📜 COMANDO APUESTAS (NUEVO)
// ========================

const apuestasCommand = new SlashCommandBuilder()
    .setName('apuestas')
    .setDescription('Muestra las apuestas activas disponibles');

client.commands.set('apuestas', {
    data: apuestasCommand,
    async execute(interaction) {
        const betsData = JSON.parse(fs.readFileSync(betsPath));

        if (Object.keys(betsData.activeBets).length === 0) {
            return interaction.reply({
                content: 'ℹ️ No hay apuestas activas en este momento.',
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🎲 Apuestas Activas')
            .setDescription('Lista de apuestas disponibles para participar');

        for (const [eventId, event] of Object.entries(betsData.activeBets)) {
            embed.addFields({
                name: event.name,
                value: `🏠 Local: ${event.odds.local}x\n⚖ Empate: ${event.odds.empate}x\n✈ Visita: ${event.odds.visita}x\nID: \`${eventId}\``,
                inline: true
            });
        }

        embed.setFooter({ text: 'Usa /apostar apostar <ID> <opción> <cantidad> para participar' });

        await interaction.reply({ embeds: [embed] });
    }
});

// ========================
// 📜 COMANDO SCRIMS (NUEVO)
// ========================

const scrimsActivosCommand = new SlashCommandBuilder()
    .setName('scrims')
    .setDescription('Muestra los scrims activos disponibles');

client.commands.set('scrims', {
    data: scrimsActivosCommand,
    async execute(interaction) {
        const scrimsData = JSON.parse(fs.readFileSync(scrimsPath));

        if (Object.keys(scrimsData.activeScrims).length === 0) {
            return interaction.reply({
                content: 'ℹ️ No hay scrims activos en este momento.',
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🎮 Scrims Activos')
            .setDescription('Lista de scrims disponibles para unirse');

        for (const [scrimId, scrim] of Object.entries(scrimsData.activeScrims)) {
            const equipoACount = scrim.teams.equipoA.players.length;
            const equipoBCount = scrim.teams.equipoB.players.length;

            embed.addFields({
                name: `Scrim ${scrimId}`,
                value: `👥 ${scrim.playersPerTeam} vs ${scrim.playersPerTeam}\n💰 ${scrim.amount} ${config.currencyName}\n🏆 Premio: ${scrim.prizePool} ${config.currencyName}\n\nEquipo A: ${equipoACount}/${scrim.playersPerTeam}\nEquipo B: ${equipoBCount}/${scrim.playersPerTeam}`,
                inline: true
            });
        }

        embed.setFooter({ text: 'Usa /scrim unirse <ID> <equipo> para participar' });

        await interaction.reply({ embeds: [embed] });
    }
});

// ========================
// 🏁 INICIAR BOT
// ========================

client.once('ready', async () => {
    console.log(`✅ Bot conectado como ${client.user.tag}`);

    try {
        const commands = Array.from(client.commands.values()).map(cmd => cmd.data.toJSON());
        await client.application.commands.set(commands);
        console.log('✨ Todos los comandos registrados en Discord!');
    } catch (error) {
        console.error('❌ Error al registrar comandos:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        await interaction.reply({ 
            content: '❌ Ocurrió un error al ejecutar este comando', 
            ephemeral: true 
        });
    }
});

client.login(process.env.DISCORD_TOKEN);