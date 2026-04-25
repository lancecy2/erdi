const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

loadEnv();

const config = {
  token: requireEnv('BOT_TOKEN'),
  clientId: requireEnv('CLIENT_ID'),
  clientSecret: requireEnv('CLIENT_SECRET'),
  guildId: requireEnv('GUILD_ID'),
  baseUrl: trimTrailingSlash(requireEnv('BASE_URL')),
  port: Number(process.env.PORT || 3000),
  memberRoleId: requireEnv('MEMBER_ROLE_ID'),
  ordersChannelId: process.env.ORDERS_CHANNEL_ID || '',
  staffRoleId: process.env.STAFF_ROLE_ID || '',
  ticketCategoryId: process.env.TICKET_CATEGORY_ID || '',
  mongoUri: process.env.MONGODB_URI || '',
  storeApiBaseUrl: trimTrailingSlash(process.env.STORE_API_BASE_URL || ''),
  staffToken: process.env.STAFF_TOKEN || process.env.STAFF_PASSWORD || '',
  ownerIds: new Set((process.env.OWNER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean)),
};

const redirectUri = `${config.baseUrl}/oauth/callback`;
const dataDir = path.join(__dirname, 'data');
const usersFile = path.join(dataDir, 'authorized-users.json');
const ticketsFile = path.join(dataDir, 'tickets.json');
const states = new Map();
const ticketButtonId = 'ticket:open';
const ticketModalId = 'ticket:order-modal';
const ticketCloseButtonId = 'ticket:close';
const orderIdInputId = 'ticket:order-id';
const itemChoices = [
  { label: 'Skeleton Spawner', value: 'Skeleton Spawner', emoji: '\u{1F480}', description: 'Minecraft spawner delivery' },
  { label: 'Donut Money', value: 'Donut Money', emoji: '\u{1F4B0}', description: 'Enter quantity as millions, e.g. 100 = 100M' },
  { label: 'Piglin Head', value: 'Piglin Head', emoji: '\u{1F437}', description: 'Piglin head item' },
  { label: 'Dragon Head', value: 'Dragon Head', emoji: '\u{1F409}', description: 'Dragon head item' },
  { label: 'Elytra', value: 'Elytra', emoji: '\u{1FABD}', description: 'Elytra item' },
];
const allowedItems = new Set(itemChoices.map((choice) => choice.value));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});
let mongoClient;

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log(`OAuth callback: ${redirectUri}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton() && interaction.customId === ticketButtonId) {
      await handleOpenTicketButton(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId === ticketCloseButtonId) {
      await handleCloseTicket(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === ticketModalId) {
      await handleTicketModal(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'setup-verify') {
      await handleSetupVerify(interaction);
      return;
    }

    if (interaction.commandName === 'setup-ticket') {
      await handleSetupTicket(interaction);
      return;
    }

    if (interaction.commandName === 'setup-legit') {
      await handleSetupLegit(interaction);
      return;
    }

    if (interaction.commandName === 'done') {
      await handleDone(interaction);
      return;
    }

    if (interaction.commandName === 'join-authorized') {
      await handleJoinAuthorized(interaction);
      return;
    }

    if (interaction.commandName === 'join-all-authorized') {
      await handleJoinAllAuthorized(interaction);
      return;
    }

    if (interaction.commandName === 'authorized-list') {
      await handleAuthorizedList(interaction);
    }
  } catch (error) {
    console.error(error);
    const message = error.message || 'Something went wrong.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message }).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
    if (message.content.trim().toLowerCase() !== '!verify') return;

    assertCanAdminMessage(message);
    await sendVerificationPanel(message.channel);
    await message.reply('Verification panel posted.').catch(() => {});
  } catch (error) {
    console.error(error);
    await message.reply(error.message || 'Something went wrong.').catch(() => {});
  }
});

async function handleSetupVerify(interaction) {
  assertCanAdmin(interaction);
  await interaction.reply({ content: 'Verification panel posted.', ephemeral: true });
  await sendVerificationPanel(interaction.channel);
}

async function sendVerificationPanel(channel) {
  const verifyUrl = `${config.baseUrl}/verify`;

  const embed = new EmbedBuilder()
    .setTitle('\u2705 Server Verification')
    .setDescription([
      'Welcome! To keep this community secure, please verify your Discord account before entering the server.',
      '',
      '\u{1F510} Click **Verify Now** below.',
      '\u26A1 Authorize the bot on Discord.',
      '\u{1F389} Your **Members** role will be added automatically.',
      '',
      'This only confirms your Discord identity and gives you access to the server.',
    ].join('\n'))
    .setColor(0x5865f2)
    .setFooter({ text: 'Verification is required to unlock member channels.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Verify Now')
      .setStyle(ButtonStyle.Link)
      .setURL(verifyUrl),
  );

  await channel.send({ embeds: [embed], components: [row] });
}

async function handleSetupTicket(interaction) {
  assertCanAdmin(interaction);
  await interaction.reply({ content: '\u2705 Ticket panel posted.', ephemeral: true });
  await sendTicketPanel(interaction.channel);
}

async function sendTicketPanel(channel) {
  const embed = new EmbedBuilder()
    .setTitle('\u{1F6D2} DonutLoot Order Claim')
    .setDescription([
      'Need help receiving an order? Open a private ticket and our staff team will take care of you.',
      '',
      '\u{1F9FE} Keep your **Order ID** ready.',
      '\u2705 The bot will verify your completed order before creating a ticket.',
      '\u{1F512} Your ticket is private between you and staff.',
    ].join('\n'))
    .setColor(0x2ecc71)
    .setFooter({ text: 'DonutLoot Support \u2022 Fast, private, secure' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ticketButtonId)
      .setLabel('Open Order Ticket')
      .setEmoji('\u{1F39F}\uFE0F')
      .setStyle(ButtonStyle.Primary),
  );

  await channel.send({ embeds: [embed], components: [row] });
}

async function handleSetupLegit(interaction) {
  assertCanAdmin(interaction);
  await interaction.reply({ content: '\u2705 Legit check message posted.', ephemeral: true });
  await sendLegitPanel(interaction.channel);
}

async function sendLegitPanel(channel) {
  const postedAt = formatDateTime(new Date());
  const embed = new EmbedBuilder()
    .setTitle('\u2705 Are We Legit?')
    .setDescription([
      'Share your experience with DonutLoot by reacting below.',
      '',
      '\u2705 **Legit** - smooth order and delivery',
      '\u274C **Issue** - I had a problem with my order',
      '',
      '\u2B50 Your feedback helps future buyers decide.',
    ].join('\n'))
    .setColor(0x5865f2)
    .setFooter({ text: `Posted ${postedAt}` });

  const message = await channel.send({ embeds: [embed] });
  await message.react('\u2705');
  await message.react('\u274C');
}
async function handleOpenTicketButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId(ticketModalId)
    .setTitle('Verify Your Order');

  const orderInput = new TextInputBuilder()
    .setCustomId(orderIdInputId)
    .setLabel('Order ID')
    .setPlaceholder('Example: ERDI-20260424-ABC123')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80);

  modal.addComponents(new ActionRowBuilder().addComponents(orderInput));
  await interaction.showModal(modal);
}

async function handleTicketModal(interaction) {
  await interaction.deferReply({ ephemeral: true });

  if (!config.mongoUri && !config.storeApiBaseUrl) {
    throw new Error('Missing MONGODB_URI or STORE_API_BASE_URL in the bot .env.');
  }

  const orderId = normalizeOrderId(interaction.fields.getTextInputValue(orderIdInputId));
  if (!orderId) throw new Error('Please enter a valid Order ID.');

  const order = await fetchCompletedStoreOrder(orderId);
  if (!order) {
    await interaction.editReply(`Order \`${escapeMarkdown(orderId)}\` does not exist or is not completed yet.`);
    return;
  }

  const completedTicket = findCompletedTicketByOrderId(readTickets(), orderId);
  if (completedTicket) {
    await interaction.editReply(`Order \`${escapeMarkdown(orderId)}\` has already been completed and cannot be used for another ticket.`);
    return;
  }

  await createVerifiedOrderTicket(interaction, orderId, order);
}

async function createVerifiedOrderTicket(interaction, orderId, order) {
  const guild = interaction.guild;
  const channelName = `ticket-${interaction.user.username}-${orderId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 90);

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];

  if (config.staffRoleId) {
    permissionOverwrites.push({
      id: config.staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: config.ticketCategoryId || undefined,
    topic: `Order ID: ${orderId} | Ticket user: ${interaction.user.tag} (${interaction.user.id})`,
    permissionOverwrites,
    reason: `Verified order ticket opened by ${interaction.user.tag}`,
  });

  const tickets = readTickets();
  tickets[channel.id] = {
    userId: interaction.user.id,
    username: interaction.user.username,
    orderId,
    orderSnapshot: normalizeOrderForTicket(order),
    createdAt: new Date().toISOString(),
    done: false,
  };
  writeTickets(tickets);

  const embed = new EmbedBuilder()
    .setTitle('\u2705 Verified Order Ticket')
    .setDescription([
      `Hi ${interaction.user}, your order has been verified successfully.`,
      '',
      `\u{1F9FE} **Order ID:** \`${escapeMarkdown(order.id || orderId)}\``,
      '',
      'A staff member will review the details below and assist with delivery shortly.',
      'Please stay available in this private ticket for updates.',
    ].join('\n'))
    .addFields(buildOrderDetailFields(order))
    .setColor(0x2ecc71)
    .setFooter({ text: 'DonutLoot Support \u2022 Verified order' })
    .setTimestamp();

  const staffMention = config.staffRoleId ? `<@&${config.staffRoleId}> ` : '';
  await channel.send({ content: `${staffMention}${interaction.user}`, embeds: [embed] });
  await interaction.editReply(`Ticket created: ${channel}`);
}

async function handleDone(interaction) {
  assertCanStaff(interaction);
  await interaction.deferReply({ ephemeral: true });

  if (!config.ordersChannelId) {
    throw new Error('Missing ORDERS_CHANNEL_ID in .env.');
  }

  const tickets = readTickets();
  const requestedOrderId = normalizeOrderId(interaction.options.getString('order_id') || '');
  const ticket = findTicketForDone(tickets, interaction.channelId, requestedOrderId);
  if (!ticket) {
    throw new Error('Use `/done` inside a verified ticket channel, or provide a valid Order ID.');
  }

  const ordersChannel = await interaction.guild.channels.fetch(config.ordersChannelId).catch(() => null);
  if (!ordersChannel?.isTextBased()) {
    throw new Error('ORDERS_CHANNEL_ID must point to a text channel the bot can send messages in.');
  }

  const order = ticket.orderSnapshot || await fetchCompletedStoreOrder(ticket.orderId);
  if (!order) {
    throw new Error('Could not load the verified order details for this ticket.');
  }

  const deliveredItems = formatCompletedOrderItems(order.cart || []);
  if (deliveredItems.length === 0) {
    throw new Error('This order has no items to log.');
  }

  const member = await interaction.guild.members.fetch(ticket.userId).catch(() => null);
  const buyerName = member?.displayName || ticket.username || `User ${ticket.userId}`;
  const maskedBuyerName = maskCustomerName(buyerName);
  const completedFields = [
    { name: '?? Customer', value: escapeMarkdown(maskedBuyerName), inline: true },
    { name: '?? Item', value: deliveredItems.map((item) => escapeMarkdown(item.name)).join('\n'), inline: true },
    { name: '?? Quantity', value: deliveredItems.map((item) => escapeMarkdown(item.quantity)).join('\n'), inline: true },
    { name: '?? Completed By', value: `${interaction.user}`, inline: true },
  ];
  const ticketCompletedFields = [
    ...completedFields,
    { name: '?? Order ID', value: escapeMarkdown(ticket.orderId), inline: true },
  ];

  const orderEmbed = new EmbedBuilder()
    .setTitle('? Order Completed')
    .setDescription(`?? **${escapeMarkdown(maskedBuyerName)}** has completed a purchase with DonutLoot.`)
    .addFields(completedFields)
    .setColor(0xf1c40f)
    .setFooter({ text: `DonutLoot Orders ? ${formatDateTime(new Date())}` })
    .setTimestamp();

  await ordersChannel.send({ embeds: [orderEmbed] });

  const ticketEmbed = new EmbedBuilder()
    .setTitle('? Order Delivered')
    .setDescription([
      'This order has been marked as completed. Thank you for shopping with DonutLoot!',
      '',
      'If everything looks good, staff can close this ticket using the button below.',
    ].join('\n'))
    .addFields(ticketCompletedFields)
    .setColor(0x2ecc71)
    .setFooter({ text: 'DonutLoot Delivery Complete' })
    .setTimestamp();

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ticketCloseButtonId)
      .setLabel('Staff Close Ticket')
      .setEmoji('??')
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.channel.send({ embeds: [ticketEmbed], components: [closeRow] });

  ticket.done = true;
  ticket.doneAt = new Date().toISOString();
  ticket.doneBy = interaction.user.id;
  ticket.deliveredItems = deliveredItems;
  writeTickets(tickets);

  await interaction.editReply('? Completed order embed sent.');
}
async function handleCloseTicket(interaction) {
  assertCanStaff(interaction);

  const tickets = readTickets();
  const ticket = tickets[interaction.channelId];
  if (!ticket) {
    throw new Error('This button can only be used inside a ticket channel.');
  }

  ticket.closedAt = new Date().toISOString();
  ticket.closedBy = interaction.user.id;
  writeTickets(tickets);

  await interaction.reply({ content: '\u{1F512} Closing this ticket in 5 seconds...', ephemeral: true });
  setTimeout(() => {
    interaction.channel.delete(`Ticket closed by ${interaction.user.tag}`).catch(console.error);
  }, 5000);
}

async function handleJoinAuthorized(interaction) {
  assertCanAdmin(interaction);
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.options.getString('user_id', true);
  const users = readAuthorizedUsers();
  const record = users[userId];

  if (!record) {
    throw new Error('That user has not authorized the bot yet.');
  }

  const token = await getValidAccessToken(userId, record);
  const response = await discordFetch(`/guilds/${config.guildId}/members/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({
      access_token: token,
      roles: [config.memberRoleId],
    }),
  });

  if (!response.ok && response.status !== 201 && response.status !== 204) {
    const text = await response.text();
    throw new Error(`Discord could not add that user: ${response.status} ${text}`);
  }

  await interaction.editReply(`Added <@${userId}> to the server, or they were already here.`);
}

async function handleJoinAllAuthorized(interaction) {
  assertCanAdmin(interaction);
  await interaction.deferReply({ ephemeral: true });

  const users = readAuthorizedUsers();
  const userIds = Object.keys(users);

  if (userIds.length === 0) {
    await interaction.editReply('No authorized users have been saved yet.');
    return;
  }

  const results = {
    added: 0,
    alreadyInServer: 0,
    failed: [],
  };

  for (const userId of userIds) {
    try {
      const token = await getValidAccessToken(userId, users[userId]);
      const response = await discordFetch(`/guilds/${config.guildId}/members/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({
          access_token: token,
          roles: [config.memberRoleId],
        }),
      });

      if (response.status === 201) {
        results.added += 1;
        continue;
      }

      if (response.status === 204) {
        results.alreadyInServer += 1;
        continue;
      }

      const text = await response.text();
      results.failed.push({ userId, reason: `${response.status} ${text}`.slice(0, 180) });
    } catch (error) {
      results.failed.push({ userId, reason: String(error.message || error).slice(0, 180) });
    }
  }

  const failedPreview = results.failed
    .slice(0, 8)
    .map((failure) => `- <@${failure.userId}> (${failure.userId}): ${escapeMarkdown(failure.reason)}`)
    .join('\n');
  const hiddenFailures = results.failed.length > 8 ? `\n...and ${results.failed.length - 8} more failed.` : '';

  await interaction.editReply([
    `Processed ${userIds.length} authorized user(s).`,
    '',
    `Added: **${results.added}**`,
    `Already in server: **${results.alreadyInServer}**`,
    `Failed: **${results.failed.length}**`,
    failedPreview ? `\nFailures:\n${failedPreview}${hiddenFailures}` : '',
  ].filter(Boolean).join('\n'));
}

async function handleAuthorizedList(interaction) {
  assertCanAdmin(interaction);
  const users = readAuthorizedUsers();
  const ids = Object.keys(users);
  const preview = ids.slice(0, 25).map((id) => `<@${id}> (${id})`).join('\n') || 'No authorized users yet.';
  const extra = ids.length > 25 ? `\n\nShowing 25 of ${ids.length}.` : '';

  await interaction.reply({ content: `${preview}${extra}`, ephemeral: true });
}

function startOAuthServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, config.baseUrl);

      if (url.pathname === '/verify') {
        const state = createOAuthState();
        redirect(res, buildAuthorizeUrl(state));
        return;
      }

      if (url.pathname !== '/oauth/callback') {
        sendHtml(res, 404, buildVerificationPage({
          status: 'error',
          eyebrow: 'Page not found',
          title: 'This verification link is not valid',
          message: 'Please return to Discord and use the latest verification button from the server.',
          details: ['OAuth callback route was not found.'],
        }));
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      if (!code || !state || !states.has(state)) {
        sendHtml(res, 400, buildVerificationPage({
          status: 'error',
          eyebrow: 'Verification failed',
          title: 'Your verification session expired',
          message: 'For your security, each verification session only works once and expires quickly. Please go back to Discord and click Verify Now again.',
          details: ['No server access was changed.', 'Clicking the same Discord button will start a fresh secure session.'],
        }));
        return;
      }

      states.delete(state);
      cleanupStates();

      const token = await exchangeCode(code);
      const identity = await fetchIdentity(token.access_token);
      saveAuthorizedUser(identity.id, token);
      await verifyGuildMember(identity.id);

      sendHtml(res, 200, buildVerificationPage({
        status: 'success',
        eyebrow: 'Verification complete',
        title: 'You are verified',
        message: 'Your Discord account was confirmed successfully. You can close this tab and return to the server.',
        details: ['Member access has been applied if you are already in the server.', 'If channels do not appear immediately, reopen Discord or ask staff for help.'],
      }));
    } catch (error) {
      console.error(error);
      sendHtml(res, 500, buildVerificationPage({
        status: 'error',
        eyebrow: 'Verification failed',
        title: 'We could not finish verification',
        message: 'Something went wrong while Discord was confirming your account. Please contact a server admin and ask them to check the bot console.',
        details: ['Your account was not changed by this failed attempt.'],
      }));
    }
  });

  server.listen(config.port, () => {
    console.log(`OAuth server listening on port ${config.port}`);
  });
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  const response = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(`OAuth token exchange failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function fetchIdentity(accessToken) {
  const response = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Could not read Discord user identity: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function verifyGuildMember(userId) {
  const guild = await client.guilds.fetch(config.guildId);
  const member = await guild.members.fetch(userId).catch(() => null);

  if (!member) return;

  await member.roles.add(config.memberRoleId, 'User completed OAuth verification');
}

async function getValidAccessToken(userId, record) {
  if (record.expiresAt && Date.now() < record.expiresAt - 60_000) {
    return record.accessToken;
  }

  if (!record.refreshToken) {
    throw new Error('That authorization expired and no refresh token was saved.');
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: record.refreshToken,
  });

  const response = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(`Could not refresh authorization: ${response.status} ${await response.text()}`);
  }

  const token = await response.json();
  saveAuthorizedUser(userId, token);
  return token.access_token;
}

async function discordFetch(endpoint, options = {}) {
  return fetch(`https://discord.com/api/v10${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bot ${config.token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

async function fetchCompletedStoreOrder(orderId) {
  if (config.mongoUri) {
    try {
      const database = await getStoreDatabase();
      return await database.collection('orders').findOne({
        id: orderId,
        status: { $in: ['paid', 'confirmed'] },
      });
    } catch (error) {
      mongoClient = null;
      if (!config.storeApiBaseUrl) {
        throw error;
      }

      console.warn(`MongoDB lookup failed, trying store API fallback: ${error.message}`);
    }
  }

  if (!config.storeApiBaseUrl) {
    throw new Error('Missing STORE_API_BASE_URL in the bot .env.');
  }

  if (!config.staffToken) {
    throw new Error('Missing STAFF_TOKEN in the bot .env.');
  }

  const response = await fetch(`${config.storeApiBaseUrl}/api/staff/orders`, {
    headers: {
      'x-staff-token': config.staffToken,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Store API lookup failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const orders = Array.isArray(data.orders) ? data.orders : [];
  return orders.find((order) => normalizeOrderId(order.id) === orderId) || null;
}

async function getStoreDatabase() {
  if (!mongoClient) {
    mongoClient = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
    await mongoClient.connect();
  }

  return mongoClient.db('erdis_donuts');
}

function saveAuthorizedUser(userId, token) {
  const users = readAuthorizedUsers();
  users[userId] = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + Number(token.expires_in || 0) * 1000,
    updatedAt: new Date().toISOString(),
  };
  writeAuthorizedUsers(users);
}

function readAuthorizedUsers() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(usersFile, 'utf8'));
}

function writeAuthorizedUsers(users) {
  ensureDataFile();
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, '{}\n');
}

function readTickets() {
  ensureTicketsFile();
  return JSON.parse(fs.readFileSync(ticketsFile, 'utf8'));
}

function writeTickets(tickets) {
  ensureTicketsFile();
  fs.writeFileSync(ticketsFile, JSON.stringify(tickets, null, 2));
}

function ensureTicketsFile() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(ticketsFile)) fs.writeFileSync(ticketsFile, '{}\n');
}

function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify guilds.join',
    state,
    prompt: 'consent',
  });

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function assertCanAdmin(interaction) {
  const isOwner = config.ownerIds.has(interaction.user.id);
  const canManage = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

  if (!isOwner && !canManage) {
    throw new Error('You need Manage Server permission to use this command.');
  }
}

function assertCanAdminMessage(message) {
  const isOwner = config.ownerIds.has(message.author.id);
  const canManage = message.member?.permissions.has(PermissionFlagsBits.ManageGuild);

  if (!isOwner && !canManage) {
    throw new Error('You need Manage Server permission to use this command.');
  }
}

function assertCanStaff(interaction) {
  const isOwner = config.ownerIds.has(interaction.user.id);
  const canManageChannels = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
  const hasStaffRole = config.staffRoleId && interaction.member?.roles?.cache?.has(config.staffRoleId);

  if (!isOwner && !canManageChannels && !hasStaffRole) {
    throw new Error('You need the staff role or Manage Channels permission to use this command.');
  }
}

function cleanupStates() {
  const maxAge = 15 * 60 * 1000;
  const now = Date.now();

  for (const [state, value] of states.entries()) {
    if (now - value.createdAt > maxAge) states.delete(state);
  }
}

function createOAuthState() {
  cleanupStates();
  const state = crypto.randomBytes(24).toString('hex');
  states.set(state, { createdAt: Date.now() });
  return state;
}

function buildVerificationPage({ status, eyebrow, title, message, details = [] }) {
  const isSuccess = status === 'success';
  const detailItems = details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join('');
  const accentColor = isSuccess ? '#22c55e' : '#f97316';
  const statusText = isSuccess ? 'Verified' : 'Action needed';
  const icon = isSuccess
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.2 16.6 4.9 12.3l1.4-1.4 2.9 2.9 8.5-8.5 1.4 1.4-9.9 9.9Z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 7h2v7h-2V7Zm0 9h2v2h-2v-2Zm1-14 10 18H2L12 2Zm0 4.1L5.4 18h13.2L12 6.1Z"/></svg>';

  return `
    <main class="shell">
      <section class="card ${isSuccess ? 'success' : 'warning'}">
        <div class="brand">
          <span class="brand-mark">D</span>
          <span>Discord Verification</span>
        </div>
        <div class="status-row">
          <span class="status-pill">${escapeHtml(statusText)}</span>
        </div>
        <div class="icon-wrap" style="--accent:${accentColor}">
          ${icon}
        </div>
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="message">${escapeHtml(message)}</p>
        ${detailItems ? `<ul class="details">${detailItems}</ul>` : ''}
        <div class="footer-note">
          <span class="dot" style="--accent:${accentColor}"></span>
          <span>This page is safe to close.</span>
        </div>
      </section>
    </main>
  `;
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store',
  });
  res.end();
}

function sendHtml(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Discord Verification</title>
  <style>
    :root {
      --bg: #0b1020;
      --panel: #151a2e;
      --panel-border: rgba(255, 255, 255, 0.12);
      --text: #f8fafc;
      --muted: #a8b3cf;
      --discord: #5865f2;
    }

    * {
      box-sizing: border-box;
    }

    body {
      min-height: 100vh;
      margin: 0;
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(88, 101, 242, 0.24), transparent 34rem),
        linear-gradient(135deg, #080c18 0%, #11182c 48%, #0b1020 100%);
      line-height: 1.5;
    }

    .shell {
      display: grid;
      min-height: 100vh;
      place-items: center;
      padding: 32px 16px;
    }

    .card {
      width: min(100%, 520px);
      overflow: hidden;
      border: 1px solid var(--panel-border);
      border-radius: 18px;
      padding: 28px;
      background: rgba(21, 26, 46, 0.88);
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.36);
      backdrop-filter: blur(18px);
    }

    .brand,
    .status-row,
    .footer-note {
      display: flex;
      align-items: center;
    }

    .brand {
      gap: 10px;
      color: #dbe4ff;
      font-size: 14px;
      font-weight: 700;
    }

    .brand-mark {
      display: inline-grid;
      width: 32px;
      height: 32px;
      place-items: center;
      border-radius: 9px;
      background: var(--discord);
      color: white;
      font-weight: 800;
    }

    .status-row {
      justify-content: flex-end;
      margin-top: -28px;
    }

    .status-pill {
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 999px;
      padding: 7px 12px;
      color: #dbe4ff;
      background: rgba(255, 255, 255, 0.06);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .icon-wrap {
      display: grid;
      width: 72px;
      height: 72px;
      margin-top: 48px;
      place-items: center;
      border: 1px solid color-mix(in srgb, var(--accent), transparent 45%);
      border-radius: 20px;
      background: color-mix(in srgb, var(--accent), transparent 88%);
      color: var(--accent);
    }

    .icon-wrap svg {
      width: 40px;
      height: 40px;
      fill: currentColor;
    }

    .eyebrow {
      margin: 26px 0 8px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    h1 {
      margin: 0;
      font-size: clamp(32px, 8vw, 48px);
      line-height: 1.05;
      letter-spacing: 0;
    }

    .message {
      margin: 18px 0 0;
      color: #d6ddf2;
      font-size: 17px;
    }

    .details {
      display: grid;
      gap: 10px;
      margin: 24px 0 0;
      padding: 0;
      list-style: none;
    }

    .details li {
      border: 1px solid rgba(255, 255, 255, 0.09);
      border-radius: 10px;
      padding: 12px 14px;
      color: #c9d3ea;
      background: rgba(255, 255, 255, 0.045);
    }

    .footer-note {
      gap: 9px;
      margin-top: 28px;
      color: var(--muted);
      font-size: 14px;
    }

    .dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 18px var(--accent);
    }

    @media (max-width: 520px) {
      .card {
        border-radius: 14px;
        padding: 22px;
      }

      .status-row {
        justify-content: flex-start;
        margin-top: 18px;
      }

      .icon-wrap {
        margin-top: 32px;
      }
    }
  </style>
</head>
<body>
  ${body}
</body>
</html>`);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env value: ${name}`);
  return value;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function normalizeOrderId(value) {
  return String(value || '').trim().toUpperCase();
}

function escapeMarkdown(value) {
  return String(value || '').replace(/([\\`*_{}\[\]()#+\-.!|>])/g, '\\$1');
}

function findTicketForDone(tickets, channelId, orderId = '') {
  if (tickets[channelId]) {
    return tickets[channelId];
  }

  if (!orderId) {
    return null;
  }

  return Object.values(tickets).find((ticket) => normalizeOrderId(ticket.orderId) === orderId) || null;
}

function findCompletedTicketByOrderId(tickets, orderId) {
  const normalizedOrderId = normalizeOrderId(orderId);
  if (!normalizedOrderId) return null;

  return Object.values(tickets).find((ticket) => {
    return ticket.done && normalizeOrderId(ticket.orderId) === normalizedOrderId;
  }) || null;
}

function formatCompletedOrderItems(cart = []) {
  return cart.map((item) => {
    const rawName = String(item.name || 'Item');
    const quantity = Math.max(1, Number(item.quantity || 1));

    if (rawName.toLowerCase().includes('donut money')) {
      const moneyAmount = getMoneyMillionsFromItem(rawName);
      const millions = moneyAmount > 0 ? moneyAmount * quantity : quantity;
      return {
        name: 'Donut Money',
        quantity: formatOrderQuantity('Donut Money', millions),
      };
    }

    return {
      name: rawName,
      quantity: `x${quantity}`,
    };
  });
}

function getMoneyMillionsFromItem(itemName) {
  const match = String(itemName || '').match(/(\d+(?:\.\d+)?)\s*([MB])\b/i);
  if (!match) {
    return 0;
  }

  const amount = Number(match[1]);
  const unit = match[2].toUpperCase();
  return unit === 'B' ? amount * 1000 : amount;
}

function formatOrderQuantity(itemName, quantity) {
  if (itemName !== 'Donut Money') {
    return `x${quantity}`;
  }

  if (quantity >= 1000) {
    const billions = quantity / 1000;
    return `${Number.isInteger(billions) ? billions : billions.toFixed(1)}B`;
  }

  return `${quantity}M`;
}

function formatUsd(value) {
  const amount = Number.isFinite(value) ? value : 0;
  return `$${amount.toFixed(2)}`;
}

function formatPaymentMethod(payment) {
  const method = toTitleCase(payment.method || 'unknown');
  const coin = payment.coin ? ` (${String(payment.coin).toUpperCase()})` : '';
  const providerStatus = payment.providerStatus ? ` \u2022 ${formatOrderStatus(payment.providerStatus)}` : '';
  return `${method}${coin}${providerStatus}`;
}

function formatOrderStatus(status) {
  return String(status || 'unknown')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toTitleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildOrderDetailFields(order) {
  const cart = Array.isArray(order.cart) ? order.cart : [];
  const buyer = order.buyer || {};
  const payment = {
    ...(order.payment || {}),
    providerStatus: order.payment?.providerStatus || order.provider?.providerStatus || '',
  };
  const summary = order.summary || {};
  const pricing = order.pricing || {};
  const total = Number(payment.total ?? summary.subtotal ?? pricing.total ?? pricing.subtotal ?? 0);
  const cartLines = cart.slice(0, 10).map((item) => {
    const quantity = Number(item.quantity || 1);
    const price = Number(item.price || 0) * quantity;
    return '\u2022 **' + escapeMarkdown(item.name || 'Item') + '** \u00d7 ' + quantity + ' \u2014 ' + formatUsd(price);
  });
  const extraItems = cart.length > 10 ? '\n\u2026and ' + (cart.length - 10) + ' more item(s)' : '';

  return [
    { name: '\u{1F4CC} Status', value: '`' + escapeMarkdown(formatOrderStatus(order.status)) + '`', inline: true },
    { name: '\u{1F4B5} Total Paid', value: '`' + formatUsd(total) + '`', inline: true },
    { name: '\u{1F4B3} Payment', value: escapeMarkdown(formatPaymentMethod(payment)), inline: true },
    { name: '\u{1F3AE} IGN', value: escapeMarkdown(buyer.ign || 'Not provided'), inline: true },
    { name: '\u{1F4AC} Discord', value: escapeMarkdown(buyer.discordTag || 'Not provided'), inline: true },
    { name: '\u{1F552} Ordered At', value: escapeMarkdown(formatStoreDate(order.createdAt)), inline: true },
    { name: '\u{1F4E6} Purchased Items', value: (cartLines.join('\n') || 'No items listed') + extraItems, inline: false },
  ];
}
function normalizeOrderForTicket(order) {
  return {
    id: order.id,
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    buyer: order.buyer || {},
    payment: order.payment || {},
    pricing: order.pricing || order.summary || {},
    cart: Array.isArray(order.cart) ? order.cart : [],
  };
}

function formatStoreDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return formatDateTime(date);
}

function maskCustomerName(name) {
  const cleanName = String(name || 'Customer').trim();
  if (cleanName.length <= 2) return `${cleanName[0] || 'C'}**`;
  if (cleanName.length <= 4) return `${cleanName.slice(0, 1)}**${cleanName.slice(-1)}`;
  return `${cleanName.slice(0, 2)}**${cleanName.slice(-1)}`;
}

function formatDateTime(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year}, ${hours}:${minutes}`;
}

startOAuthServer();
client.login(config.token);
