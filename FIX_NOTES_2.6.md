# Houseplant App 2.6 — Fix Notes

## Bug fixed: "Add Houseplant" → Set Up failed with
`Failed to add Pot option: {"errors":{"variants":["You need to add option values for Size"]}}`

### Cause
When a size-only plant product is set up, the app adds a second "Pot" option to the
Shopify product via a product PUT (Admin REST 2023-10). Shopify requires that when the
options array is redefined, EVERY variant declares a value for EVERY option. The PUT was
sending each variant as `{ id, option2 }` only — it never re-sent `option1` (the Size
value), so Shopify rejected it with "You need to add option values for Size".

This only surfaced against the live Shopify API; the sandbox mock used in earlier testing
did not enforce the option-value rule, so it passed there.

### Fix
`server/routes/products.js` — the add-Pot-option PUT now sends `option1: v.option1` for
every variant alongside `option2`. One-line change; no other behavior affected. The legacy-
conversion PUT was already correct (it builds full variants with option1).

Verified: reproduced the exact 422 with an option-value-enforcing mock, confirmed the fix
returns 200; all server files pass `node --check`; client vite build clean.
