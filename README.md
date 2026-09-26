# Haggle Discord Bot (demo)

Minimal Discord.js v14 bot for the Haggle resale/marketplace helper.

## Features

| Command | Description |
|---------|-------------|
| `/marketplace-setup` | Posts + pins channel instructions (`#marketplace`, `#wanted`, `#deals`). Optional channel mentions. |
| `/sell` | BST listing embed with **I'm interested** / **Sold** buttons. Always posts to the **marketplace** channel (optional `for_sale_channel` override). Replies with a link. |
| `/wanted` | Wanted request embed → **wanted** channel (or marketplace fallback). |
| `/haggle` | Draft counter-offer from simple % rules. |
| `/fee` | Preview 2% fee + seller net. |
| `/mark-sold` | Record a sale and append to `../fee-ledger.csv`. |

**Sold button** (demo): anyone can mark sold; updates embed, computes 2% fee, appends ledger.

## Skills

Agent skills for Haggle's full resale workflow — from photo to listing to negotiation. See [`skills/`](./skills/) for the complete index.

**⭐ [Sell helper](./skills/sell-helper/SKILL.md)** — the main listing interview skill: turn a photo into a ready-to-post Vinted/Depop listing with interview, photo coaching, comps research, draft copy, and browser-based publish with sign-in/2FA support.

Other skills: [Getting started](./skills/getting-started/SKILL.md) • [Negotiate offers](./skills/negotiate-offers/SKILL.md) • [Fee cut](./skills/fee-cut/SKILL.md) • [Demand radar](./skills/demand-radar/SKILL.md) • [Request board](./skills/request-board/SKILL.md)

### Single marketplace channel

All for-sale listings (from `/sell`, **Confirm post** after a chat draft, and the DM draft flow) go to **one** marketplace channel in the HAGGLE AI guild (`GUILD_ID`).

**Resolution order for marketplace:**

1. `MARKETPLACE_CHANNEL_ID` env (if set and valid)
2. Cached id from a previous resolve in this process
3. Channel name match (case-insensitive; leading `#` ignored), **preferring exact `marketplace`**, then `for-sale`, `for_sale`
4. If still missing: create `#marketplace` when the bot has **Manage Channels**; otherwise tell the user to create it / set the env var

**Wanted posts** (`/wanted` or `wanted: …`):

1. `WANTED_CHANNEL_ID` env
2. Cached id
3. Channel named `wanted`
4. Else the marketplace channel (same create-if-missing behaviour)

After posting, the bot replies in the triggering channel/DM with a link to the posted message.

### Message-based listing (no slash command)

Requires **Message Content Intent** (see Setup below).

| Trigger | Behaviour |
|---------|-----------|
| Image attachment(s) and/or text with selling intent (`selling`, `sell`, `wts`, `for sale`, `listing`) | Starts an in-memory draft per user; bot asks for missing **size**, **condition**, **price** (or say **suggest** → £22 demo default). Caption is parsed loosely for `£22` / `22 quid`, size, condition. |
| Guild or DM | When complete: draft preview with **Confirm post** / **Edit price** / **Cancel**. Confirm posts to **#marketplace** (not necessarily the current channel) and replies with a link. |
| `wanted: …` / `looking for …` / `iso …` | Posts a wanted embed to the wanted/marketplace channel. |
| Reply `cancel` during a draft | Clears the session. |

Slash commands keep working as before.

## Setup

1. Create an application at [Discord Developer Portal](https://discord.com/developers/applications) → Bot → Reset Token.
2. **Privileged Gateway Intents** (Bot → Privileged Gateway Intents):
   - Enable **MESSAGE CONTENT INTENT** (required for photo/caption and keyword listing without slash commands).
   - Server Members Intent is not required for this demo.
3. Invite the bot (replace `CLIENT_ID`):

```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=2147560448&scope=bot%20applications.commands
```

Suggested permissions bitmask includes: View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Add Reactions, Manage Messages (for pin), Manage Channels (optional — auto-create `#marketplace`).

4. Copy env and fill values (never commit real tokens):

```bash
cp .env.example .env
# DISCORD_BOT_TOKEN=...
# CLIENT_ID=...
# GUILD_ID=1553372098943262750   # HAGGLE AI
# MARKETPLACE_CHANNEL_ID=...     # optional; else resolve name "marketplace"
# WANTED_CHANNEL_ID=...          # optional
```

5. Install & register guild commands (fast for demo):

```bash
cd /workspace/haggle/discord-bot
npm install
npm run register
npm start
```

## Run

```bash
npm start          # node index.js
npm run register   # re-register slash commands to GUILD_ID
```

## Fee ledger

Sold button and `/mark-sold` append rows to:

```
/workspace/haggle/fee-ledger.csv
```

Columns: `sale_id,listed_at,item_url,item_title,sale_price_gbp,fee_rate,fee_gbp,seller_net_gbp,status,notes`

## Haggle rules (`/haggle`)

- Offer ≥ 90% of ask → lean accept
- 75–90% → suggest counter at `max(soft_floor, ask×0.85)` or mid
- &lt; 75% → firm / decline draft

## Stack

- Node.js ≥ 18
- discord.js v14
- dotenv
