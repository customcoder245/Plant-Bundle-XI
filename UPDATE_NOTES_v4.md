# Update v4 — 2026-06-10 (One-click bundle setup + size pot rules)

## One-click setup from any existing plant product (Bundle Builder)
Pick a product (e.g. Black Rose Succulent), map sizes, click "Set Up Bundle". The app then does ALL of it:
- Adds the "Pot" option (With Pot / Without Pot) to the Shopify product
- Creates the Without-Pot twin for every pot-eligible size, priced automatically (with-pot price − that size's discount)
- Marks bare-root sizes as single "Without Pot" variants (price untouched)
- Saves config + size→pot mapping, seeds plant inventory from current Shopify stock, mirrors stock to twins
- Success screen shows exactly what was done per size
Endpoint: POST /api/products/:id/setup-bundle (re-runnable; reprices drifted twins, creates missing ones).
Products still carrying old Pot-Color variants are refused with a clear message to clean them first.

## Size pot rules (built-in, global, per-product)
- Built-in defaults: 2 inch plants NEVER come with a pot; 5 gal and larger are bare-root by default.
- Global override per size: Settings → "Pots offered" checkbox next to each discount row.
- Per-product override: Product Config → Edit → per size "Pots for this size": Default / Always offer (e.g. enable 5 gal pots later) / Never.
- Storefront: bare-root sizes show NO pot UI at all (no swatches, no No-Pot checkbox).

## Notes
- 4 inch on your live site sells at the same price with/without pot — add a "4 inch → $0" row in Settings if that should stay true.
- Fixed during testing: bare-root single variants ("2 inch / Without Pot") were being skipped by inventory seeding; now only true twins (with a With-Pot sibling) are skipped.

## Verified
- buildSetupPlan unit tests (Black Rose-style product): pot option, twins, bare-root sizes, legacy rejection — all pass
- Full setup-bundle integration test against mocked Shopify + real (in-process) Postgres: 10/10 PASS
- v3 order-processing regression suite: 6/6 PASS; all syntax/compile checks clean
