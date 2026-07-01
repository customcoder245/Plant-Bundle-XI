const pool = require('../db/pool');
const { logActivity } = require('./activityService');
const { potPriceForSize, potDeductionForSize, isNoPotValue, isWithPotValue } = require('./sizeRules');

/**
 * applyPotPricingToProduct - reprice every "With Pot" variant of one product:
 * price = Without-Pot sibling's base price + standard pot price (pot_prices
 * table, by mapped pot size) + the plant's per-size price adjust.
 * Returns { product, updated: [...], skipped: [...] }.
 */
async function applyPotPricingToProduct(shopifyProductId) {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    const accessToken = process.env.ADMIN_API || process.env.SHOPIFY_ACCESS_TOKEN;
    if (!shop || !accessToken) throw new Error('Shopify credentials not configured');

    const prodRes = await fetch(`https://${shop}/admin/api/2023-10/products/${shopifyProductId}.json`, {
        headers: { 'X-Shopify-Access-Token': accessToken }
    });
    if (!prodRes.ok) throw new Error(`Shopify product fetch failed (${prodRes.status})`);
    const { product } = await prodRes.json();
    const variants = product.variants || [];

    const potPrices = (await pool.query('SELECT pot_size, price, no_pot_deduction FROM pot_prices')).rows;
    const { getSettingNum } = require('./settingsService');
    const defaultPotPrice = await getSettingNum('default_pot_price', 10);
    const cfg = await pool.query('SELECT id FROM product_pot_config WHERE shopify_product_id = $1', [product.id]);
    const mapRows = cfg.rows.length
        ? (await pool.query('SELECT shopify_variant_id, pot_size, pot_price_adjust, with_pot_price_override, base_price FROM size_mappings WHERE product_config_id = $1', [cfg.rows[0].id])).rows
        : [];
    const mapByVariant = new Map(mapRows.map(m => [m.shopify_variant_id.toString(), m]));

    let potPos = null;
    for (const pos of [1, 2, 3]) {
        if (variants.some(v => isNoPotValue(v[`option${pos}`]) || isWithPotValue(v[`option${pos}`]))) { potPos = pos; break; }
    }
    if (!potPos) return { product: product.title, updated: [], skipped: [{ variant: '*', reason: 'no Pot option on product - run Bundle Builder setup first' }] };

    const otherPositions = [1, 2, 3].filter(p => p !== potPos && variants.some(v => v[`option${p}`]));
    const updated = [], skipped = [];
    for (const v of variants) {
        if (!isWithPotValue(v[`option${potPos}`])) continue;
        const sibling = variants.find(s =>
            s.id !== v.id &&
            isNoPotValue(s[`option${potPos}`]) &&
            otherPositions.every(p => (s[`option${p}`] || '') === (v[`option${p}`] || ''))
        );
        if (!sibling) { skipped.push({ variant: v.title, reason: 'pot-included size (no base sibling) - price left as-is' }); continue; }
        const mapping = mapByVariant.get(sibling.id.toString()) || mapByVariant.get(v.id.toString()) || {};
        const ownMapping = mapByVariant.get(v.id.toString()) || {};
        const potPrice = potPriceForSize(mapping.pot_size, potPrices, defaultPotPrice);
        const deduction = potDeductionForSize(mapping.pot_size, potPrices, defaultPotPrice);
        const adjust = parseFloat(mapping.pot_price_adjust) || 0;
        const oldPrice = v.price;
        const manual = [ownMapping.with_pot_price_override, mapping.with_pot_price_override].find(x => x !== undefined && x !== null);
        const storedBase = [mapping.base_price, ownMapping.base_price].find(x => x !== undefined && x !== null);
        const r2 = n => Math.max(0, Math.round(n * 100) / 100);
        // Base anchor stored at setup; legacy configs (no stored base): the No-Pot
        // sibling's price IS the base (old model where No Pot = base price).
        const base = storedBase !== undefined ? parseFloat(storedBase) : parseFloat(sibling.price);
        // Manual with-pot price stays put when standards change
        const target = manual !== undefined ? r2(parseFloat(manual)) : r2(base + potPrice + adjust);
        // No-Pot sibling = with-pot minus the per-size deduction (new model only)
        const noPotTarget = storedBase !== undefined ? r2(target - deduction) : null;

        if (parseFloat(v.price) !== target) {
            const updRes = await fetch(`https://${shop}/admin/api/2023-10/variants/${v.id}.json`, {
                method: 'PUT',
                headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
                body: JSON.stringify({ variant: { id: v.id, price: target.toFixed(2) } })
            });
            if (!updRes.ok) { skipped.push({ variant: v.title, reason: `Shopify update failed (${updRes.status})` }); continue; }
            updated.push({ variant: v.title, pot_size: mapping.pot_size, pot_price: potPrice, adjust, old_price: oldPrice, new_price: target.toFixed(2) });
        } else {
            skipped.push({ variant: v.title, reason: manual !== undefined ? 'manual price - kept' : 'already correct' });
        }
        if (noPotTarget !== null && parseFloat(sibling.price) !== noPotTarget) {
            const sibRes = await fetch(`https://${shop}/admin/api/2023-10/variants/${sibling.id}.json`, {
                method: 'PUT',
                headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
                body: JSON.stringify({ variant: { id: sibling.id, price: noPotTarget.toFixed(2) } })
            });
            if (sibRes.ok) updated.push({ variant: sibling.title, pot_size: mapping.pot_size, old_price: sibling.price, new_price: noPotTarget.toFixed(2), note: `No Pot = with pot - $${deduction.toFixed(2)}` });
        }
    }
    return { product: product.title, updated, skipped };
}

/**
 * applyPotPricingToAllProducts - run the above on EVERY configured product.
 * Used when a pot price changes so the whole store follows automatically.
 */
async function applyPotPricingToAllProducts() {
    const configs = (await pool.query('SELECT shopify_product_id, product_title FROM product_pot_config WHERE is_enabled = true')).rows;
    const results = [];
    let totalUpdated = 0;
    for (const c of configs) {
        try {
            const r = await applyPotPricingToProduct(c.shopify_product_id);
            totalUpdated += r.updated.length;
            results.push({ product: r.product, repriced: r.updated.length, details: r.updated });
        } catch (e) {
            results.push({ product: c.product_title, error: e.message });
        }
    }
    await logActivity('POT_PRICING_APPLIED_ALL', `Store-wide pot repricing: ${totalUpdated} With-Pot variant(s) updated across ${configs.length} product(s)`, { totalUpdated, products: results.map(r => ({ product: r.product, repriced: r.repriced ?? 0, error: r.error })) });
    return { products: configs.length, totalUpdated, results };
}

module.exports = { applyPotPricingToProduct, applyPotPricingToAllProducts };
