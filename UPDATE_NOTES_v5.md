# Update v5 — 2026-06-10 (Plant + pot pricing, the right way around)

## The model (final)
- Plant product price = BASE price (how it normally ships).
- ONE set of pots: each pot size has one standard price (Settings → Pot prices).
  Defaults seeded: 4" +$5 · 6" +$15 · 1 gal +$15 · 2 gal +$20 · 3 gal +$25 (all editable).
- Choosing a pot ADDS that pot size's price. No discounts anywhere.
- Per-plant "Price adjust" (Product Config → Edit, per size) for heavy/large plants: with-pot price = base + pot price ± adjust.

## Per-size behavior (built-in defaults, overridable in Settings + per product)
- 2 inch & 5 gal+: no pot UI at all, price untouched.
- 4 inch (3–5"): pot ALWAYS included — setup marks the single variant "With Pot" and raises its price by the pot price (e.g. $14.99 → $19.99). No bare-root choice; storefront pre-selects the first in-stock color.
- 6 inch – 3 gal: pot optional — base variant stays at base price ("Without Pot"), a "With Pot" twin is created at base + pot price ± adjust. No-Pot checkbox shows "SAVE $X" where X is the pot upcharge.

## What changed
- New `pot_prices` table + /api/pot-prices + Settings "Pot prices" card (warns about inventory pot sizes missing a price; $10 fallback).
- Settings "Plant size rules" card: per-size rule = Optional / Always included / No pots.
- `size_mappings.pot_price_adjust` column; editable in Product Config → Edit; survives setup re-runs.
- Bundle Builder one-click setup + "Apply pot pricing" button both compute from base + pot price ± adjust.
- Widget: per-size modes from the API; mandatory-pot sizes hide the No-Pot checkbox and auto-select a color; SAVE label shows the real upcharge.
- Stock pull is per size group (max), so the plant pool is correct whichever twin holds the count.

## Verified
- Planner unit tests 7/7 (incl. 4-inch price bump and 3-gal +adjust)
- Setup integration vs mocked Shopify + in-process Postgres: 12/12 PASS
- Order-processing regression: 6/6 PASS · all syntax/compile checks clean
