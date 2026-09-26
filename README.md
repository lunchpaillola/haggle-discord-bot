# Haggle Discord Bot (demo)

Minimal Discord.js v14 bot for the Haggle resale/marketplace helper.

## Features

| Command | Description |
|---------|-------------|
| `/marketplace-setup` | Posts + pins channel instructions (`#marketplace`, `#wanted`, `#deals`). Optional channel mentions. |
| `/sell` | BST listing embed with **I'm interested** and a private `minimum_accept_gbp`. Always posts to the **marketplace** channel (optional `for_sale_channel` override). |
| `/wanted` | Wanted request embed → **wanted** channel (or marketplace fallback). |
| `/haggle` | Draft counter-offer from simple % rules. |
| `/fee` | Preview 2% fee + seller net. |
| `/mark-sold` | Record a sale and append to `../fee-ledger.csv`. |

**I'm interested button**: creates a private thread for that buyer, the seller, and the Haggle agent. Each buyer gets a separate thread named `offer-<buyer>-<listingId>`.

Inside the thread, the buyer can write `£20`, `20 quid`, `I can offer £20`, or similar. The agent counters offers below the seller's private minimum; the buyer can accept that counter with `deal`, `accept`, or `sounds good`. The first qualifying agreement is accepted, the public listing changes to **DEAL AGREED**, and all competing buyer threads are notified and closed. The winning thread stays open for payment and handover arrangements. The minimum defaults to 90% of the asking price when the seller omits it.

When `OPENAI_API_KEY` is configured, the bot uses the OpenAI Responses API to phrase these replies with a playful, booming barnyard-auctioneer personality and recent thread context. Application code still decides every counter and acceptance price. If the API is unavailable, the bot falls back to deterministic replies without interrupting negotiation.

Negotiation state is stored in `data/negotiations.json` (ignored by Git), so restarting one bot process preserves the accepted buyer. This is a single-process demo store; use a transactional database before running multiple bot instances.

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
| Guild or DM | When complete: draft preview with **Confirm post** / **Edit price** / **Cancel**. Confirm posts to **#marketplace** (not necessarily the current channel) and replies with a link. Interested buyers get a private thread to negotiate. |
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
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=360777378896&scope=bot%20applications.commands
```

The permissions bitmask above includes: View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Add Reactions, Manage Messages (for pin), Manage Channels (optional auto-create), Create Private Threads, Send Messages in Threads, and Manage Threads.

For private negotiation threads, also grant the bot:

- Create Private Threads
- Send Messages in Threads
- Manage Threads (needed to add the seller and close competing threads)

4. Copy env and fill values (never commit real tokens):

```bash
cp .env.example .env
# DISCORD_BOT_TOKEN=...
# CLIENT_ID=...
# GUILD_ID=1553372098943262750   # HAGGLE AI
# MARKETPLACE_CHANNEL_ID=...     # optional; else resolve name "marketplace"
# WANTED_CHANNEL_ID=...          # optional
# OPENAI_API_KEY=...              # optional; enables intelligent thread replies
# OPENAI_MODEL=gpt-5-mini         # optional model override
```

5. Install & register guild commands (fast for demo):

```bash
cd /workspace/haggle/discord-bot
npm install
npm run register
npm start
```

## Test negotiation in Discord

Use two Discord accounts: one seller and one buyer. Use a third account if you want to verify that competing conversations close correctly.

1. Rotate any bot token that has been pasted into chat. Put only the new token in the local `.env` file.
2. In the Developer Portal, enable **Message Content Intent**. Confirm the bot has **Create Private Threads**, **Send Messages in Threads**, and **Manage Threads** in `#marketplace`.
3. Register the updated `/sell` command and start the bot:

```bash
npm install
npm test
npm run register
npm start
```

4. As the seller, create a listing such as:

```text
/sell title:Test jacket price_gbp:30 minimum_accept_gbp:25 condition:Good size:M
```

The minimum is private and does not appear in the listing or buyer thread.

5. As buyer A, press **I'm interested**, open the private thread, and send `£20`. The agent should counter at £25.
6. As buyer B, press **I'm interested** and send `I can offer £26`. Buyer B should receive **Deal agreed at £26**.
7. Confirm the public listing says **DEAL AGREED**, its button has disappeared, and buyer A's thread receives a closing message and is archived.
8. Restart the bot and confirm the listing still refuses new buyers. State is retained in `data/negotiations.json`.

If thread creation fails, re-check channel-level permission overrides as well as the bot role. If the bot can create threads but cannot close the losing ones, it is missing **Manage Threads**.

## Run

```bash
npm start          # node index.js
npm run register   # re-register slash commands to GUILD_ID
```

## Fee ledger

`/mark-sold` appends rows to:

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
