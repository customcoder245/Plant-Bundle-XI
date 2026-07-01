# Update v2 — 2026-06-10

## Fixed
1. **Sidebar nav: black label on selected item** — selected item text & icon now white on the green pill (index.css).
2. **Plant Inventory: duplicate-looking rows** — those rows were separate Shopify variants (old Size x Pot Color products) all labeled by size only. The page now shows the FULL variant title and groups everything under ONE entry per plant — click to expand its size variants.
3. **Chopped-off Inventory column** — replaced fixed-width row layout with a responsive grid (page is now fullWidth; movements panel moved below).

## New
4. **Pot-size mapping in Plant Inventory** — each plant size row has a "Pot size shown" dropdown (real pot sizes from your pot inventory). This controls which pot variants the storefront widget shows for that plant size, e.g. 6" plant -> 6" pots, 3 gal -> 10" pots, and handles different labels (1 gal -> 6" pot). Saved via new endpoint `PUT /api/plant-inventory/:id/mapping`.
   - The storefront widget (pot-selector.liquid) already filters pot colors by this mapped size — no theme change needed.

## Reminder for old products
Products created the old way still carry "Pot Color" variants in Shopify (why Rosemary Testing showed 7 near-identical rows with different stock). Recommended cleanup per product in Shopify admin: delete the Pot Color option (collapses to size-only variants), set stock, keep it in a synced collection. New plant products should be plain Shopify products with size variants only — the app adds pot choices on the storefront.

## Verified
- All server JS: node --check OK
- All client JSX: compiles OK (esbuild)
- New/changed SQL tested against in-process Postgres (PGlite): GET with mapped_pot_size, mapping UPDATE + INSERT paths all pass.
