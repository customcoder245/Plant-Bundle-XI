const { isNoPotValue, sizeLabelOfVariant } = require('./sizeRules');

/**
 * collapseLegacyProduct - Convert an OLD-style product (Size x Pot Color x
 * With/Without Pot variants) into a clean size-only product in Shopify.
 * Per size: base price = the Without-Pot variant's price when present (that was
 * the bare price under the old model), else the lowest price in the group;
 * stock = MAX across the group (colors shared the same physical plants);
 * sku/barcode = first non-empty in the group.
 * Returns the refreshed product.
 */
async function collapseLegacyProduct(product) {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    const accessToken = process.env.ADMIN_API || process.env.SHOPIFY_ACCESS_TOKEN;
    if (!shop || !accessToken) throw new Error('Shopify credentials not configured');
    const headers = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };

    const groups = new Map();
    for (const v of product.variants || []) {
        const label = sizeLabelOfVariant(v);
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(v);
    }

    const newVariants = [];
    const stockBySize = {};
    for (const [label, vars] of groups) {
        const noPot = vars.find(v => [v.option1, v.option2, v.option3].some(o => isNoPotValue(o)) );
        const base = noPot ? parseFloat(noPot.price) : Math.min(...vars.map(v => parseFloat(v.price)));
        const skuV = vars.find(v => v.sku) || {};
        const barV = vars.find(v => v.barcode) || {};
        stockBySize[label] = Math.max(...vars.map(v => v.inventory_quantity || 0));
        newVariants.push({
            option1: label,
            price: base.toFixed(2),
            sku: skuV.sku || '',
            barcode: barV.barcode || '',
            inventory_management: 'shopify'
        });
    }

    // Replace the whole variant set with clean size-only variants
    const putRes = await fetch(`https://${shop}/admin/api/2023-10/products/${product.id}.json`, {
        method: 'PUT', headers,
        body: JSON.stringify({ product: { id: product.id, options: [{ name: 'Size' }], variants: newVariants } })
    });
    if (!putRes.ok) throw new Error(`Legacy conversion failed: ${await putRes.text()}`);
    let refreshed = (await putRes.json()).product;

    // Restore per-size stock on the new variants
    const locRes = await fetch(`https://${shop}/admin/api/2023-10/locations.json`, { headers });
    const locationId = locRes.ok ? (await locRes.json()).locations?.[0]?.id : null;
    if (locationId) {
        for (const v of refreshed.variants || []) {
            const qty = stockBySize[sizeLabelOfVariant(v)] || 0;
            if (v.inventory_item_id != null) {
                await fetch(`https://${shop}/admin/api/2023-10/inventory_levels/set.json`, {
                    method: 'POST', headers,
                    body: JSON.stringify({ location_id: locationId, inventory_item_id: v.inventory_item_id, available: qty })
                });
                v.inventory_quantity = qty;
            }
        }
    }
    return refreshed;
}

/** A product is legacy when it has 2+ options but none of them is the Pot (With/Without) option. */
function isLegacyProduct(product) {
    const variants = product.variants || [];
    const optionCount = (product.options || []).length || 1;
    if (optionCount < 2) return false;
    const hasPotOption = [1, 2, 3].some(pos => variants.some(v => isNoPotValue(v[`option${pos}`]) || /with pot/i.test(v[`option${pos}`] || '')));
    if (optionCount === 2 && hasPotOption) return false;
    return true;
}

module.exports = { collapseLegacyProduct, isLegacyProduct };
