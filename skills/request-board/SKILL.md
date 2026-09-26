---
name: Request board
description: >-
  Use when running Haggle’s own wanted/request board — post needs, list open
  requests, and match a seller’s item to inbound demand (local/peer,
  agent-queryable).
---
# Request board

Own the **demand feed**: people (or agents) post what they need; sellers match inventory to open requests. Complements Demand radar (which only scans *external* wanted posts).

## Purpose

A thin, agent-queryable board for local/peer needs — no full marketplace inventory browser required for v1.

## Data

Store requests as JSON lines at `/workspace/haggle/request-board.jsonl` (create folder if needed). Each line:

```json
{"id":"req-…","created_at":"ISO-8601","buyer_label":"anon or name","location":"London N1","need":"light wash denim shorts UK 10","budget_gbp":25,"deadline":"this weekend","status":"open","notes":""}
```

Statuses: `open` | `matched` | `closed` | `expired`

## Tools (conceptual / chat actions)

1. **post_request** — capture need, location, budget, deadline; append JSONL; return id.
2. **list_open_requests** — filter by location keyword / category tokens; show newest first.
3. **match_inventory** — given a seller item summary, score open requests (same Strong/Maybe/Skip as Demand radar).
4. **close_request** — mark matched/closed when user confirms.

For hackathon demos, seed 5–10 realistic open requests so `list_open_requests` feels alive.

## Flow

1. Buyer side: interview a short need → `post_request` → confirm card.
2. Seller side: item in hand → `match_inventory` against board → outreach draft (send only if asked).
3. On match + sale → hand off to fee-cut (2%).

## Rules

- Do not invent buyer identities or budgets
- Default location bias from user (e.g. London)
- No payment on the board itself unless explicitly building checkout
- Keep posts PG and policy-safe

## Style

Short board listings. Clear ids. One next action: reply draft, mark matched, or post a need.
