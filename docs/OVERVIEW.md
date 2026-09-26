# Haggle Discord Bot — Agent Takeover Overview

This document is for a **successor agent** (or human) picking up the Haggle Discord marketplace demo. It covers product intent, architecture, Discord setup, runtime ops, UX flows, related Grok Bot skills, known footguns, and a safe handoff checklist.

Repo: https://github.com/lunchpaillola/haggle-discord-bot

---

## 1. What Haggle is

**Haggle** is a commerce-hackathon product: a texty sell-helper for secondhand / move-out goods. Core story:

1. Interview item + photo coach  
2. Comps / price band  
3. Draft listing  
4. Post (marketplace or Discord)  
5. Negotiate offers with floor rules  
6. Track a **2% fee** on sale (ledger; charging optional later)

This repository is the **Discord surface**: turn a community server into a lightweight BST marketplace where agents (and people) list via chat or slash commands, haggle with drafts, and record fees.

It is **not** Vinted/Depop itself. Peer apps banned browser automation in the original demo; Discord was chosen because bots are first-class.

### Demo server (as of first publish)

| Field | Value |
|-------|--------|
| Server name | HAGGLE AI |
| Invite (may expire) | `https://discord.gg/nNERqdvHH` |
| Guild ID | `1553372098943262750` |
| Marketplace channel | **`#marketplace`** (exact name preferred) |
| Bot username (example) | `haggle#5277` |
| Application / Client ID (example) | `1553375297682808883` |

Treat tokens as secrets. Rotate if this doc leaked a live token (it should not contain any).

---

## 2. Product decisions already made

- **Slash commands** for reliable demos; **message/photo flow** for WhatsApp-feel UX.  
- **All listings post to `#marketplace`**, not “wherever you typed.” Trigger channel gets a reply with a jump link.  
- **DM drafts allowed**; confirm still posts into the guild marketplace channel.  
- **Wanted** posts go to `#wanted` if present, else marketplace.  
- **Negotiate** is draft-first (`/haggle`); do not auto-DM buyers as the bot unless product expands.  
- **Fee** is 2% of final sale price; ledger CSV; no card charging in this repo.  
- **I'm interested button** creates a private thread under the listing for buyer-seller discussion. Prefers private threads; falls back to public if permissions are insufficient.
- **Mark sold** via `/mark-sold` command only. No Sold button on listings to prevent accidental or unauthorized marking.  
- Related Grok Bot skills (separate from this repo, usually on the operator’s bot): Sell helper, Negotiate offers, Fee cut, Demand radar, Request board. Discord bot is the community marketplace wedge.

---

## 3. Repository layout

```
haggle-discord-bot/
  index.js              # Gateway client, slash handlers, message drafts, buttons
  register-commands.js  # Guild slash command registration (PUT)
  package.json
  package-lock.json
  .env.example          # Template only — never commit .env
  .gitignore            # node_modules, .env
  README.md             # Quick start
  docs/
    OVERVIEW.md         # This file — agent takeover
```

Fee ledger path used by the bot: `../fee-ledger.csv` relative to the process cwd when started from the bot folder (i.e. sibling of the bot directory). Adjust if you deploy elsewhere.

---

## 4. Stack and runtime model

- **Node.js ≥ 18**  
- **discord.js v14** + **dotenv**  
- **No HTTP server / ngrok required.** The bot keeps a long-lived **Gateway WebSocket** to Discord. Interactions and messages arrive on that connection.  
- Process must stay running (`node index.js` / `npm start`). If the host sleeps or the process dies, slash commands stop responding.

Optional env:

| Variable | Purpose |
|----------|---------|
| `DISCORD_BOT_TOKEN` | Bot token (required) |
| `CLIENT_ID` | Application ID (required for register) |
| `GUILD_ID` | Server for fast guild command sync |
| `MARKETPLACE_CHANNEL_ID` | Pin listings to a snowflake (optional) |
| `WANTED_CHANNEL_ID` | Pin wanted posts (optional) |
| `ENABLE_MESSAGE_CONTENT` | Set `0` to omit Message Content intent (slash-only). Default: intent on if portal allows. |
| `DISCORD_PUBLIC_KEY` | Not required for gateway slash bots; used for HTTP interactions only |

---

## 5. Discord Developer Portal checklist

Another agent setting this up from scratch:

1. https://discord.com/developers/applications → **New Application** (e.g. Haggle).  
2. **Bot** → Add Bot → **Reset Token** → copy into `.env` as `DISCORD_BOT_TOKEN` (secure storage; never chat paste if avoidable).  
3. **Privileged Gateway Intents** → enable **MESSAGE CONTENT INTENT** (required for photo/caption sell flow). Without it the process crashes with `Used disallowed intents` if the code requests that intent.  
4. Copy **Application ID** → `CLIENT_ID`.  
5. In Discord client: User Settings → Advanced → **Developer Mode** → right-click server → **Copy Server ID** → `GUILD_ID`.  
6. Invite (admin / Manage Server required on the target guild):

```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=2147560448&scope=bot%20applications.commands
```

Permission intent of that bitfield (approx): View Channel, Send Messages, Embed Links, Attach Files, Read Message History, Add Reactions, Manage Messages (pin), Manage Channels (optional auto-create `#marketplace`).

7. Ensure `#marketplace` exists (exact name) or grant Manage Channels so the bot can create it.  
8. Channel perms: bot role needs View + Send + Embed + Attach + Read History in `#marketplace` (and private channels if used).

---

## 6. Install, register, run

```bash
git clone https://github.com/lunchpaillola/haggle-discord-bot.git
cd haggle-discord-bot
cp .env.example .env
# fill DISCORD_BOT_TOKEN, CLIENT_ID, GUILD_ID
npm install
npm run register   # guild slash commands — fails with Missing Access if bot not in guild
npm start          # keep process alive
```

**Register failures**

- `50001 Missing Access` → bot not in the guild yet, or wrong `GUILD_ID`. Invite first.  
- Commands missing in UI → wait a minute; re-run `npm run register`; confirm scope includes `applications.commands`.

**Runtime failures**

- `Used disallowed intents` → enable Message Content Intent in portal, or set `ENABLE_MESSAGE_CONTENT=0` and use slash only.  
- Silent message flow → Message Content Intent off or bot cannot read the channel.

---

## 7. Channel resolution (critical)

### Marketplace (`ensureMarketplaceChannel`)

1. `MARKETPLACE_CHANNEL_ID` if set and fetchable  
2. In-process cache  
3. Name match (case-insensitive, strip `#`): **`marketplace`** → `for-sale` → `for_sale`  
4. Create `#marketplace` if Manage Channels; else error asking user to create / set env  

### Wanted (`ensureWantedChannel`)

1. `WANTED_CHANNEL_ID`  
2. Cache  
3. Name `wanted`  
4. Else marketplace (same create path)

**Do not** change the preferred name away from `marketplace` without updating this doc and the demo server.

---

## 8. UX flows (what users should experience)

### A. Chat-native sell (preferred demo)

1. In any readable guild channel (or DM), send **photo** + text e.g. `selling these, london`.  
2. Bot asks missing: size → condition → price (`suggest` → £22 demo default).  
3. Preview buttons: **Confirm post** | **Edit price** | **Cancel**.  
4. Confirm → embed in **`#marketplace`**; reply with link in the trigger channel/DM.  
5. Button on listing: **I'm interested** — creates a private thread under the listing where buyer and seller can discuss the offer, meetup, and questions. Use `/mark-sold` to record completed sales.

### B. Wanted

Message: `looking for …` / `wanted: …` / `iso …` → wanted embed in wanted/marketplace channel.

### C. Slash

| Command | Role |
|---------|------|
| `/marketplace-setup` | Pin/explain room layout |
| `/sell` | Structured listing → marketplace |
| `/wanted` | Structured wanted |
| `/haggle` | Offer % rules → draft reply text |
| `/fee` | 2% preview |
| `/mark-sold` | Ledger without button |

### D. Haggle rules (defaults)

- Offer ≥ 90% of ask → lean accept  
- 75–90% → suggest counter (~mid / soft floor)  
- &lt; 75% → firm / decline toward soft floor  

Mirror the Grok Bot **Negotiate offers** skill when changing policy.

---

## 9. Code map (`index.js`)

Successor agents should read `index.js` top-to-bottom. Expect roughly:

- Client construction with intents: Guilds, GuildMessages, DirectMessages, optional MessageContent  
- Partials for DM Channel/Message  
- `draftSessions` Map keyed by user id (in-memory — **lost on restart**)  
- Slash command handlers  
- Button interaction handlers (confirm / edit / cancel / interested / sold)  
- `messageCreate` for sell keywords, attachments, wanted prefixes, draft replies  
- Helpers: build sell embed, append ledger, resolve marketplace/wanted channels  

`register-commands.js` defines the slash command schemas and PUTs them to the guild.

---

## 10. Related system outside this repo

On the operator’s Grok Bot (Haggle persona), typical companions:

| Skill / artifact | Purpose |
|------------------|---------|
| Sell helper | Interview, photo coach, comps, Vinted/Depop draft/publish (browser; auth-fragile) |
| Negotiate offers | Floor rules + draft replies; send only on explicit ask |
| Fee cut | 2% ledger CSV |
| Demand radar | Match inventory to public wanted/ISO posts |
| Request board | Owned wanted JSONL board |
| Routine: listing replies | Weekday half-hour inbox check (quiet if empty) |

Discord bot can stand alone for the **community marketplace** pitch even if Vinted posting is abandoned.

---

## 11. Security and trust (adversarial notes)

Discord BST reality: vouch bots, ticket bots, middleman impersonation scams, PayPal F&amp;F pressure. This demo bot:

- Does **not** hold escrow or payment  
- Should **not** auto-message strangers across servers  
- Should not advise Friends &amp; Family for commercial goods  
- Should verify official middlemen by User ID if you add MM features later  

Before production: rate limits, logging, thread moderation tools, and clear ToS for the host server.

---

## 12. Handoff checklist for the next agent

- [ ] Clone repo; confirm `.env` not in git history  
- [ ] Portal: Message Content Intent on  
- [ ] Bot invited to target guild; `#marketplace` exists  
- [ ] `npm run register` succeeds  
- [ ] `npm start` shows logged-in username  
- [ ] Smoke: photo + `selling these` → Confirm → appears in `#marketplace`  
- [ ] Smoke: `/haggle` and `/fee`  
- [ ] Smoke: `/mark-sold` → ledger line written where expected  
- [ ] Smoke: "I'm interested" button → creates thread under listing with buyer + seller pinged  
- [ ] Update this doc if channel names, guild, or fee rate change  

---

## 13. Pitch lines (for demos)

- “Haggle lists and negotiates; when it sells, we take 2% — here’s the ledger.”  
- “Platforms ban browser agents; Discord lets communities run a marketplace with a bot.”  
- “Photo in, listing in `#marketplace`, counter draft, fee out.”

---

## 14. Changelog seed

| Date | Change |
|------|--------|
| 2026-09-26 | Initial public repo: slash + chat listing, `#marketplace` routing, fee helpers, this overview |
| 2026-09-26 | Updated marketplace UX: **I'm interested** button creates private threads under listings (fallback to public); removed **Sold** button from listings (use `/mark-sold` instead) |

When you change behavior, append a dated row here so the next agent does not rediscover footguns.
