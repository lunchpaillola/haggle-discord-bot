# Haggle Skills

Agent skills for Haggle — the resale helper that interviews items, coaches photos, researches comps, drafts listings, negotiates offers, and tracks a 2% fee ledger.

## Available Skills

| Skill | Path | Description |
|-------|------|-------------|
| **Sell helper** ⭐ | [`sell-helper/`](./sell-helper/SKILL.md) | **Main listing interview skill** — turn a photo into a ready-to-post listing on Vinted/Depop. Interview, photo coach, comps research, draft copy, then browser-based draft and publish with sign-in/2FA support. |
| Getting started | [`getting-started/`](./getting-started/SKILL.md) | First-time onboarding — setup questions for resale workflow, marketplace preferences, reply monitoring, negotiation floors, and 2% fee tracking. |
| Negotiate offers | [`negotiate-offers/`](./negotiate-offers/SKILL.md) | Respond to buyer messages and offers on listings. Set floor rules, draft counters/accepts/declines, and send on-platform when requested. |
| Fee cut | [`fee-cut/`](./fee-cut/SKILL.md) | Track Haggle's 2% cut on resales — log listed/sold rows to the fee ledger and summarize fee vs seller net. |
| Demand radar | [`demand-radar/`](./demand-radar/SKILL.md) | Match a seller's item to nearby "wanted / ISO / looking for" demand — scan public wanted posts, score fits, and suggest outreach. |
| Request board | [`request-board/`](./request-board/SKILL.md) | Run Haggle's own wanted/request board — post needs, list open requests, and match seller inventory to inbound demand. |

## Notes

- **Sell helper** is the core workflow — photo to draft to negotiate.
- The Discord multi-offer board is not a separate skill yet; closest match is **Negotiate offers** for handling buyer interactions.
- All skills assume paste-ready drafts when marketplace auth is brittle; browser posting only with explicit user request.

## Usage

Each skill lives in its own folder with a `SKILL.md` file that includes:
- Agent trigger conditions (when to use the skill)
- Interview questions and workflow phases
- Platform-specific rules (Vinted, Depop, etc.)
- Auth and 2FA handling patterns
- Output format and hand-off to next layers

Point agents at the skill path when you need specialized behavior beyond the base bot commands.
