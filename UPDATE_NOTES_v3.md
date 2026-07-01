# Update v3 — 2026-06-10 (No-Pot discounts + Product Config editing)

## The model (as agreed)
- A plant is a plain Shopify product whose variants are SIZES, plus one "Pot" option with two values: **With Pot / Without Pot** (the only extra variants needed — NOT per pot color).
- Pot colors are app swatches filtered by the plant-size → pot-size mapping (6 inch & 1 gal → 6" pot, 3 gal → 10" pot, ...).
- "No Pot" is a single separate checkbox. Clicking it switches to the size's Without-Pot twin (price drops by the discount); clicking any color switches back (price reverts). **Fixed: reverting on color click previously didn't restore the price.**

## New
1. **Global No-Pot discounts by plant size** (Settings page): e.g. 6 inch/1 gal/2 gal → $10, 3 gal → $14. Sizes match loosely ('6"' == '6 inch', '5 Gal.' == '5 gal'). Unlisted sizes default to $10. Table `no_pot_discounts`, routes `/api/no-pot-discounts`.
2. **"Apply No-Pot pricing" button** (Product Config, per product): sets every Without-Pot twin's price = With-Pot sibling price − discount(size) in Shopify automatically.
3. **Storefront widget**: "SAVE $X" label now shows the right amount for the selected plant size; robust matching for With Pot / Without Pot / bare root option values.
4. **Product Config / Manage Bundles**:
   - **Edit button** on every configured product (was view-only) — opens the mapping editor.
   - Size table now groups by PLANT size (was: mapped pot size — the source of "Small: 9 variants" confusion), shows With-Pot price + No-Pot price + mapped pot size per row.
   - Per-product "Bare-Root Discount" field removed from the editor (now global in Settings).

## Twin-variant inventory (one plant pool per size)
- Seeding skips Without-Pot twins and removes stale twin rows — Plant Inventory shows ONE row per size.
- Orders on a twin deduct/restore the SAME plant pool as the With-Pot sibling (verified).
- Plant stock pushed to Shopify is mirrored to the twin, so both show identical availability.
- Bug fixed: a twin ordered without properties was parsed as pot color "Without Pot" (would try to deduct a pot); now recognized as No-Pot.
- Bug fixed: missing `pot_colors.type` column could roll back order processing; lookup now guarded. `type` added to migrate.js for consistency.

## Setting up a product (clean workflow)
1. In Shopify: product with option1 = Size (6 inch, 1 gal, 3 gal...), option2 = Pot (With Pot / Without Pot). Set With-Pot prices; twins' prices can be anything.
2. Put it in a synced collection (Collections page) or Connect it in Product Config; check size→pot mapping.
3. Settings: confirm No-Pot discounts per size.
4. Product Config: click "Apply No-Pot pricing" — twins get repriced automatically.
5. Set plant stock in Plant Inventory (twin availability mirrors automatically).

## Verified
- node --check: all server files. esbuild: all client JSX.
- PGlite functional harness (6/6 PASS): twin-skip seeding + stale-row cleanup; pot order deducts plant+pot; twin order deducts shared plant pool, no pot; cancel restores; title-suffix "Without Pot" not mistaken for a color; sibling lookup.
