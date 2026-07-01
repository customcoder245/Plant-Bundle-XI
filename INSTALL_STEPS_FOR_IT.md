# Houseplant App 2.5 — install steps (git → Railway)

## New in 2.5
- Settings: 'Sync products from Shopify' button at the top of the page
- Plant Size Rules: built-in defaults (2 inch / 4 inch / 5 gal+) now shown as editable rows
- New settings: Default pot price (the fallback when a size has no price row) and the
  storefront No-Pot text ('Plant will be shipped bare-root' — now editable)

## New in 2.4
- Settings -> Dashboard alerts: four controls — pot alert threshold, plant alert threshold,
  and how many pots / plants the Dashboard panels list before 'View all'
- Dashboard panels renamed: 'Pots - Low stock' / 'Plants - Low stock'; both have View-all

## New in 2.3
- Dashboard: 'Top sellers — last 30 days' card (top 5 with units + revenue, linked to Analytics)
- Analytics 'All houseplants' table: sortable columns (click any header: sold, revenue,
  with-pot %, views, conversion, name)

## New in 2.2
- Dashboard: low-stock pot alert is now a clean list (buttons removed; alert level lives in
  Settings); NEW right-side panel of low-stock PLANTS sorted bestsellers-first (top 5,
  expandable to all, link to Plant Inventory); NEW 30-day revenue-per-day bar chart in the
  Last 30 days card.

## New in 2.1
- Dashboard low-stock alerts: a warning at the top lists every pot variant (color + size)
  below the threshold (default 10; change it in Settings -> Low-stock pot alerts)
- Dashboard 30-day summary: houseplants sold, revenue, page views, top seller, link to Analytics

## What 2.0 was
A major release — treat it as the production candidate. Everything below in one package:
- ONE flow to add plants: Houseplants -> + Add Houseplant -> search the whole store -> Set Up
  (Collections tab removed entirely; old products with junk variants convert automatically)
- Pricing: base price + global pot price per size (+editable No-Pot deduction); per-plant
  manual prices stay frozen when standards change; changing a standard reprices every plant
- Inventory: one plant pool per size (twins mirrored), shared pot pool by color+size,
  webhooks self-register on boot, daily plant sync from Shopify
- Visual Library: search bar, one row per plant w/ 100px photo + "Select gallery images"
  expander; every size x pot color has an Image menu (upload / URL / pick from Shopify)
- Pot Library: "Change image" in each row — photo hosted on Shopify CDN, used as the swatch
- Storefront widget (theme extension): pot photo swatches, X-pot No-Pot card with per-size
  savings, gallery image swap per color, bare-root sizes hide pot UI, view tracking
- NEW Analytics tab: sales/revenue per houseplant, top-10, with-pot %, page views,
  view->sale conversion, "viewed but not selling" list; Activity Log shows ONLY houseplant orders
- App name in Shopify becomes "Houseplant App" when you run shopify app deploy

## What V6 contains (vs what is currently deployed)
- Whole-store product search in Add Houseplant (type 2+ letters, searches ALL store products by name)
- "Configure Houseplant" button (was "Configure Bundle")
- App name "Houseplant App" (applied in step 6)
- Single Houseplants page (+ Add Houseplant) — Bundle Builder/Manual Sync removed from nav
- Editable prices (base + with-pot totals; manual prices frozen from standard changes)
- Auto-conversion of old-style products (Size × Pot Color variants) during setup
- Plant/pot inventories tracked separately per order (deduct + restore on cancel)

## DO NOT uninstall the app from Shopify
Nothing is wrong with the installation — only the deployed code is old. Uninstalling gains
nothing and risks re-auth issues. This is a code redeploy only. The database is external
(Neon Postgres) and migrates itself on boot — no DB steps, no data loss.

## V16 addition: simplified navigation + image management
- Collections tab REMOVED (Doug's request): houseplants are added one at a time from the
  Houseplants tab via store-wide search. No collection syncing needed at all.
- Visual Library overhauled: sticky search bar, one row per plant, expand to every
  size x pot color with three image options per row (Upload file / paste URL / pick from
  images already in Shopify).
- Pot Library: "Change image" button in each row — the photo becomes the storefront swatch.

## V16 addition (earlier): pot image editing + Visual Library rows
Pot Library -> Edit on any color: upload a pot photo directly (hosted on Shopify Files/CDN)
or paste a URL. That thumbnail is BOTH the Pot Library image and the swatch customers click
on product pages. Existing pot images keep working untouched.

## V16 addition: Visual Library checklist grid
Visual Library now lists, per plant, ONE ROW for every size x pot color combination with an
Upload/Replace button right in the row — no dropdowns needed. Green-bordered thumbnail =
customers see that image when picking that pot on that size. Also fixed: the Target Plant Size dropdown
previously offered hardcoded Small/Medium/Large — now it lists the product's actual sizes
(plus "All sizes"), so composites match the storefront correctly.

## V15 addition: gallery image swap per pot color
Clicking a pot swatch changes the main product photo to the composite for that pot color
(+ plant size). Assign composites in the app: Visual Library -> pick plant -> New Composite
(pot style + plant size + image). If clicking a color does NOT change the photo on your theme
(page-builder pages), set "Gallery image selector" in the Pot Selector block settings to the
CSS selector of the main product image (browser dev tools -> right-click photo -> Inspect).

## V14 addition: pot photo thumbnails in the storefront widget
Swatches now show the pot PHOTO from Pot Library when one is uploaded (image_url on the pot
color), falling back to the flat color square. Add photos in Pot Library for the best look.
REMINDER — the widget appears ONLY after: shopify app deploy + adding the "Pot Selector"
block to the product template in the theme editor (V10 steps below). Without those steps the
theme shows raw variants (size/color/with-without buttons), which looks broken.

## V13 addition: No-Pot deduction separate from pot markup
Each pot size now has TWO numbers in Settings: what the pot ADDS to the base price, and what
"No Pot" SAVES off the with-pot price (blank = full pot price). Example: 6" adds $15 but
No Pot only saves $10 → $19.25 plant sells $34.25 with pot / $24.25 without. Changing either
number reprices every configured product automatically; manual per-plant prices stay frozen.

## V11 addition: automatic daily plant sync
Plant stock edited directly in Shopify is pulled into the app automatically every 24h
(env PLANT_SYNC_INTERVAL_HOURS to change; 0 disables). The pull is twin-aware: one plant
pool per size — it takes the freshest count and re-aligns both Shopify variants to it.
Manual "Sync Plants from Shopify" button still syncs ALL plants at once on demand.

## V10 addition — CRITICAL: storefront widget was never installable before
The pot-color widget was missing its Shopify extension packaging (no schema/toml), so it could
NOT be deployed or added to the theme — this is why app-created products show no pot swatches.
V10 packages it properly (extensions/pot-selector). After deploying V10:
1. Run:  shopify app deploy   (from the repo folder — this uploads the extension)
2. Shopify admin → Online Store → Themes → Customize
3. Open a PRODUCT template → Add block (in the product information section) →
   under Apps pick "Pot Selector" → place it under the variant picker
4. In the block settings, confirm "App server URL" = your Railway URL → Save
5. Open the app-created product page: pot color swatches + No Pot option appear,
   and the theme's raw "With Pot / Without Pot" buttons hide automatically.
NOTE: the old extensions/theme-extension folder is removed in V10 — do step 2 in the repo
(delete everything except .git) exactly as below so the stale copy disappears.

## V9 addition: bulk collection setup
Collections page: every collection row has a "Set up all plants" button — runs the one-click
setup on every product in that collection with live progress and per-product results.

## V7/V8 additions: order webhooks fix (why test orders did not deduct inventory)
The app only deducts plant/pot stock when Shopify sends it order webhooks. They were never
registered against the live server. V7 registers them AUTOMATICALLY on every server start.
Requirement: the server must know its own public URL — on Railway this is automatic via
RAILWAY_PUBLIC_DOMAIN; otherwise set env var APP_URL=https://<your-app-domain>.
Verify after deploy: app Settings → "Order webhooks" card shows OK for orders/create,
orders/cancelled, orders/refunded (button there re-registers on demand).
V8 also adds: visible red error banner next to the Set Up button if setup fails (plus the
failure is written to the Activity Log), a progress banner while it runs (5-20s), and a
success screen with "View live product page" / "Open in Shopify admin" buttons.
Then re-run the test order THROUGH THE PRODUCT PAGE (pick a pot color) — Activity Log will
show the deduction, and Pot/Plant Inventory will drop. Cancelling restores both.

## Steps
1. Unzip HOUSEPLANT_APP_2.5.zip into an empty folder.
2. In your git repo working copy: delete EVERYTHING except the `.git` folder.
   (This guarantees no old files linger — the old PotConfigurator etc. must go.)
3. Copy the unzipped V6 contents into the repo root.
4. Commit and push:
   git add -A
   git commit -m "Houseplant App 2.5"
   git push
5. Railway redeploys automatically from the push (Nixpacks runs `npm run build` which
   builds the React client into client/dist, then `npm start`).
   Env vars unchanged: DATABASE_URL, SHOPIFY_STORE_DOMAIN, ADMIN_API.
6. From the repo folder run:  shopify app deploy
   This pushes the storefront theme extension AND the app name "Houseplant App"
   (fixes the old "Bot Bundle App" label in Shopify admin).
   Alternative if CLI is unavailable: rename the app in the Shopify Partner Dashboard.
7. In Shopify admin, close and reopen the app (or hard-refresh, Ctrl+Shift+R).

## Smoke test (60 seconds)
1. Left menu shows: Dashboard, Houseplants, Collections, Pot Library, Pot Inventory,
   Plant Inventory, Visual Library, Activity Log, Settings. (No "Bundle Builder".)
2. Houseplants → + Add Houseplant → the search box must have a grey hint line under it.
   NO hint line = old build still being served (check the push/deploy).
3. Type "black" → real store products appear (e.g. Black Rose - Aeonium arboreum zwartkop).
4. Pick one → one row per size with editable Base price and Price with pot → Set Up Bundle.
5. Settings shows "Pot prices — one set of pots" with 4"/6"/1 gal/2 gal/3 gal defaults.
