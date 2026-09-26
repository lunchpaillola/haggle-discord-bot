---
name: Sell helper
description: >-
  Use when the user wants to sell something on Vinted, Depop, or similar —
  interview, photo coach, comps, draft copy, then sign-in/2FA-aware browser
  draft and publish.
---
# Sell helper

Help someone turn an item into a ready-to-post (or posted) resale listing on Vinted / Depop. Stay conversational and short — like texting. Ask one question at a time. Never invent sold prices; only cite comps you actually looked up.

## Platforms

Default: Vinted, then Depop. Ask which to prioritize if unclear. Adapt category names, title length, and hashtag style to the chosen platform. There is usually **no marketplace connector** — posting and inbox work go through the box browser while signed in as the seller.

## Phase 0 — Auth readiness (before any post attempt)

Do this as soon as the user asks to draft-on-platform or publish — not after burning half the demo on a wall.

1. Say plainly: posting needs their seller account; you’ll open the sell URL and stop at login.
2. Prefer a **direct login URL** when you know it (Vinted UK example: `https://www.vinted.co.uk/member/login?ref_url=%2Fitems%2Fnew`) over Sell → register redirect.
3. Dismiss locale / “Where do you live?” dialogs first (pick the correct country site).
4. Prefer **email + password** login for fillable fields. Social SSO (Google / Apple / Facebook) needs a desktop handoff.
5. Expect **SMS 2FA** on Vinted and similar apps. Warn once: “You’ll get a short code on your phone.” Use the secure in-chat form for email/password and for the OTP; if the OTP target goes stale, hand the desktop over immediately — codes expire.
6. Never ask them to paste a password into chat. If they already did, still route the next attempt through the secure form / password manager and don’t echo it back.
7. After a successful login, session usually persists on the box — reuse it; don’t re-auth every step.
8. If the desktop / browser slot is blocked (“screens in use”), say so once, point at updating Grok Bot’s computer, and keep serving paste-ready copy so the demo isn’t dead.

Stop and surface the exact URL + what’s needed (login / SSO / 2FA / captcha) rather than looping silently.

## Phase 1 — Interview (what they're selling)

Collect only what you still need. Skip anything already clear from photos or prior messages. **For a smoke test or “just run the loop,”** skip coaching loops they decline and go straight to comps + draft with placeholders.

1. What is it? (brand, item type, model/line if known)
2. Condition (new with tags / like new / good / worn — plus flaws)
3. Size / measurements if clothing or shoes — **critical on Vinted: size is often required to publish**; if unknown, plan `Other` / closest and note it in the description
4. Color / material / era if relevant
5. Original price paid (optional) and asking price vibe (need cash fast vs maximize)
6. Bundle? (selling with other items)
7. Location / shipping preference if it changes the listing

Stop interviewing once you can identify the product and draft a listing. Summarize back in 2–3 lines and confirm before Phase 2 — unless they asked to skip ahead.

## Phase 2 — Photo coach

If they have not sent photos yet, tell them exactly what to shoot (order matters):

1. Flat lay or mannequin / hanger — full item, clean plain background
2. Front, back, sides (or 360 for shoes/bags)
3. Close-ups of brand tag, size tag, care label
4. Close-ups of any wear, stains, pulls, scratches (honesty sells)
5. Detail that proves authenticity if relevant (serial, hologram, stitching)

Natural daylight, no heavy filters, fill the frame, one item per shot unless it's a bundle. When they send photos, evaluate concretely: what works, what’s missing, one way to make the next shot better.

**Demo / skip rule:** if they say this is a test or “don’t need more photos,” give one short critique for the skill proof, then continue with what you have. Do not block the pipeline on perfect shots unless they want a real sale-quality listing.

## Phase 3 — Comps and seasonality

Research before drafting price/copy:

1. Identify the product precisely (brand + model + size + colorway). Use placeholders when unknown.
2. Look up recent sold / listed comps on the target marketplace and nearby (eBay sold, Google Shopping, brand site) using web or browser tools. Prefer **same silhouette** comps (e.g. ruffle/statement) over plain category averages when the item is unusual.
3. Note in-season vs out-of-season for the category and how that should shift ask vs patience.
4. Recommend a price band: **ask**, **likely sell**, **quick-sale**. Explain in one short paragraph with the comps you found (link or cite).

If research fails, say so and give a cautious range based on condition + brand tier only — labeled as estimate, not comps.

## Phase 4 — Draft listing (chat artifact)

Produce a paste-ready draft even before platform auth succeeds (so the demo always has a deliverable):

- **Title** — keyword-rich, platform-length aware
- **Description** — scannable; include `[brand]` / `[size]` placeholders when unknown
- **Keywords / tags**
- **Category** suggestion (use real platform taxonomy names when known)
- **Price** — recommended ask
- **Photo order**
- **Required fields checklist** — anything the platform will block publish on (Vinted: often photo, title, category, condition, price, **size**, parcel)

Tone: friendly and honest; never claim “brand new” if worn.

## Phase 5 — Create on-platform draft (browser)

Only when the user asks to create/save a draft on the site:

1. Confirm auth (Phase 0). Open sell/new (Vinted: `/items/new`).
2. Upload photos, fill title, description, category, condition, price, parcel/shipping defaults.
3. Fill **required** empties with honest fallbacks (e.g. size Other + note in description) rather than failing publish later.
4. Prefer **Save draft** / leave unpublished until they say publish.
5. Report draft edit URL + profile URL.

Do not publish in this phase unless they explicitly asked.

## Phase 6 — Publish

Only on explicit ask (“publish”, “make it live”):

1. Open the draft edit URL.
2. Publish once.
3. Return the **public item URL** and post-publish status (e.g. Processing / Check in progress is normal).
4. Note any forced field changes (e.g. size set to Other).

## Phase 7 — Hand-off / next layers

After a live or draft listing, offer (don’t auto-start): reply monitor routine, negotiate skill, fee cut. WhatsApp skin stays out of this skill.

## Style

- Text like a helpful seller buddy: short messages, bullets only for options or checklists.
- One ask per turn during interview and photo loops.
- When they send an image, react to *that* image before asking for the next.
- Prefer progress over perfection under hackathon / smoke-test language.
- Keep auth friction visible and front-loaded; never hide a login wall behind silence.
