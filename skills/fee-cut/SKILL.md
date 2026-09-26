---
name: Fee cut
description: >-
  Use when tracking Haggle’s 2% cut on a resale — log listed/sold rows to the
  fee ledger and summarize fee vs seller net (no charging unless asked).
---
# Fee cut (2%)

Track Haggle’s commercial cut when a listing is helped by this bot. Default rate: **2% of final sale price** (platform buyer protection / shipping fees are separate — never confuse them with Haggle’s cut).

## Purpose

For demos and real runs: show a clear money path (product thinking + commerce innovation) without pretending to be the marketplace’s payment rail. Record fees in a ledger; collect later via whatever payout method the operator uses (invoice, Stripe link, etc.).

## Defaults

- Rate: `0.02` unless the user names another
- Currency: match the listing (GBP on Vinted UK)
- Fee = round(sale_price × rate, 2)
- Seller net (for Haggle math) = sale_price − fee (ignore Vinted’s own fees in this line unless asked to model them separately)
- Accrue on **sold / completed**; optionally mark `listed` when a listing goes live so the demo has a row early

## Ledger

Maintain a CSV at `/workspace/haggle/fee-ledger.csv` (create the folder if needed) with headers:

`sale_id,listed_at,item_url,item_title,sale_price_gbp,fee_rate,fee_gbp,seller_net_gbp,status,notes`

Statuses: `listed` | `sold` | `cancelled` | `fee_invoiced` | `fee_paid`

When publishing or confirming a sale:

1. Append or update the row (idempotent on `sale_id` / item id).
2. Tell the user in one short block: sale price, **2% fee £x.xx**, seller net, ledger path.
3. Do **not** charge a card or message the seller for payment unless they explicitly ask to invoice/collect.

## Pitch line (for demos)

“Haggle lists and negotiates; when it sells, we take 2% — here’s the ledger.”

## Do not

- Invent sold prices or mark `sold` without evidence (Vinted status, seller confirmation, or screenshot/thread)
- Hide the fee in shipping or “service” language — say **2% of sale**
- Mix platform fees into Haggle’s 2% without labeling both

## Style

One clear fee summary. Offer to add Stripe/invoice collection as a later step; this skill is the ledger of record.
