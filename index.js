/**
 * Haggle Discord bot — marketplace helper (demo)
 * Slash commands: /marketplace-setup, /sell, /wanted, /haggle, /fee, /mark-sold
 * Also: natural-language listing via messages (photo / selling keywords / wanted:)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Partials,
  Events,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

const FEE_RATE = 0.02;
const DEFAULT_SUGGEST_PRICE = 22;
const LEDGER_PATH = path.resolve(__dirname, '../fee-ledger.csv');

/** @type {Map<string, object>} in-memory draft sessions keyed by userId */
const draftSessions = new Map();

/** Default guild for DM posts when session has no guildId (HAGGLE AI). */
const DEFAULT_GUILD_ID = process.env.GUILD_ID || '1553372098943262750';

/** Prefer exact names (case-insensitive; leading # stripped). */
const MARKETPLACE_NAME_CANDIDATES = ['marketplace', 'for-sale', 'for_sale', '#marketplace'];
const WANTED_NAME_CANDIDATES = ['wanted'];

/** @type {Map<string, string>} guildId -> resolved channel id cache */
const marketplaceChannelCache = new Map();
/** @type {Map<string, string>} guildId -> resolved wanted channel id cache */
const wantedChannelCache = new Map();

function normalizeChannelName(name) {
  return String(name || '')
    .replace(/^#/, '')
    .trim()
    .toLowerCase();
}

function findTextChannelByNames(guild, candidates) {
  // Walk candidates in order so "marketplace" wins over for-sale / for_sale.
  for (const candidate of candidates) {
    const want = normalizeChannelName(candidate);
    const ch = guild.channels.cache.find(
      (c) =>
        c &&
        typeof c.isTextBased === 'function' &&
        c.isTextBased() &&
        !(typeof c.isThread === 'function' && c.isThread()) &&
        normalizeChannelName(c.name) === want
    );
    if (ch) return ch;
  }
  return null;
}

async function resolveGuild(guildOrId) {
  if (guildOrId && typeof guildOrId === 'object' && guildOrId.channels) {
    return guildOrId;
  }
  const id = String(guildOrId || DEFAULT_GUILD_ID);
  let guild = client.guilds.cache.get(id);
  if (!guild) {
    try {
      guild = await client.guilds.fetch(id);
    } catch {
      return null;
    }
  }
  return guild;
}

/**
 * Resolve (and cache) the marketplace listing channel for a guild.
 * Order: MARKETPLACE_CHANNEL_ID env → cache → name match → optionally create #marketplace.
 * @returns {{ channel: import('discord.js').GuildTextBasedChannel|null, created: boolean, error?: string }}
 */
async function ensureMarketplaceChannel(guild, { createIfMissing = true } = {}) {
  if (!guild) {
    return { channel: null, created: false, error: 'no_guild' };
  }
  const guildId = guild.id;

  const tryFetch = async (channelId) => {
    if (!channelId) return null;
    let ch = guild.channels.cache.get(channelId);
    if (!ch) {
      try {
        ch = await guild.channels.fetch(channelId);
      } catch {
        return null;
      }
    }
    if (ch && typeof ch.isTextBased === 'function' && ch.isTextBased()) return ch;
    return null;
  };

  const envId = process.env.MARKETPLACE_CHANNEL_ID;
  if (envId) {
    const ch = await tryFetch(envId);
    if (ch) {
      marketplaceChannelCache.set(guildId, ch.id);
      return { channel: ch, created: false };
    }
  }

  if (marketplaceChannelCache.has(guildId)) {
    const ch = await tryFetch(marketplaceChannelCache.get(guildId));
    if (ch) return { channel: ch, created: false };
    marketplaceChannelCache.delete(guildId);
  }

  try {
    await guild.channels.fetch();
  } catch {
    /* cache may already be warm */
  }

  let ch = findTextChannelByNames(guild, MARKETPLACE_NAME_CANDIDATES);
  if (ch) {
    marketplaceChannelCache.set(guildId, ch.id);
    return { channel: ch, created: false };
  }

  if (createIfMissing) {
    let me = guild.members.me;
    if (!me) {
      try {
        me = await guild.members.fetchMe();
      } catch {
        me = null;
      }
    }
    if (me && me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      try {
        ch = await guild.channels.create({
          name: 'marketplace',
          type: ChannelType.GuildText,
          reason: 'Haggle: auto-create marketplace listing channel',
        });
        marketplaceChannelCache.set(guildId, ch.id);
        return { channel: ch, created: true };
      } catch (err) {
        console.error('Failed to create #marketplace:', err.message);
        return { channel: null, created: false, error: 'create_failed' };
      }
    }
    return {
      channel: null,
      created: false,
      error: 'missing_no_permission',
    };
  }

  return { channel: null, created: false, error: 'missing' };
}

/**
 * Resolve wanted channel: WANTED_CHANNEL_ID → cache → name "wanted" → marketplace fallback.
 */
async function ensureWantedChannel(guild, { createIfMissing = false } = {}) {
  if (!guild) {
    return { channel: null, created: false, error: 'no_guild' };
  }
  const guildId = guild.id;

  const tryFetch = async (channelId) => {
    if (!channelId) return null;
    let ch = guild.channels.cache.get(channelId);
    if (!ch) {
      try {
        ch = await guild.channels.fetch(channelId);
      } catch {
        return null;
      }
    }
    if (ch && typeof ch.isTextBased === 'function' && ch.isTextBased()) return ch;
    return null;
  };

  const envId = process.env.WANTED_CHANNEL_ID;
  if (envId) {
    const ch = await tryFetch(envId);
    if (ch) {
      wantedChannelCache.set(guildId, ch.id);
      return { channel: ch, created: false };
    }
  }

  if (wantedChannelCache.has(guildId)) {
    const ch = await tryFetch(wantedChannelCache.get(guildId));
    if (ch) return { channel: ch, created: false };
    wantedChannelCache.delete(guildId);
  }

  try {
    await guild.channels.fetch();
  } catch {
    /* ignore */
  }

  let ch = findTextChannelByNames(guild, WANTED_NAME_CANDIDATES);
  if (ch) {
    wantedChannelCache.set(guildId, ch.id);
    return { channel: ch, created: false };
  }

  // Fall back to marketplace (env / name / create)
  return ensureMarketplaceChannel(guild, { createIfMissing });
}

function missingChannelHelp(kind = 'marketplace') {
  if (kind === 'wanted') {
    return (
      'No **wanted** (or marketplace) channel found. ' +
      'Set `WANTED_CHANNEL_ID` / `MARKETPLACE_CHANNEL_ID`, create a channel named `wanted` or `marketplace`, ' +
      'or give the bot **Manage Channels** so it can create `#marketplace`.'
    );
  }
  return (
    'No **marketplace** channel found. ' +
    'Set `MARKETPLACE_CHANNEL_ID`, create a channel named `marketplace` / `for-sale` / `for_sale`, ' +
    'or give the bot **Manage Channels** so it can create `#marketplace`.'
  );
}

const SELL_KEYWORDS = /\b(selling|sell|wts|for sale|listing)\b/i;
const WANTED_PREFIX = /^(wanted:\s*|looking for\s+|iso\s+)/i;
const CONDITION_WORDS =
  /\b(brand new|like new|excellent|very good|good|fair|poor|used|new|worn|mint)\b/i;

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('Set DISCORD_BOT_TOKEN in .env (see .env.example)');
  process.exit(1);
}

const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.DirectMessages,
];
// Requires Developer Portal → Bot → Privileged Gateway Intents → Message Content Intent
if (process.env.ENABLE_MESSAGE_CONTENT !== '0') {
  intents.push(GatewayIntentBits.MessageContent);
}

const client = new Client({
  intents,
  partials: [Partials.Channel, Partials.Message],
});

function gbp(n) {
  return `£${Number(n).toFixed(2)}`;
}

function computeFee(salePrice) {
  const fee = Math.round(salePrice * FEE_RATE * 100) / 100;
  const net = Math.round((salePrice - fee) * 100) / 100;
  return { fee, net, rate: FEE_RATE };
}

function ensureLedgerHeader() {
  if (!fs.existsSync(LEDGER_PATH)) {
    fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
    fs.writeFileSync(
      LEDGER_PATH,
      'sale_id,listed_at,item_url,item_title,sale_price_gbp,fee_rate,fee_gbp,seller_net_gbp,status,notes\n'
    );
  }
}

function appendLedger({ saleId, title, salePrice, notes = '' }) {
  ensureLedgerHeader();
  const { fee, net, rate } = computeFee(salePrice);
  const listedAt = new Date().toISOString().slice(0, 10);
  const safe = (s) => String(s ?? '').replace(/,/g, ' ').replace(/\n/g, ' ');
  const row = [
    safe(saleId),
    listedAt,
    '',
    safe(title),
    Number(salePrice).toFixed(2),
    rate,
    fee.toFixed(2),
    net.toFixed(2),
    'sold',
    safe(notes),
  ].join(',');
  fs.appendFileSync(LEDGER_PATH, row + '\n');
  return { fee, net };
}

function haggleAdvice(ask, offer, softFloor) {
  const ratio = offer / ask;
  const floor = softFloor != null ? softFloor : ask * 0.75;
  const mid = Math.round(((ask + offer) / 2) * 100) / 100;
  const counter = Math.max(floor, Math.round(ask * 0.85 * 100) / 100);

  if (ratio >= 0.9) {
    return {
      stance: 'Lean accept',
      draft: `Happy to meet you at ${gbp(offer)} — sounds fair. When works for meetup/handover?`,
      detail: `Offer is ${(ratio * 100).toFixed(0)}% of ask (≥90%).`,
    };
  }
  if (ratio >= 0.75) {
    const suggest = Math.max(counter, mid);
    return {
      stance: 'Suggest counter',
      draft: `Thanks for the offer of ${gbp(offer)}. Could you do ${gbp(suggest)}? That works better for me.`,
      detail: `Offer is ${(ratio * 100).toFixed(0)}% of ask (75–90%). Counter ≈ max(soft floor / 85% ask, mid) → ${gbp(suggest)}.`,
    };
  }
  return {
    stance: 'Firm / decline',
    draft: `Appreciate the interest — ${gbp(offer)} is a bit low for me. Lowest I can go right now is around ${gbp(Math.max(floor, ask * 0.85))}. Happy to chat if that works.`,
    detail: `Offer is ${(ratio * 100).toFixed(0)}% of ask (<75%).`,
  };
}

/** Loose caption parse: price (£22, 22 quid), size, condition, leftover → title/notes */
function parseListingText(text) {
  if (!text || !String(text).trim()) {
    return { title: null, price: null, size: null, condition: null, notes: null };
  }
  let rest = String(text).trim();
  let price = null;
  let size = null;
  let condition = null;

  const priceMatch = rest.match(
    /(?:£\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:quid|gbp|pounds?)\b)/i
  );
  if (priceMatch) {
    price = Number(priceMatch[1] || priceMatch[2]);
    rest = rest.replace(priceMatch[0], ' ').trim();
  }

  const condMatch = rest.match(CONDITION_WORDS);
  if (condMatch) {
    condition = condMatch[1];
    rest = rest.replace(condMatch[0], ' ').trim();
  }

  const sizeMatch = rest.match(/\bsize\s*(?:uk\s*)?([xsml]{1,3}|xxl|xxxl|\d{1,2}(?:\.\d)?)\b/i);
  if (sizeMatch) {
    size = sizeMatch[1].toUpperCase();
    rest = rest.replace(sizeMatch[0], ' ').trim();
  } else {
    const bare = rest.match(/\b(uk\s*)?(\d{1,2}(?:\.\d)?|[xsml]{1,3}|xxl|xxxl)\b/i);
    // Only treat bare size tokens if "size" keyword nearby or common letter sizes
    if (bare && /size/i.test(text)) {
      size = bare[2].toUpperCase();
      rest = rest.replace(bare[0], ' ').trim();
    }
  }

  rest = rest
    .replace(SELL_KEYWORDS, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[-–—:,.\s]+|[-–—:,.\s]+$/g, '')
    .trim();

  const title = rest || null;
  return { title, price, size, condition, notes: null };
}

function imageAttachments(message) {
  return [...message.attachments.values()].filter(
    (a) =>
      (a.contentType && a.contentType.startsWith('image/')) ||
      /\.(png|jpe?g|gif|webp)$/i.test(a.name || a.url || '')
  );
}

function getOrCreateSession(userId) {
  let s = draftSessions.get(userId);
  if (!s) {
    s = {
      title: null,
      price: null,
      size: null,
      condition: null,
      notes: null,
      imageUrl: null,
      channelId: null,
      guildId: null,
      awaiting: null, // 'size' | 'condition' | 'price' | 'confirm'
      promptAsked: {},
    };
    draftSessions.set(userId, s);
  }
  return s;
}

function clearSession(userId) {
  draftSessions.delete(userId);
}

function missingFields(session) {
  const miss = [];
  if (session.price == null) miss.push('price');
  if (!session.size) miss.push('size');
  if (!session.condition) miss.push('condition');
  if (!session.title) miss.push('title');
  return miss;
}

function buildSellEmbed({ title, price, size, condition, notes, sellerId, listingId, imageUrl }) {
  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle(title)
    .addFields(
      { name: 'Price', value: gbp(price), inline: true },
      { name: 'Size', value: size || '—', inline: true },
      { name: 'Condition', value: condition || '—', inline: true },
      { name: 'Seller', value: `<@${sellerId}>`, inline: true },
      { name: 'Haggle fee', value: '2% on sale', inline: true }
    )
    .setFooter({ text: `Listing ${listingId}` })
    .setTimestamp();
  if (notes) embed.addFields({ name: 'Notes', value: notes });
  if (imageUrl) embed.setImage(imageUrl);
  return embed;
}

function sellButtons(sellerId, listingId, price) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`interested:${sellerId}:${listingId}`)
      .setLabel("I'm interested")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`sold:${sellerId}:${listingId}:${price}`)
      .setLabel('Sold')
      .setStyle(ButtonStyle.Success)
  );
}

function draftConfirmRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`draft_confirm:${userId}`)
      .setLabel('Confirm post')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`draft_edit_price:${userId}`)
      .setLabel('Edit price')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`draft_cancel:${userId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger)
  );
}

function buildDraftPreviewEmbed(session, userId) {
  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle(`Draft · ${session.title || 'Untitled item'}`)
    .setDescription('Review your listing, then **Confirm post**, **Edit price**, or **Cancel**.')
    .addFields(
      { name: 'Price', value: session.price != null ? gbp(session.price) : '—', inline: true },
      { name: 'Size', value: session.size || '—', inline: true },
      { name: 'Condition', value: session.condition || '—', inline: true },
      { name: 'Seller', value: `<@${userId}>`, inline: true }
    )
    .setFooter({ text: 'Haggle · draft (not posted yet)' })
    .setTimestamp();
}

async function askNextMissing(message, session) {
  const miss = missingFields(session);
  // Prefer asking price / size / condition; title last (can invent from photo)
  const order = ['price', 'size', 'condition', 'title'];
  const next = order.find((f) => miss.includes(f));
  if (!next) {
    session.awaiting = 'confirm';
    // Ensure DM drafts still target the home guild marketplace on Confirm
    if (!session.guildId) {
      session.guildId = message.guild?.id || DEFAULT_GUILD_ID;
    }
    const preview = buildDraftPreviewEmbed(session, message.author.id);
    if (session.imageUrl) preview.setImage(session.imageUrl);
    const hint = message.guild
      ? 'Review your listing, then **Confirm post**.'
      : 'Review your listing, then **Confirm post** — it will go to **#marketplace** in the Haggle server.';
    preview.setDescription(
      `${hint} Use **Edit price** or **Cancel** if needed.`
    );
    await message.reply({ embeds: [preview], components: [draftConfirmRow(message.author.id)] });
    return;
  }

  session.awaiting = next;
  const prompts = {
    price: 'What **price**? (e.g. `£22` or `22 quid`) — or say **suggest** for a demo default of £22.',
    size: 'What **size**? (e.g. `M`, `UK 8`, `size 10`)',
    condition: 'What **condition**? (e.g. `new`, `like new`, `good`, `used`)',
    title: 'What should we call this item? (short **title**)',
  };
  await message.reply(prompts[next]);
}

async function postListingFromSession(channel, session, sellerId) {
  const listingId = `d${Date.now()}`;
  const title = session.title || 'Item for sale';
  const price = session.price ?? DEFAULT_SUGGEST_PRICE;
  const embed = buildSellEmbed({
    title,
    price,
    size: session.size,
    condition: session.condition,
    notes: session.notes,
    sellerId,
    listingId,
    imageUrl: session.imageUrl,
  });
  const row = sellButtons(sellerId, listingId, price);
  const message = await channel.send({ embeds: [embed], components: [row] });
  return { listingId, message };
}

/**
 * Resolve guild + marketplace channel, post listing, return { ok, message, channel, error, created }.
 */
async function postListingToMarketplace(session, sellerId, { guildHint } = {}) {
  const guild = await resolveGuild(guildHint || session.guildId || DEFAULT_GUILD_ID);
  if (!guild) {
    return {
      ok: false,
      error:
        'Bot is not in the Haggle server (or GUILD_ID is wrong). Invite the bot, then try again.',
    };
  }
  const { channel, created, error } = await ensureMarketplaceChannel(guild, {
    createIfMissing: true,
  });
  if (!channel) {
    return { ok: false, error: missingChannelHelp('marketplace'), created: false };
  }
  const { listingId, message } = await postListingFromSession(channel, session, sellerId);
  return { ok: true, listingId, message, channel, created };
}

async function handleWantedMessage(message, text) {
  const guild = await resolveGuild(message.guild || message.guildId || DEFAULT_GUILD_ID);
  if (!guild) {
    await message.reply(
      'Wanted posts need the Haggle server. Invite the bot, or use `/wanted` there.'
    );
    return;
  }
  const { channel, error } = await ensureWantedChannel(guild, { createIfMissing: true });
  if (!channel) {
    await message.reply(error || missingChannelHelp('wanted'));
    return;
  }
  const need = text.replace(WANTED_PREFIX, '').trim() || text.trim();
  const parsed = parseListingText(need);
  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle('Wanted')
    .setDescription(parsed.title || need)
    .addFields(
      {
        name: 'Budget',
        value: parsed.price != null ? gbp(parsed.price) : 'Flexible',
        inline: true,
      },
      { name: 'Location', value: '—', inline: true },
      { name: 'Buyer', value: `<@${message.author.id}>`, inline: true }
    )
    .setFooter({ text: 'Haggle · wanted' })
    .setTimestamp();
  const posted = await channel.send({ embeds: [embed] });
  if (message.channelId !== channel.id) {
    await message.reply(`Wanted posted in <#${channel.id}>: ${posted.url}`);
  }
}

async function handleSellMessage(message) {
  const userId = message.author.id;
  const text = (message.content || '').trim();
  const images = imageAttachments(message);

  // Cancel anytime (before creating a fresh session)
  if (/^(cancel|nevermind|nvm)$/i.test(text)) {
    if (draftSessions.has(userId)) {
      clearSession(userId);
      await message.reply('Draft cancelled.');
    }
    return;
  }

  const session = getOrCreateSession(userId);

  // Store channel context when in a guild
  if (message.guild) {
    session.channelId = message.channel.id;
    session.guildId = message.guild.id;
  }

  if (images.length) {
    session.imageUrl = images[0].url;
  }

  // Merge caption / reply text into session
  if (text && !/^(cancel|nevermind|nvm)$/i.test(text)) {
    if (session.awaiting === 'price' || (session.price == null && /suggest/i.test(text))) {
      if (/^\s*suggest\s*$/i.test(text) || (session.awaiting === 'price' && /suggest/i.test(text))) {
        session.price = DEFAULT_SUGGEST_PRICE;
        session.awaiting = null;
        await askNextMissing(message, session);
        return;
      }
    }

    if (session.awaiting === 'price') {
      const p = parseListingText(text);
      if (p.price != null) {
        session.price = p.price;
        session.awaiting = null;
        await askNextMissing(message, session);
        return;
      }
      await message.reply('Could not parse a price. Try `£22`, `22 quid`, or **suggest**.');
      return;
    }

    if (session.awaiting === 'size') {
      const sizeMatch =
        text.match(/\b(?:size\s*)?(?:uk\s*)?([xsml]{1,3}|xxl|xxxl|\d{1,2}(?:\.\d)?)\b/i) ||
        text.match(/^(.+)$/);
      session.size = (sizeMatch[1] || text).trim();
      session.awaiting = null;
      await askNextMissing(message, session);
      return;
    }

    if (session.awaiting === 'condition') {
      const c = text.match(CONDITION_WORDS);
      session.condition = c ? c[1] : text.trim();
      session.awaiting = null;
      await askNextMissing(message, session);
      return;
    }

    if (session.awaiting === 'title') {
      session.title = text.trim();
      session.awaiting = null;
      await askNextMissing(message, session);
      return;
    }

    if (session.awaiting === 'confirm' && /^(post|confirm|yes)$/i.test(text)) {
      const result = await postListingToMarketplace(session, userId, {
        guildHint: message.guild?.id || session.guildId,
      });
      if (!result.ok) {
        await message.reply(result.error);
        return;
      }
      clearSession(userId);
      const createdNote = result.created ? ' (created #marketplace)' : '';
      await message.reply(
        `Listing posted in <#${result.channel.id}>${createdNote}: ${result.message.url}`
      );
      return;
    }

    // Fresh or continuing: parse free-form caption
    const parsed = parseListingText(text);
    if (parsed.title) session.title = session.title || parsed.title;
    if (parsed.price != null) session.price = parsed.price;
    if (parsed.size) session.size = parsed.size;
    if (parsed.condition) session.condition = parsed.condition;

    // Bare "suggest" while price still missing
    if (session.price == null && /^\s*suggest\s*$/i.test(text)) {
      session.price = DEFAULT_SUGGEST_PRICE;
    }
  }

  // Default title from first image name if still missing after photo-only drop
  if (!session.title && images.length) {
    const name = (images[0].name || 'photo').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    session.title = name && name !== 'image' ? name : 'Item for sale';
  }

  await askNextMissing(message, session);
}

client.once(Events.ClientReady, () => {
  console.log(`Haggle bot logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;

    const text = (message.content || '').trim();
    const images = imageAttachments(message);
    const userId = message.author.id;
    const hasSession = draftSessions.has(userId);
    const session = hasSession ? draftSessions.get(userId) : null;
    const inActiveDraft = Boolean(session && session.awaiting);

    // Wanted: no photo required
    if (WANTED_PREFIX.test(text)) {
      await handleWantedMessage(message, text);
      return;
    }

    const sellIntent =
      images.length > 0 || SELL_KEYWORDS.test(text) || inActiveDraft;

    if (!sellIntent) return;

    // Reply in an active draft, or new sell/photo message
    await handleSellMessage(message);
  } catch (err) {
    console.error('messageCreate error:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
      return;
    }
    if (interaction.isButton()) {
      await handleButton(interaction);
    }
  } catch (err) {
    console.error('interaction error:', err);
    const msg = { content: 'Something went wrong — try again.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

async function handleCommand(interaction) {
  const { commandName } = interaction;

  if (commandName === 'marketplace-setup') {
    const forSale = interaction.options.getChannel('for_sale_channel');
    const wanted = interaction.options.getChannel('wanted_channel');
    const forSaleLabel = forSale ? `<#${forSale.id}>` : '#marketplace';
    const wantedLabel = wanted ? `<#${wanted.id}>` : '#wanted';

    const embed = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle('Haggle marketplace setup')
      .setDescription(
        'Use these channels for BST-style trading. Listings from `/sell` and Confirm post always go to **#marketplace** (or MARKETPLACE_CHANNEL_ID).'
      )
      .addFields(
        {
          name: `${forSaleLabel} — Marketplace / for sale`,
          value:
            'List with `/sell`, or drop a **photo** / say **selling** … and Confirm post. Posts land in **#marketplace**.',
        },
        {
          name: `${wantedLabel} — Wanted`,
          value:
            'Post with `/wanted`, or type `wanted: …` / `looking for …` / `iso …` in the channel.',
        },
        {
          name: '#deals — Deals / sold',
          value:
            'Mark items sold via the **Sold** button or `/mark-sold`. Haggle fee is **2%** of sale price.',
        },
        {
          name: 'Tips',
          value:
            "• DM sellers after **I'm interested**\n• Use `/haggle` for a draft counter\n• Use `/fee` to preview the 2% fee",
        }
      )
      .setFooter({ text: 'Haggle · demo' })
      .setTimestamp();

    const reply = await interaction.reply({ embeds: [embed], fetchReply: true });
    try {
      await reply.pin();
      await interaction.followUp({ content: 'Setup pinned in this channel.', ephemeral: true });
    } catch {
      await interaction.followUp({
        content: 'Posted setup embed (could not pin — need Manage Messages).',
        ephemeral: true,
      });
    }
    return;
  }

  if (commandName === 'sell') {
    const title = interaction.options.getString('title', true);
    const price = interaction.options.getNumber('price_gbp', true);
    const size = interaction.options.getString('size');
    const condition = interaction.options.getString('condition');
    const notes = interaction.options.getString('notes');
    // Explicit option still overrides; otherwise always post to marketplace channel
    const targetCh = interaction.options.getChannel('for_sale_channel');
    const sellerId = interaction.user.id;
    const listingId = `d${Date.now()}`;

    const embed = buildSellEmbed({
      title,
      price,
      size,
      condition,
      notes,
      sellerId,
      listingId,
    });
    const row = sellButtons(sellerId, listingId, price);

    let channel = targetCh;
    let created = false;
    if (!channel) {
      const guild = await resolveGuild(interaction.guild || DEFAULT_GUILD_ID);
      if (!guild) {
        await interaction.reply({
          content: 'Bot is not in the Haggle server. Invite it, then try `/sell` again.',
          ephemeral: true,
        });
        return;
      }
      const resolved = await ensureMarketplaceChannel(guild, { createIfMissing: true });
      channel = resolved.channel;
      created = resolved.created;
      if (!channel) {
        await interaction.reply({
          content: resolved.error || missingChannelHelp('marketplace'),
          ephemeral: true,
        });
        return;
      }
    }

    const posted = await channel.send({ embeds: [embed], components: [row] });
    const createdNote = created ? ' (created #marketplace)' : '';
    await interaction.reply({
      content: `Listing posted in <#${channel.id}>${createdNote}: ${posted.url}`,
      ephemeral: true,
    });
    return;
  }

  if (commandName === 'wanted') {
    const need = interaction.options.getString('need', true);
    const budget = interaction.options.getNumber('budget_gbp');
    const location = interaction.options.getString('location');

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle('Wanted')
      .setDescription(need)
      .addFields(
        { name: 'Budget', value: budget != null ? gbp(budget) : 'Flexible', inline: true },
        { name: 'Location', value: location || '—', inline: true },
        { name: 'Buyer', value: `<@${interaction.user.id}>`, inline: true }
      )
      .setFooter({ text: 'Haggle · wanted' })
      .setTimestamp();

    const guild = await resolveGuild(interaction.guild || DEFAULT_GUILD_ID);
    if (!guild) {
      await interaction.reply({
        content: 'Bot is not in the Haggle server. Invite it, then try `/wanted` again.',
        ephemeral: true,
      });
      return;
    }
    const { channel, created, error } = await ensureWantedChannel(guild, {
      createIfMissing: true,
    });
    if (!channel) {
      await interaction.reply({
        content: error || missingChannelHelp('wanted'),
        ephemeral: true,
      });
      return;
    }
    const posted = await channel.send({ embeds: [embed] });
    const createdNote = created ? ' (created #marketplace)' : '';
    await interaction.reply({
      content: `Wanted posted in <#${channel.id}>${createdNote}: ${posted.url}`,
      ephemeral: true,
    });
    return;
  }

  if (commandName === 'haggle') {
    const ask = interaction.options.getNumber('ask_gbp', true);
    const offer = interaction.options.getNumber('offer_gbp', true);
    const softFloor = interaction.options.getNumber('soft_floor_gbp');

    if (ask <= 0 || offer < 0) {
      await interaction.reply({
        content: 'ask_gbp must be > 0 and offer_gbp ≥ 0.',
        ephemeral: true,
      });
      return;
    }

    const advice = haggleAdvice(ask, offer, softFloor);
    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle(`Haggle coach · ${advice.stance}`)
      .addFields(
        { name: 'Ask', value: gbp(ask), inline: true },
        { name: 'Offer', value: gbp(offer), inline: true },
        {
          name: 'Soft floor',
          value: softFloor != null ? gbp(softFloor) : 'default (~75% ask)',
          inline: true,
        },
        { name: 'Rule', value: advice.detail },
        { name: 'Draft message (copy)', value: `\`\`\`\n${advice.draft}\n\`\`\`` }
      )
      .setFooter({ text: 'Haggle · demo rules' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (commandName === 'fee') {
    const salePrice = interaction.options.getNumber('sale_price_gbp', true);
    if (salePrice < 0) {
      await interaction.reply({ content: 'sale_price_gbp must be ≥ 0.', ephemeral: true });
      return;
    }
    const { fee, net } = computeFee(salePrice);
    const embed = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle('Haggle fee (2%)')
      .addFields(
        { name: 'Sale price', value: gbp(salePrice), inline: true },
        { name: 'Fee (2%)', value: gbp(fee), inline: true },
        { name: 'Seller net', value: gbp(net), inline: true }
      );
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (commandName === 'mark-sold') {
    const title = interaction.options.getString('title', true);
    const salePrice = interaction.options.getNumber('sale_price_gbp', true);
    const notes = interaction.options.getString('notes') || 'mark-sold command';
    const saleId = `discord-mark-${Date.now()}`;
    const { fee, net } = appendLedger({ saleId, title, salePrice, notes });

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x22c55e)
          .setTitle('Marked sold')
          .addFields(
            { name: 'Item', value: title },
            { name: 'Sale price', value: gbp(salePrice), inline: true },
            { name: 'Fee (2%)', value: gbp(fee), inline: true },
            { name: 'Seller net', value: gbp(net), inline: true },
            { name: 'Ledger', value: `\`${LEDGER_PATH}\`` }
          ),
      ],
    });
  }
}

async function handleButton(interaction) {
  const parts = interaction.customId.split(':');
  const action = parts[0];

  // Draft session buttons (message-flow listings)
  if (action === 'draft_confirm' || action === 'draft_edit_price' || action === 'draft_cancel') {
    const ownerId = parts[1];
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: 'Only the seller who started this draft can use these buttons.',
        ephemeral: true,
      });
      return;
    }
    const session = draftSessions.get(ownerId);
    if (!session) {
      await interaction.reply({
        content: 'Draft expired or already posted. Start again with a photo or “selling …”.',
        ephemeral: true,
      });
      return;
    }

    if (action === 'draft_cancel') {
      clearSession(ownerId);
      await interaction.update({
        content: 'Draft cancelled.',
        embeds: [],
        components: [],
      });
      return;
    }

    if (action === 'draft_edit_price') {
      session.awaiting = 'price';
      session.price = null;
      await interaction.update({
        content: 'Send a new **price** in chat (e.g. `£25` or **suggest**), then I’ll show the draft again.',
        embeds: [],
        components: [],
      });
      return;
    }

    if (action === 'draft_confirm') {
      const result = await postListingToMarketplace(session, ownerId, {
        guildHint: interaction.guild?.id || session.guildId,
      });
      if (!result.ok) {
        await interaction.reply({ content: result.error, ephemeral: true });
        return;
      }
      clearSession(ownerId);
      const createdNote = result.created ? ' (created #marketplace)' : '';
      await interaction.update({
        content: `Listing posted in <#${result.channel.id}>${createdNote}: ${result.message.url}`,
        embeds: [],
        components: [],
      });
      return;
    }
  }

  if (action === 'interested') {
    const sellerId = parts[1];
    const listingId = parts[2];
    await interaction.reply({
      content: `Nice — DM the seller <@${sellerId}> to arrange the deal. (Listing \`${listingId}\`)`,
      ephemeral: true,
    });
    return;
  }

  if (action === 'sold') {
    // Demo: anyone can mark sold (production: require interaction.user.id === sellerId)
    const sellerId = parts[1];
    const listingId = parts[2];
    const price = Number(parts[3]);
    const title =
      interaction.message.embeds[0]?.title?.replace(/\s*·\s*SOLD$/i, '') || listingId;

    const { fee, net } = appendLedger({
      saleId: listingId,
      title,
      salePrice: price,
      notes: `sold-by:${interaction.user.id}`,
    });

    const embed = new EmbedBuilder()
      .setColor(0x6b7280)
      .setTitle(`${title} · SOLD`)
      .addFields(
        { name: 'Sale price', value: gbp(price), inline: true },
        { name: 'Fee (2%)', value: gbp(fee), inline: true },
        { name: 'Seller net', value: gbp(net), inline: true },
        { name: 'Seller', value: `<@${sellerId}>`, inline: true },
        { name: 'Marked by', value: `<@${interaction.user.id}>`, inline: true }
      )
      .setFooter({ text: `Listing ${listingId}` })
      .setTimestamp();

    const oldImage = interaction.message.embeds[0]?.image?.url;
    if (oldImage) embed.setImage(oldImage);

    await interaction.update({ embeds: [embed], components: [] });
    await interaction.followUp({
      content: `Sold! Fee ${gbp(fee)} · seller net ${gbp(net)}. Appended to fee ledger.`,
      ephemeral: true,
    });
  }
}

client.login(token);
