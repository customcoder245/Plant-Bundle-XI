# Houseplant App — IT Handoff (2026-06-10, v5 final)

## What this is
Shopify app for Planet Desert houseplant bundles: plant products (size variants) + ONE shared pool
of decorative pots (color × size). Pot colors are shown by a storefront widget, not Shopify variants.
Plant and pot inventory are tracked separately and deducted per order via webhooks.

## CLEAN INSTALL / REDEPLOY (git -> Railway) — do this exactly
The deployment runs whatever is in your git repository. Claude's zips do NOT reach it
until their contents are committed. To deploy this zip cleanly:
1. Unzip HOUSEPLANT_APP_FINAL.zip into an empty folder.
2. In your existing repo working copy: delete EVERYTHING except the `.git` folder
   (this guarantees removed/renamed old files do not linger).
3. Copy the unzipped contents into the repo root.
4. `git add -A && git commit -m "Houseplant App final" && git push`
5. Railway redeploys automatically (Nixpacks runs `npm run build` which builds the
   client, then `npm start`). Env vars are unchanged: DATABASE_URL, SHOPIFY_STORE_DOMAIN,
   ADMIN_API. The database migrates itself on boot — no manual DB steps.
6. From the repo folder run `shopify app deploy` — this pushes the theme extension AND
   the app name "Houseplant App" (fixes the old "Bot Bundle App" label in Shopify admin).
7. In Shopify admin, hard-refresh the app (Ctrl+Shift+R inside the app iframe or close/reopen).
8. Smoke test: Houseplants -> + Add Houseplant -> type "black" in search -> the search
   should list store products like "Black Rose - Aeonium arboreum zwartkop".
   If the search box has NO grey hint text under it, the old build is still being served.

## Stack & deploy
- Node/Express backend (`server/`) — deployed on Railway (railway.json included). Start: `node server/index.js`
- React/Polaris admin (`client/`) — Vite. Build: `cd client && npm install && npm run build`
- Postgres (Neon). All tables/columns auto-created/migrated on server boot (server/index.js ensure block + server/db/migrate.js)
- Theme extension: `extensions/theme-extension/pot-selector.liquid` (storefront pot picker)

## Required environment variables
- DATABASE_URL — Postgres connection string
- SHOPIFY_STORE_DOMAIN — e.g. planet-desert.myshopify.com
- ADMIN_API (or SHOPIFY_ACCESS_TOKEN) — Admin API token
- Webhooks to register in Shopify: orders/create and orders/cancelled → /api/webhooks/...

## Pricing model (important)
- Plant product price = BASE price (how it normally ships)
- pot_prices table = one global price per pot size (seeded: 4"=$5, 6"=$15, 1 gal=$15, 2 gal=$20, 3 gal=$25; editable in Settings)
- With-pot price = base + pot price ± per-plant adjust (size_mappings.pot_price_adjust)
- Per-size behavior (sizeRules.js, overridable in Settings/per product):
  2 inch & 5 gal+ = no pot UI · 4 inch (3–5") = pot mandatory, price raised · 6 inch–3 gal = optional With-Pot twin

## Editable prices (final behavior)
In Add Houseplant (and re-running it on an existing product): the Base/No-Pot price and the
"Price with pot" total are both editable. An untouched total = standard formula (base + pot
standard) and FOLLOWS future standard changes. A manually typed total is saved as an override:
frozen, never moved by standard changes, until edited or reset to standard. Base price edits
push to Shopify. The Houseplants -> Edit modal also has a "Manual with-pot price" field per
With-Pot variant (blank = standard).

## Dynamic pot pricing (added after handoff doc v1)
Changing a pot price in Settings AUTOMATICALLY reprices the With-Pot variants of every
configured product in Shopify (e.g. 6" $15 -> $17 updates all 6" houseplants at once).
Manual trigger also available: POST /api/pot-prices/reprice-all.

## App name in Shopify admin
Code/config already say "Houseplant App" (shopify.app.toml name field). If Shopify admin still
shows the old "Pot/Bot Bundle App" label, the Partner Dashboard has the stale name: either run
`shopify app deploy` from this folder (include_config_on_deploy = true pushes the name), or
rename the app manually in the Shopify Partner Dashboard.

## Day-to-day workflow
1. Create plant product in Shopify normally (size variants only, base prices)
2. Bundle Builder → pick it → confirm size→pot mapping (+optional price adjust) → Set Up Bundle
   (creates the Pot option + With-Pot variants in Shopify, prices them, seeds plant inventory)
3. Settings = pot prices + size rules · Product Config = edit/re-price ("Apply pot pricing") · Plant/Pot Inventory = stock

## Verification done before handoff
- Client builds clean (vite, 3199 modules) · all server files pass node --check
- Live smoke test: server booted against in-process Postgres + simulated Shopify; every admin API verified
- Automated suites: setup integration 12/12, order processing (deduct/restore plant+pot, no-pot, twins) 6/6
- NOT yet run against the live store — test on one product first (e.g. the Rosemary test product)

## OLD products are converted automatically
Products created by the old app version (Size x Pot Color x With/Without Pot variants) are
detected during Bundle Builder setup and automatically collapsed to clean size-only variants
(base price = old Without-Pot price, stock = max across colors, SKUs kept), then set up the
new way. No manual Shopify cleanup needed. Verify prices once after converting a product.

## (superseded) Known cleanup for OLD products
Products created by the old app version carry Size×Pot-Color×No-Pot variants. The app refuses them
with a clear error; delete the old Pot Color option in Shopify, then run Bundle Builder setup.

Change history: UPDATE_NOTES_v2.md → v5.md (v5 = current model; v3/v4 notes describe a superseded discount model)
