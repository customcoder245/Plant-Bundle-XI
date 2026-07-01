# Houseplant App — Fix Notes (2026-06-09)

## What was wrong

1. **The version you uploaded had none of the plant-inventory work.**
   The `Plant-Bundle-main.zip` you sent is the *old* pre-feature code. It has no
   Plant Inventory page, no `/plant-inventory` nav item, no `plantInventory` route,
   and no plant-deduction logic. If that is the build you deployed, that is exactly
   why "creating a plant with a pot" doesn't track plant stock and why there is no
   admin screen for it. The completed feature lived only in the local copies on your
   computer, not in that zip.

2. **The "PLANT APP FINAL" copy had a corrupted `package.json`.**
   During the previous delivery the root `package.json` was truncated mid-file
   (cut off inside `devDependencies`, no closing braces). That is invalid JSON, so
   `npm install`, `npm run build`, and `npm start` all fail before the app can run.
   It has been repaired (and this clean build has a correct one).

## What this build is

This is the complete, current app (renamed "houseplant-app") with the full
plant + pot inventory feature: separate `plant_inventory` table, auto-seeding on
product sync, the **Plant Inventory** admin page + nav item, `/api/plant-inventory`
routes, and order webhook logic that deducts (and restores on cancel/refund) the
plant pool and the pot pool independently.

## Verified in a sandbox (real Postgres engine, PGlite)

- All server JS passes `node --check`; both `package.json` files are valid JSON.
- Every client page (incl. `PlantInventory.jsx`) compiles.
- Order simulation, all assertions passing:
  - Order **with a pot** -> plant -1 AND pot -1 (independent pools).
  - **Cancel/restore** -> plant +1 AND pot +1.
  - Order via variant title `6" Pot / White` (Bundle path) -> both deduct.
  - **NO POT / bare-root** order -> plant deducts, pot untouched.

## Deploy

1. `npm install` (root) then `npm install` in `client/` (or `npm run build`).
2. Set env vars (see `.env.example`): `DATABASE_URL`, Shopify keys, `SHOPIFY_STORE_DOMAIN`, `ADMIN_API`.
3. `npm run build` then `npm start`. Migrations auto-run on startup and create `plant_inventory`.
4. In the app: pick collections (Collections page) -> sync products -> open **Plant Inventory**
   and set stock/SKU per size. Re-register webhooks if needed so order events hit this build.

> Important: make sure the build you actually deploy is THIS one. The old
> `Plant-Bundle-main` zip will not have any of the above.
