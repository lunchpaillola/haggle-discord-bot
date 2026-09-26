---
name: Demand radar
description: >-
  Use when matching a seller’s item to nearby “wanted / ISO / looking for”
  demand — scan public wanted posts, score fits, and suggest outreach (no
  auto-message unless asked).
---
# Demand radar

Match **what the seller has** to **what buyers already asked for** (wanted / ISO / looking for). This is the demand-side partial: discovery without owning a marketplace feed.

## When to run

- User has an item (photo, draft, or short description) and wants buyers who already need it
- Post-move clearance: “who wants this near me?”
- Before or instead of cold-listing on Vinted/Depop

## Inputs

Collect if missing:

1. Item summary (category, brand, size, condition, price band)
2. Location (city / postcode district / “London Zone N”)
3. Urgency (this weekend vs flexible)
4. Channels they allow you to search (default: public web wanted ads; never log into their FB as them unless asked)

## Sources (read-only, public)

Prefer sources you can search without brittle private-group login:

- Gumtree “wanted” / for-sale nearby text queries
- Reddit / forums ISO threads (city + item)
- Public marketplace search for similar sold/wanted language
- User-pasted screenshots or links to wanted posts (highest trust)

Do **not** scrape behind login walls, auto-join groups, or message strangers unless the user explicitly asks to send a specific reply.

## Method

1. Normalize the item into 3–6 search queries (specific → broader), e.g. `ruffle denim shorts`, `denim shorts wanted`, `ISO denim shorts London`.
2. Search allowed sources; open promising hits and extract: who/where, what they want, budget if any, how old the post is, link.
3. Score each hit: **Strong** (same item + local + recent) / **Maybe** (category fit or farther) / **Skip**.
4. Return a short board:

```
Demand radar — {item}
Location bias: {place}

Strong
- {title or quote} — {place} — {age} — {link} — why it fits

Maybe
- …

Outreach drafts (only if Strong ≥ 1)
- Paste-ready reply for hit #1 (friendly, factual, no pressure)

Next: list cold anyway / wait for better demand / add to request board
```

5. Never invent wanted posts. If sources are thin, say so and fall back to comps + “list cold” advice.

## Safety

- Public read only by default
- No auto-DM, no auto-reply on marketplaces
- Redact phone numbers you find unless user needs them to reply
- Label uncertainty when a post might be spam or a seller mis-tagged as wanted

## Hand-off

- Strong match + user wants to sell → reuse sell-helper draft / negotiate floors / fee-cut on sale
- No matches → suggest request board (skill: post a “I have X” or wait for inbound needs) or cold-list on best channel

## Style

Tight board, real links, honest empty results. One clear recommendation at the end.
