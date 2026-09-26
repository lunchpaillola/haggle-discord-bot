/**
 * Haggle Discord bot — marketplace helper (demo)
 * Slash commands: /marketplace-setup, /sell, /wanted, /haggle, /fee, /mark-sold
 * Also: natural-language listing via messages (photo / selling keywords / wanted:)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { acceptsCounter, defaultMinimum, evaluateOffer, parseOffer } = require('./negotiation');
const { generateNegotiationReply } = require('./ai-negotiator');
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
const NEGOTIATION_STATE_PATH = process.env.NEGOTIATION_STATE_PATH
  ? path.resolve(process.env.NEGOTIATION_STATE_PATH)
  : path.resolve(__dirname, 'data/negotiations.json');

function loadNegotiationState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(NEGOTIATION_STATE_PATH, 'utf8'));
    return {
      listings: parsed.listings || {},
      threads: parsed.threads || {},
    };
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Could not load negotiation state:', err.message);
    return { listings: {}, threads: {} };
  }
}

const negotiationState = loadNegotiationState();

function saveNegotiationState() {
  fs.mkdirSync(path.dirname(NEGOTIATION_STATE_PATH), { recursive: true });
  const temporaryPath = `${NEGOTIATION_STATE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(negotiationState, null, 2)}\n`);
  fs.renameSync(temporaryPath, NEGOTIATION_STATE_PATH);
}

function recordListing({ listingId, sellerId, title, askingPrice, minimumPrice, message }) {
  const existing = negotiationState.listings[listingId] || {};
  negotiationState.listings[listingId] = {
    ...existing,
    listingId,
    sellerId,
    title,
    askingPrice: Number(askingPrice),
    minimumPrice: Number(minimumPrice ?? defaultMinimum(askingPrice)),
    status: existing.status || 'open',
    channelId: message?.channelId || existing.channelId || null,
    messageId: message?.id || existing.messageId || null,
    guildId: message?.guildId || existing.guildId || null,
    negotiations: existing.negotiations || {},
  };
  saveNegotiationState();
  return negotiationState.listings[listingId];
}

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

function sellButtons(sellerId, listingId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`interested:${sellerId}:${listingId}`)
      .setLabel("I'm interested")
      .setStyle(ButtonStyle.Primary)
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
  const minimumPrice = session.minimumPrice ?? defaultMinimum(price);
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
  const row = sellButtons(sellerId, listingId);
  const message = await channel.send({ embeds: [embed], components: [row] });
  recordListing({
    listingId,
    sellerId,
    title,
    askingPrice: price,
    minimumPrice,
    message,
  });
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

    if (negotiationState.threads[message.channelId]) {
      await handleNegotiationMessage(message);
      return;
    }

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
            'Mark items sold via `/mark-sold`. Haggle fee is **2%** of sale price.',
        },
        {
          name: 'Tips',
          value:
            "• Click **I'm interested** to start a thread with the seller\n• Use `/haggle` for a draft counter\n• Use `/fee` to preview the 2% fee",
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
    const requestedMinimum = interaction.options.getNumber('minimum_accept_gbp');
    const minimumPrice = requestedMinimum ?? defaultMinimum(price);
    const size = interaction.options.getString('size');
    const condition = interaction.options.getString('condition');
    const notes = interaction.options.getString('notes');
    // Explicit option still overrides; otherwise always post to marketplace channel
    const targetCh = interaction.options.getChannel('for_sale_channel');
    const sellerId = interaction.user.id;
    const listingId = `d${Date.now()}`;

    if (price <= 0 || minimumPrice < 0 || minimumPrice > price) {
      await interaction.reply({
        content: 'Price must be greater than £0, and the private minimum must be between £0 and the asking price.',
        ephemeral: true,
      });
      return;
    }

    const embed = buildSellEmbed({
      title,
      price,
      size,
      condition,
      notes,
      sellerId,
      listingId,
    });
    const row = sellButtons(sellerId, listingId);

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
    recordListing({
      listingId,
      sellerId,
      title,
      askingPrice: price,
      minimumPrice,
      message: posted,
    });
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

async function fetchGuildChannel(guild, channelId) {
  if (!guild || !channelId) return null;
  return guild.channels.cache.get(channelId) || guild.channels.fetch(channelId).catch(() => null);
}

async function updateAcceptedListing(listing) {
  const guild = await resolveGuild(listing.guildId);
  const channel = await fetchGuildChannel(guild, listing.channelId);
  if (!channel?.messages || !listing.messageId) return;

  const listingMessage = await channel.messages.fetch(listing.messageId).catch(() => null);
  if (!listingMessage?.embeds?.[0]) return;

  const embed = EmbedBuilder.from(listingMessage.embeds[0])
    .setColor(0xf59e0b)
    .setTitle(`${listing.title} · DEAL AGREED`)
    .addFields({
      name: 'Status',
      value: `Offer accepted at ${gbp(listing.acceptedPrice)}. Pending handover.`,
    });
  await listingMessage.edit({ embeds: [embed], components: [] }).catch((err) => {
    console.error(`Could not update listing ${listing.listingId}:`, err.message);
  });
}

async function closeCompetingNegotiations(listing, winningBuyerId, currentThreadId) {
  const guild = await resolveGuild(listing.guildId);
  const negotiations = Object.values(listing.negotiations || {});

  for (const negotiation of negotiations) {
    if (negotiation.buyerId === winningBuyerId || negotiation.threadId === currentThreadId) continue;
    negotiation.status = 'closed_other_buyer_accepted';
    const thread = await fetchGuildChannel(guild, negotiation.threadId);
    if (!thread) continue;
    await thread.send(
      'Thanks for your interest. Another buyer has now agreed a deal for this item, so this negotiation is closed.'
    ).catch(() => {});
    await thread.setLocked(true, 'Another buyer was accepted').catch(() => {});
    await thread.setArchived(true, 'Another buyer was accepted').catch(() => {});
  }
  saveNegotiationState();
}

function addNegotiationHistory(negotiation, role, text) {
  negotiation.messages = negotiation.messages || [];
  negotiation.messages.push({
    role,
    text: String(text || '').slice(0, 1000),
    at: new Date().toISOString(),
  });
  negotiation.messages = negotiation.messages.slice(-20);
}

async function createIntelligentReply({ message, listing, negotiation, action, amount, fallback }) {
  if (!process.env.OPENAI_API_KEY) return fallback;
  await message.channel.sendTyping().catch(() => {});
  try {
    return (
      (await generateNegotiationReply({
        listing,
        buyerMessage: message.content,
        action,
        amount,
        history: negotiation.messages,
      })) || fallback
    );
  } catch (err) {
    console.error(`OpenAI negotiation reply failed (${err.status || err.code || 'error'}):`, err.message);
    return fallback;
  }
}

async function sendNegotiationReply(message, negotiation, content) {
  addNegotiationHistory(negotiation, 'assistant', content);
  saveNegotiationState();
  await message.reply(content);
}

async function handleNegotiationMessage(message) {
  const threadState = negotiationState.threads[message.channelId];
  if (!threadState) return;

  const listing = negotiationState.listings[threadState.listingId];
  if (!listing) {
    await message.reply('I can no longer find this listing. Please ask the seller to create it again.');
    return;
  }

  if (message.author.id !== threadState.buyerId) return;

  const negotiation = listing.negotiations[message.author.id] || {
    buyerId: message.author.id,
    threadId: message.channelId,
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  listing.negotiations[message.author.id] = negotiation;
  addNegotiationHistory(negotiation, 'buyer', message.content);

  if (listing.status === 'accepted') {
    if (listing.acceptedBuyerId === message.author.id) {
      const fallback = `Your offer of ${gbp(listing.acceptedPrice)} has already been accepted. Please arrange payment and handover with <@${listing.sellerId}>.`;
      const reply = await createIntelligentReply({
        message,
        listing,
        negotiation,
        action: 'winner_followup',
        amount: listing.acceptedPrice,
        fallback,
      });
      await sendNegotiationReply(message, negotiation, reply);
    } else {
      const fallback = 'Another buyer has already agreed a deal for this item. Thanks for your interest.';
      const reply = await createIntelligentReply({
        message,
        listing,
        negotiation,
        action: 'closed',
        fallback,
      });
      await sendNegotiationReply(message, negotiation, reply);
    }
    return;
  }

  const offer = acceptsCounter(message.content) && negotiation.lastCounter != null
    ? negotiation.lastCounter
    : parseOffer(message.content);
  if (offer == null) {
    const fallback = `Please send a price for your offer, for example **£${Number(listing.askingPrice).toFixed(0)}** or “I can offer £20”.`;
    const reply = await createIntelligentReply({
      message,
      listing,
      negotiation,
      action: 'clarify',
      fallback,
    });
    if (listing.status === 'accepted' && listing.acceptedBuyerId !== message.author.id) {
      await sendNegotiationReply(
        message,
        negotiation,
        'Another buyer has just agreed a deal for this item. Thanks for your interest.'
      );
      return;
    }
    await sendNegotiationReply(message, negotiation, reply);
    return;
  }

  negotiation.lastOffer = offer;
  negotiation.updatedAt = new Date().toISOString();
  const decision = evaluateOffer({
    askingPrice: listing.askingPrice,
    minimumPrice: listing.minimumPrice,
    offer,
  });

  if (decision.outcome === 'counter') {
    negotiation.status = 'countered';
    negotiation.lastCounter = decision.counter;
    saveNegotiationState();
    const fallback = `Thanks for the offer of ${gbp(offer)}. I can do **${gbp(decision.counter)}**. Send that amount here if you want to agree the deal.`;
    const reply = await createIntelligentReply({
      message,
      listing,
      negotiation,
      action: 'counter',
      amount: decision.counter,
      fallback,
    });
    if (listing.status === 'accepted' && listing.acceptedBuyerId !== message.author.id) {
      await sendNegotiationReply(
        message,
        negotiation,
        'Another buyer has just agreed a deal for this item. Thanks for your interest.'
      );
      return;
    }
    await sendNegotiationReply(message, negotiation, reply);
    return;
  }

  // This assignment happens before any await, so only the first qualifying message
  // handled by this process can move the listing from open to accepted.
  if (listing.status !== 'open') {
    await message.reply('Another buyer has just agreed a deal for this item. Thanks for your interest.');
    return;
  }
  listing.status = 'accepted';
  listing.acceptedBuyerId = message.author.id;
  listing.acceptedPrice = offer;
  listing.acceptedAt = new Date().toISOString();
  negotiation.status = 'accepted';
  saveNegotiationState();

  const fallback = `**Deal agreed at ${gbp(offer)}.** <@${listing.sellerId}> and <@${message.author.id}>, use this private thread to arrange payment and handover. Do not share payment details publicly.`;
  const [reply] = await Promise.all([
    createIntelligentReply({
      message,
      listing,
      negotiation,
      action: 'accept',
      amount: offer,
      fallback,
    }),
    updateAcceptedListing(listing),
    closeCompetingNegotiations(listing, message.author.id, message.channelId),
  ]);
  await sendNegotiationReply(message, negotiation, reply);
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
    const buyerId = interaction.user.id;
    const buyerTag = interaction.user.username || 'buyer';

    if (buyerId === sellerId) {
      await interaction.reply({
        content: 'You are the seller for this listing. Ask another account to test the buyer flow.',
        ephemeral: true,
      });
      return;
    }

    if (!interaction.channel || !interaction.message) {
      await interaction.reply({
        content: 'Could not create thread — message or channel missing.',
        ephemeral: true,
      });
      return;
    }

    const priceField = interaction.message.embeds[0]?.fields?.find((field) => field.name === 'Price');
    const parsedEmbedPrice = Number(String(priceField?.value || '').replace(/[^\d.]/g, ''));
    const existingListing = negotiationState.listings[listingId];
    const askingPrice = existingListing?.askingPrice ?? parsedEmbedPrice;
    const minimumPrice = existingListing?.minimumPrice ?? defaultMinimum(askingPrice);
    const title = interaction.message.embeds[0]?.title || 'Item for sale';
    const listing = recordListing({
      listingId,
      sellerId,
      title,
      askingPrice,
      minimumPrice,
      message: interaction.message,
    });

    if (listing.status === 'accepted') {
      await interaction.reply({
        content: 'A deal has already been agreed for this item.',
        ephemeral: true,
      });
      return;
    }

    const existingNegotiation = listing.negotiations?.[buyerId];
    if (existingNegotiation?.threadId) {
      await interaction.reply({
        content: `You already have a negotiation thread: <#${existingNegotiation.threadId}>`,
        ephemeral: true,
      });
      return;
    }
    if (existingNegotiation?.status === 'creating') {
      await interaction.reply({
        content: 'Your negotiation thread is already being created. Please wait a moment.',
        ephemeral: true,
      });
      return;
    }

    const threadName = `offer-${buyerTag}-${listingId}`.slice(0, 100);
    listing.negotiations[buyerId] = {
      buyerId,
      threadId: null,
      status: 'creating',
      createdAt: new Date().toISOString(),
    };
    saveNegotiationState();
    await interaction.deferReply({ ephemeral: true });

    try {
      const thread = await interaction.channel.threads.create({
        name: threadName,
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: `Buyer ${buyerId} interested in listing ${listingId}`,
      });

      if (listing.status !== 'open') {
        delete listing.negotiations[buyerId];
        saveNegotiationState();
        await thread.setLocked(true, 'A buyer was accepted while this thread was opening').catch(() => {});
        await thread.setArchived(true, 'A buyer was accepted while this thread was opening').catch(() => {});
        await interaction.editReply('Another buyer has just agreed a deal for this item.');
        return;
      }

      await thread.members.add(buyerId);

      if (sellerId !== client.user.id) {
        try {
          await thread.members.add(sellerId);
        } catch (sellerErr) {
          console.error(`Could not add seller ${sellerId} to thread:`, sellerErr.message);
        }
      }

      listing.negotiations[buyerId] = {
        buyerId,
        threadId: thread.id,
        status: 'open',
        createdAt: new Date().toISOString(),
      };
      negotiationState.threads[thread.id] = { listingId, buyerId };
      saveNegotiationState();

      const listingUrl = interaction.message.url;
      const starterPings = sellerId !== client.user.id
        ? `<@${buyerId}> <@${sellerId}>`
        : `<@${buyerId}>`;

      await thread.send(
        `${starterPings}\n\n` +
        `**Listing:** ${listingUrl}\n\n` +
        `I’m the Haggle agent for this listing. Send your offer in pounds (for example, **£20**). ` +
        `I’ll accept it if it meets the seller’s private minimum, or make a counter-offer.\n\n` +
        `Once a deal is agreed, this item will close to every other buyer.`
      );

      await interaction.editReply({
        content: `Thread created: <#${thread.id}>`,
      });
    } catch (err) {
      delete listing.negotiations[buyerId];
      saveNegotiationState();
      console.error('Failed to create private thread:', err);
      if (err.code === 50013 || err.message?.includes('permissions')) {
        await interaction.editReply({
          content: 'Could not create private thread — bot needs **Create Private Threads** permission in this channel.',
        });
      } else {
        await interaction.editReply({
          content: `Failed to create thread: ${err.message || 'unknown error'}`,
        });
      }
    }
    return;
  }

}

client.login(token);
