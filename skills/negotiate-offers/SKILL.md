---
name: Negotiate offers
description: >-
  Use when a Vinted/Depop buyer messages or offers on a listing — set floor
  rules, draft counters/accepts/declines, and only send on-platform when the
  seller explicitly asks.
---
# Negotiate offers

Help a seller respond to buyer messages and offers on Vinted / Depop (and similar). Stay short and texty. Never invent what the buyer said — only use the thread you actually read. Default: **draft the reply for the seller**; do not send on-platform unless they explicitly say to send / reply / accept / decline.

## When this applies

Buyer asked a question, made an offer, requested a bundle, asked for measurements, or the seller wants a negotiation strategy for an open listing. Pair with a monitor routine when watching inbox on a schedule.

## Inputs to gather (skip what you already know)

1. Listing link or item id, ask price, and any floor / quick-sale price
2. What the buyer said or offered (paste or browser read)
3. Seller goal this turn: answer only / counter / accept / decline / stall
4. Hard constraints: min price, no holds, ships from X, flaws already disclosed

If floor is unknown, propose one from the earlier comps band (likely-sell as soft floor, quick-sale as hard floor) and confirm before accepting anything at or below it.

## Policy defaults (override if seller says otherwise)

- Offers ≥ 90% of ask → lean accept (or tiny counter if they want to play)
- Offers 75–90% → counter once toward midpoint of offer and ask
- Offers &lt; 75% → polite decline + firm counter at soft floor, or walk away if below hard floor
- “Lowest?” with no number → don’t fold; ask their budget or state a small discount off ask
- Bundle asks → price the set with a clear combined discount, not stacked secret cuts
- Rude / scammy / off-platform payment → do not engage; draft a short refuse

Always keep disclosed flaws honest. Never promise NWTs / authenticity you can’t support.

## Reply style

Draft 1–2 short message options the seller can paste into Vinted/Depop chat:

- Friendly, specific, one clear next step (accept / counter number / question)
- No walls of text; no emoji spam unless the seller’s voice uses them
- Include the counter price as a number when countering

Label options e.g. **Accept**, **Counter**, **Decline**.

## On-platform send (optional)

Only if they explicitly ask to send:

1. Confirm auth (reuse sell-helper Phase 0 patterns: login, 2FA, secure form — no password in chat).
2. Open the exact conversation in the box browser.
3. Paste the chosen reply; stop before Send unless they said “just send it.”
4. For Accept / Decline offer buttons, confirm the amount on screen matches the plan, then act and report the result.

## Aftercare

Note what was sent or drafted, update the effective ask/floor if the seller moved, and remind that the monitor routine will catch the next reply. Fee / payout tracking is a separate layer — don’t invent a 2% charge here.

## Style

One question at a time when blocked. Prefer a ready draft over more interview. If the inbox can’t be read (auth), say so once and hand off login rather than guessing buyer intent.
