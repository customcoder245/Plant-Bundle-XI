# Houseplant App 2.7 — Fix Notes

## 1. (from 2.6) "Add Houseplant" → Set Up no longer fails
Error was: `Failed to add Pot option: {"errors":{"variants":["You need to add option values for Size"]}}`
Cause: when adding the Pot option, the product update re-sent each variant with only its
Pot value, not its Size value — Shopify requires all option values at once.
Fix: `server/routes/products.js` now sends `option1` (Size) for every variant in that call.

## 2. Dead deploy URL fixed in shopify.app.toml
`application_url` and the auth callback pointed at an old, dead dev tunnel
(`teens-teddy-survivor-reply.trycloudflare.com`). With `include_config_on_deploy = true`,
running `shopify app deploy` would have pushed that dead URL to Shopify and could break the
embedded admin. Both are now set to the production Railway URL
(`https://plant-bundle-production.up.railway.app`).

## Validation (sandbox, real code, not mocks of our own code)
- Reproduced the exact 422 on the OLD code with a Shopify mock that enforces Shopify's real
  option-value rule; confirmed 2.6/2.7 returns HTTP 200.
- Full end-to-end run against a live PGlite database + the REAL inventory service:
  1. Add Houseplant bundle (setup-bundle) → HTTP 200, twins created, config + size mappings
     saved, plant inventory seeded (one pool per size).
  2. Purchase 2x "6\" With Pot / Teal" → plant pool 10→8 AND pot pool (Teal, 6") 8→6
     — deducted SEPARATELY.
  3. Cancel → both pools restored (10 and 8).
  4. Purchase 1x "6\" No Pot" → plant 10→9, pot pool unchanged.
  All assertions passed.

## Note on pot swatch images
The pot thumbnails are stored in the database (pot_colors.image_url), NOT in the code.
Deploying a new build does not change existing image rows. To change the swatch icons,
either set them in the app (Pot Library → Change image / Edit → image URL), or provide the
icon image URLs and they can be applied with a one-time data update on deploy.
