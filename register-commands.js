const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

loadEnv();

const token = requireEnv('BOT_TOKEN');
const clientId = requireEnv('CLIENT_ID');
const guildId = requireEnv('GUILD_ID');

const commands = [
  new SlashCommandBuilder()
    .setName('setup-verify')
    .setDescription('Post the verification button in this channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('setup-ticket')
    .setDescription('Post the order ticket panel in this channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('setup-legit')
    .setDescription('Post the legit check reaction message in this channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('done')
    .setDescription('Mark a verified ticket order as fulfilled and post it to the orders channel.')
    .addStringOption((option) =>
      option
        .setName('order_id')
        .setDescription('Optional: use this if you are not running /done inside the ticket channel.')
        .setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName('join-authorized')
    .setDescription('Add a user who already authorized the bot to this server.')
    .addStringOption((option) =>
      option
        .setName('user_id')
        .setDescription('The Discord user ID to add.')
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('join-all-authorized')
    .setDescription('Add every saved authorized user to this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('authorized-list')
    .setDescription('Show users who have authorized the bot.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map((command) => command.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands })
  .then(() => console.log('Registered slash commands.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

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
