/**
 * Register guild slash commands (fast for demo — updates in seconds).
 * Usage: node register-commands.js
 * Requires: DISCORD_BOT_TOKEN, CLIENT_ID, GUILD_ID in .env
 */
require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, ChannelType } = require('discord.js');

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId || !guildId) {
  console.error('Missing DISCORD_BOT_TOKEN, CLIENT_ID, or GUILD_ID in .env');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('marketplace-setup')
    .setDescription('Post marketplace setup instructions and pin them')
    .addChannelOption((o) =>
      o
        .setName('for_sale_channel')
        .setDescription('Optional #for-sale channel to mention')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addChannelOption((o) =>
      o
        .setName('wanted_channel')
        .setDescription('Optional #wanted channel to mention')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('sell')
    .setDescription('List an item for sale (BST-style embed)')
    .addStringOption((o) =>
      o.setName('title').setDescription('Item title').setRequired(true)
    )
    .addNumberOption((o) =>
      o.setName('price_gbp').setDescription('Asking price in GBP').setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('size').setDescription('Size').setRequired(false)
    )
    .addStringOption((o) =>
      o.setName('condition').setDescription('Condition').setRequired(false)
    )
    .addStringOption((o) =>
      o.setName('notes').setDescription('Extra notes').setRequired(false)
    )
    .addChannelOption((o) =>
      o
        .setName('for_sale_channel')
        .setDescription('Post to this channel instead of current')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('wanted')
    .setDescription('Post a wanted request')
    .addStringOption((o) =>
      o.setName('need').setDescription('What you are looking for').setRequired(true)
    )
    .addNumberOption((o) =>
      o.setName('budget_gbp').setDescription('Budget in GBP').setRequired(false)
    )
    .addStringOption((o) =>
      o.setName('location').setDescription('Preferred location / meetup').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('haggle')
    .setDescription('Get a draft counter-offer message from simple rules')
    .addNumberOption((o) =>
      o.setName('ask_gbp').setDescription('Seller asking price (GBP)').setRequired(true)
    )
    .addNumberOption((o) =>
      o.setName('offer_gbp').setDescription('Buyer offer (GBP)').setRequired(true)
    )
    .addNumberOption((o) =>
      o
        .setName('soft_floor_gbp')
        .setDescription('Optional soft floor — lowest you might accept')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('fee')
    .setDescription('Show 2% Haggle fee and seller net')
    .addNumberOption((o) =>
      o.setName('sale_price_gbp').setDescription('Sale price in GBP').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('mark-sold')
    .setDescription('Record a sale and append 2% fee to the ledger')
    .addStringOption((o) =>
      o.setName('title').setDescription('Item title').setRequired(true)
    )
    .addNumberOption((o) =>
      o.setName('sale_price_gbp').setDescription('Final sale price GBP').setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('notes').setDescription('Optional notes').setRequired(false)
    ),
].map((c) => c.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`Registering ${commands.length} guild commands to guild ${guildId}...`);
    const data = await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });
    console.log(`Successfully registered ${data.length} commands.`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
