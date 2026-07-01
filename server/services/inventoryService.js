const pool = require('../db/pool');
const { logActivity } = require('./activityService');

/**
 * processOrder - Handles inventory deduction/restoration based on Shopify order webhooks
 * @param {Object} order - The Shopify order object
 * @param {String} action - 'deduct' or 'restore'
 */
async function processOrder(order, action = 'deduct') {
    const client = await pool.connect();
    const syncJobs = [];
    const plantSyncJobs = [];
    let configuredItems = 0; // line items that belong to houseplant products

    try {
        await client.query('BEGIN');
        console.log(`Processing Order ${order.name} (${order.id}) - Action: ${action}`);

        for (const lineItem of order.line_items) {
            // 1. Check if this product is managed as a bundle in our app
            const configResult = await client.query(
                'SELECT * FROM product_pot_config WHERE shopify_product_id = $1 AND is_enabled = true',
                [lineItem.product_id]
            );

            if (configResult.rows.length === 0) {
                console.log(`Skipping non-bundle product: ${lineItem.title}`);
                continue;
            }
            configuredItems++;

            // ─── PLANT INVENTORY ──────────────────────────────────────────────
            // The plant is ALWAYS deducted/restored on a bundle sale, independent of
            // the pot choice (even "NO POT" bare-root orders still ship a plant).
            // Keyed by the Shopify size variant the customer bought.
            const plantQty = lineItem.quantity;
            const plantRes = await client.query(
                action === 'deduct'
                    ? `UPDATE plant_inventory SET quantity = GREATEST(0, quantity - $1), updated_at = CURRENT_TIMESTAMP WHERE shopify_variant_id = $2 RETURNING quantity, size`
                    : `UPDATE plant_inventory SET quantity = quantity + $1, updated_at = CURRENT_TIMESTAMP WHERE shopify_variant_id = $2 RETURNING quantity, size`,
                [plantQty, lineItem.variant_id]
            );

            if (plantRes.rows.length > 0) {
                const newPlantQty = plantRes.rows[0].quantity;
                const plantSize = plantRes.rows[0].size || '';
                plantSyncJobs.push({ shopifyProductId: lineItem.product_id, variantId: lineItem.variant_id, quantity: newPlantQty });
                console.log(`${action === 'deduct' ? 'Deducted' : 'Restored'} ${plantQty} plant "${lineItem.title}" (${plantSize}) for order ${order.name}. New plant qty: ${newPlantQty}`);
                await logActivity(
                    action === 'deduct' ? 'PLANT_INVENTORY_DEDUCTED' : 'PLANT_INVENTORY_RESTORED',
                    `${action === 'deduct' ? 'Deducted' : 'Restored'} ${plantQty} plant unit(s) of "${lineItem.title}" (${plantSize}) for order ${order.name}`,
                    {
                        order_id: order.id,
                        order_number: order.order_number,
                        item: lineItem.title,
                        variant_id: lineItem.variant_id,
                        size: plantSize,
                        quantity: plantQty
                    }
                );
            } else {
                // Likely a "Without Pot" twin: deduct/restore its With-Pot sibling's plant pool
                let fallbackDone = false;
                const sibIds = await getSizeSiblingVariantIds(client, lineItem.variant_id);
                for (const sibId of sibIds) {
                    const fbRes = await client.query(
                        action === 'deduct'
                            ? `UPDATE plant_inventory SET quantity = GREATEST(0, quantity - $1), updated_at = CURRENT_TIMESTAMP WHERE shopify_variant_id = $2 RETURNING quantity, size`
                            : `UPDATE plant_inventory SET quantity = quantity + $1, updated_at = CURRENT_TIMESTAMP WHERE shopify_variant_id = $2 RETURNING quantity, size`,
                        [plantQty, sibId]
                    );
                    if (fbRes.rows.length > 0) {
                        const newPlantQty = fbRes.rows[0].quantity;
                        plantSyncJobs.push({ shopifyProductId: lineItem.product_id, variantId: sibId, quantity: newPlantQty });
                        console.log(`${action === 'deduct' ? 'Deducted' : 'Restored'} ${plantQty} plant "${lineItem.title}" via size sibling ${sibId} (No-Pot twin). New plant qty: ${newPlantQty}`);
                        await logActivity(
                            action === 'deduct' ? 'PLANT_INVENTORY_DEDUCTED' : 'PLANT_INVENTORY_RESTORED',
                            `${action === 'deduct' ? 'Deducted' : 'Restored'} ${plantQty} plant unit(s) of "${lineItem.title}" (No-Pot twin, shared pool) for order ${order.name}`,
                            { order_id: order.id, order_number: order.order_number, item: lineItem.title, variant_id: lineItem.variant_id, shared_with_variant: sibId, quantity: plantQty }
                        );
                        fallbackDone = true;
                        break;
                    }
                }
                if (!fallbackDone) {
                    console.warn(`No plant_inventory row for variant ${lineItem.variant_id} ("${lineItem.title}"). Run a product sync to seed it. Skipping plant ${action}.`);
                }
            }

            // 2. Extract the Pot selection
            // A. Check Line Item Properties (Bundle Builder logic)
            let potValue = '';
            const potColorProperty = lineItem.properties?.find(p => {
                const name = p.name.toLowerCase();
                return name.includes('pot') || name.includes('color');
            });

            if (potColorProperty) {
                potValue = potColorProperty.value;
            } else {
                // B. Fallback: Check Variant Title (Insta-Build variants structure: "Size / Color")
                // Parsing "4\" Pot / White" -> "White"
                const variantTitle = lineItem.variant_title || '';
                if (variantTitle.includes(' / ')) {
                    const parts = variantTitle.split(' / ');
                    potValue = parts[parts.length - 1].trim(); // Take the last part (Color)
                    console.log(`Extracted color "${potValue}" from variant title: ${variantTitle}`);
                }
            }

            // Record the houseplant sale for analytics BEFORE any pot-path early exits
            // (no-pot and bare-root sales count too; negative row on cancel/refund).
            try {
                const isNoPotSale = !potValue || ['NO POT', 'BARE ROOT', 'NONE'].includes((potValue || '').toUpperCase()) || NO_POT_TITLE_RE.test(potValue || '');
                const sign = action === 'deduct' ? 1 : -1;
                const sizeLabel = (lineItem.variant_title || '').split(' / ')[0].trim() || null;
                await client.query(
                    `INSERT INTO houseplant_sales (product_config_id, shopify_product_id, product_title, size, with_pot, pot_color, quantity, revenue, order_id, order_number)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                    [configResult.rows[0].id, lineItem.product_id, configResult.rows[0].product_title || lineItem.title, sizeLabel,
                     !isNoPotSale, isNoPotSale ? null : potValue, sign * lineItem.quantity,
                     sign * (parseFloat(lineItem.price) || 0) * lineItem.quantity, order.id, String(order.order_number || order.id)]
                );
            } catch (salesErr) {
                console.error('Sales ledger insert failed (non-fatal):', salesErr.message);
            }

            if (!potValue) {
                console.log(`No pot selection detected for ${lineItem.title} (ID: ${lineItem.variant_id}). Skipping.`);
                continue;
            }

            // 3. Handle "NO POT" or "Bare Root"
            if (['NO POT', 'BARE ROOT', 'NONE'].includes(potValue.toUpperCase()) || NO_POT_TITLE_RE.test(potValue)) {
                console.log(`User selected "${potValue}" for ${lineItem.title}. No inventory deduction needed.`);
                continue;
            }

            // 4. Resolve Pot Color ID from Name
            let colorResult = await client.query(
                'SELECT id FROM pot_colors WHERE LOWER(name) = LOWER($1)',
                [potValue]
            );

            // Special case: sometimes name vs type mismatch. Check type too.
            // (Guarded: some databases don't have the optional "type" column -
            //  an unguarded failure here would roll back the whole order.)
            if (colorResult.rows.length === 0) {
                try {
                    colorResult = await client.query(
                        'SELECT id FROM pot_colors WHERE LOWER(type) = LOWER($1)',
                        [potValue]
                    );
                } catch (e) {
                    console.warn(`pot_colors.type lookup unavailable (${e.message}); continuing with name match only.`);
                    colorResult = { rows: [] };
                }
            }

            if (colorResult.rows.length === 0) {
                console.warn(`Could not find color in DB matching: "${potValue}"`);
                continue;
            }

            const potColorId = colorResult.rows[0].id;

            // 5. Resolve Pot Size from Variant Mapping
            const sizeResult = await client.query(
                'SELECT pot_size FROM size_mappings WHERE shopify_variant_id = $1',
                [lineItem.variant_id]
            );

            const potSize = sizeResult.rows[0]?.pot_size || 'Medium'; // Default to medium if unknown
            const quantity = lineItem.quantity;

            // 6. Update Pot Inventory
            let updatedQty = 0;
            if (action === 'deduct') {
                console.log(`Deducting ${quantity} x ${potValue} (${potSize}) for order ${order.name}...`);
                const resDb = await client.query(
                    `UPDATE pot_inventory SET quantity = GREATEST(0, quantity - $1), updated_at = CURRENT_TIMESTAMP WHERE pot_color_id = $2 AND size = $3 RETURNING quantity`,
                    [quantity, potColorId, potSize]
                );
                updatedQty = resDb.rows[0]?.quantity || 0;
            } else {
                console.log(`Restoring ${quantity} x ${potValue} (${potSize}) for order ${order.name}...`);
                const resDb = await client.query(
                    `UPDATE pot_inventory SET quantity = quantity + $1, updated_at = CURRENT_TIMESTAMP WHERE pot_color_id = $2 AND size = $3 RETURNING quantity`,
                    [quantity, potColorId, potSize]
                );
                updatedQty = resDb.rows[0]?.quantity || 0;
            }

            syncJobs.push({ potColorId, potSize, quantity: updatedQty });

            // 7. Log Activity
            await logActivity(
                action === 'deduct' ? 'INVENTORY_DEDUCTED' : 'INVENTORY_RESTORED',
                `${action === 'deduct' ? 'Deducted' : 'Restored'} ${quantity} unit(s) of "${potValue}" (${potSize}) for order ${order.name}`,
                {
                    order_id: order.id,
                    order_number: order.order_number,
                    item: lineItem.title,
                    color: potValue,
                    size: potSize,
                    quantity
                }
            );
        }

        await client.query('COMMIT');

        // Pot stock is intentionally NOT pushed to Shopify variants. Pots are a shared
        // app-side pool; the storefront swatch UI reads availability from /api/inventory.
        // The Shopify per-variant inventory now reflects PLANT stock only (set below),
        // so pots and plants no longer fight over the same number.
        void syncJobs;

        // Push the new PLANT stock to each Shopify size variant in the background so
        // Shopify's add-to-cart correctly gates when a plant size sells out.
        for (const job of plantSyncJobs) {
            syncPlantInventoryToShopify(job.shopifyProductId, job.variantId, job.quantity).catch(err =>
                console.error(`Failed to background sync plant variant ${job.variantId} to Shopify:`, err)
            );
        }
        return { configuredItems };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Inventory processing failed for order ${order.id}:`, error.message);
        throw error;
    } finally {
        client.release();
    }
}

let cachedLocationId = null;

async function getShopifyLocationId(shop, token) {
    if (cachedLocationId) return cachedLocationId;
    try {
        const res = await fetch(`https://${shop}/admin/api/2023-10/locations.json`, {
            headers: { 'X-Shopify-Access-Token': token }
        });
        if (res.ok) {
            const data = await res.json();
            if (data.locations && data.locations.length > 0) {
                const primary = data.locations.find(loc => loc.active);
                if (primary) {
                    cachedLocationId = primary.id;
                    return cachedLocationId;
                }
                cachedLocationId = data.locations[0].id;
                return cachedLocationId;
            }
        } else {
            console.error('Error fetching locations from Shopify:', await res.text());
        }
    } catch (e) {
        console.error('Failed to fetch Shopify locations:', e);
    }
    return null;
}

function matchColor(colorName, text) {
    const c = colorName.toLowerCase().trim();
    const t = text.toLowerCase().trim();
    return c === t || t.includes(c) || c.includes(t);
}

function matchSize(dbSize, shopifyOptionValue) {
    const db = dbSize.toLowerCase().trim();
    const shop = shopifyOptionValue.toLowerCase().trim();

    if (db === shop) return true;

    if (db === 'extra large' && (shop === 'xl' || shop === 'extra-large' || shop === 'extra large')) return true;

    if (db === 'small' && (shop.includes('2"') || shop.includes('3"') || shop.includes('4"') || shop.includes('2 inch') || shop.includes('4 inch') || shop.includes('small'))) return true;
    if (db === 'medium' && (shop.includes('6"') || shop.includes('6 inch') || shop.includes('medium') || shop.includes('standard'))) return true;
    if (db === 'large' && (shop.includes('8"') || shop.includes('10"') || shop.includes('8 inch') || shop.includes('10 inch') || shop.includes('large'))) return true;
    if (db === 'extra large' && (shop.includes('12"') || shop.includes('14"') || shop.includes('12 inch') || shop.includes('xl') || shop.includes('extra large'))) return true;

    return false;
}

async function syncPotInventoryToShopify(potColorId, size, quantity) {
    // DISABLED: Pot stock is a shared app-side pool and must not be written onto the
    // plant products' Shopify variants — doing so overwrote/clobbered the plant stock
    // that those variants now represent. The storefront swatch UI reads pot availability
    // from /api/inventory (the app DB), so no Shopify push is needed for pots.
    return;

    /* eslint-disable no-unreachable */
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    const token = process.env.ADMIN_API || process.env.SHOPIFY_ACCESS_TOKEN;

    if (!shop || !token) {
        console.warn('Shopify credentials not found. Skipping Shopify inventory sync.');
        return;
    }

    try {
        const colorRes = await pool.query('SELECT name FROM pot_colors WHERE id = $1', [potColorId]);
        if (colorRes.rows.length === 0) return;
        const colorName = colorRes.rows[0].name;

        const locationId = await getShopifyLocationId(shop, token);
        if (!locationId) return;

        const configsRes = await pool.query('SELECT id, shopify_product_id, product_title FROM product_pot_config WHERE is_enabled = true');
        const configs = configsRes.rows;

        for (const config of configs) {
            const mappingsRes = await pool.query(
                'SELECT shopify_variant_id, pot_size FROM size_mappings WHERE product_config_id = $1',
                [config.id]
            );
            const mappings = mappingsRes.rows;
            if (mappings.length === 0) continue;

            const shopifyRes = await fetch(`https://${shop}/admin/api/2023-10/products/${config.shopify_product_id}.json`, {
                headers: { 'X-Shopify-Access-Token': token }
            });

            if (!shopifyRes.ok) continue;

            const data = await shopifyRes.json();
            const shopifyProduct = data.product;
            if (!shopifyProduct || !shopifyProduct.variants) continue;

            for (const variant of shopifyProduct.variants) {
                const mapping = mappings.find(m => String(m.shopify_variant_id) === String(variant.id));
                if (!mapping) continue;

                const isSizeMatch = mapping.pot_size.toLowerCase().trim() === size.toLowerCase().trim() ||
                                   (variant.option1 && variant.option1.toLowerCase().trim() === size.toLowerCase().trim());

                const isColorMatch = (variant.option2 && matchColor(colorName, variant.option2)) ||
                                     (variant.title && matchColor(colorName, variant.title));

                if (isSizeMatch && isColorMatch) {
                    console.log(`Syncing Shopify variant ${shopifyProduct.title} - ${variant.title} (ID: ${variant.id}) to ${quantity}`);
                    await fetch(`https://${shop}/admin/api/2023-10/inventory_levels/set.json`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Shopify-Access-Token': token
                        },
                        body: JSON.stringify({
                            location_id: locationId,
                            inventory_item_id: variant.inventory_item_id,
                            available: quantity
                        })
                    });
                }
            }
        }
    } catch (e) {
        console.error('Error syncing pot inventory to Shopify:', e);
    }
}

async function syncPotsFromShopify() {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    const token = process.env.ADMIN_API || process.env.SHOPIFY_ACCESS_TOKEN;

    if (!shop || !token) {
        throw new Error('Shopify credentials not configured in environment.');
    }

    const response = await fetch(`https://${shop}/admin/api/2023-10/products.json?limit=250`, {
        headers: { 'X-Shopify-Access-Token': token }
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch Shopify products: ${await response.text()}`);
    }
    const data = await response.json();
    const products = data.products || [];

    const potProducts = products.filter(p => {
        const title = (p.title || '').toLowerCase();
        const type = (p.product_type || '').toLowerCase();
        return title.includes('pot') || title.includes('planter') || title.includes('saucer') || type === 'pot' || type === 'planter';
    });

    console.log(`Found ${potProducts.length} pot-related products in Shopify.`);

    const colorsRes = await pool.query('SELECT * FROM pot_colors');
    const colors = colorsRes.rows;

    const sizes = ['Small', 'Medium', 'Large', 'Extra Large'];
    let syncCount = 0;
    const syncedItems = [];

    for (const product of potProducts) {
        const productTitle = product.title;

        let matchedColorId = null;
        let matchedColorName = '';
        for (const color of colors) {
            if (matchColor(color.name, productTitle)) {
                matchedColorId = color.id;
                matchedColorName = color.name;
                break;
            }
        }

        const colorOptionIdx = (product.options || []).findIndex(opt => opt.name.toLowerCase().includes('color'));
        const sizeOptionIdx = (product.options || []).findIndex(opt => opt.name.toLowerCase().includes('size') || opt.name.toLowerCase().includes('option'));

        for (const variant of product.variants) {
            let variantColorId = matchedColorId;
            let variantColorName = matchedColorName;

            if (colorOptionIdx !== -1) {
                const variantColorVal = variant[`option${colorOptionIdx + 1}`];
                if (variantColorVal) {
                    const dbColor = colors.find(c => matchColor(c.name, variantColorVal));
                    if (dbColor) {
                        variantColorId = dbColor.id;
                        variantColorName = dbColor.name;
                    }
                }
            }

            if (!variantColorId) {
                const dbColor = colors.find(c => matchColor(c.name, variant.title || ''));
                if (dbColor) {
                    variantColorId = dbColor.id;
                    variantColorName = dbColor.name;
                }
            }

            if (!variantColorId) continue;

            let matchedSize = null;
            if (sizeOptionIdx !== -1) {
                const sizeVal = variant[`option${sizeOptionIdx + 1}`];
                if (sizeVal) {
                    matchedSize = sizes.find(s => matchSize(s, sizeVal));
                }
            }

            if (!matchedSize) {
                matchedSize = sizes.find(s => matchSize(s, variant.title || ''));
            }

            if (!matchedSize) continue;

            const qty = variant.inventory_quantity || 0;

            const res = await pool.query(
                `UPDATE pot_inventory 
                 SET quantity = $1, updated_at = CURRENT_TIMESTAMP 
                 WHERE pot_color_id = $2 AND size = $3
                 RETURNING *`,
                [qty, variantColorId, matchedSize]
            );

            if (res.rows.length > 0) {
                console.log(`Synced DB pot inventory: Color "${variantColorName}", Size "${matchedSize}" -> ${qty}`);
                syncCount++;
                syncedItems.push({
                    color: variantColorName,
                    size: matchedSize,
                    quantity: qty,
                    product: productTitle
                });

                syncPotInventoryToShopify(variantColorId, matchedSize, qty).catch(err =>
                    console.error('Failed to sync plant bundle variant after pot sync:', err)
                );
            }
        }
    }

    return {
        success: true,
        updatedCount: syncCount,
        details: syncedItems
    };
}

// ─── PLANT INVENTORY HELPERS ────────────────────────────────────────────────

const NO_POT_TITLE_RE = /(no pot|without pot|bare ?root)/i;

/**
 * getSizeSiblingVariantIds - All other Shopify variants of the same product that
 * share the same plant-size label (first " / " segment of the variant title),
 * e.g. the "6 inch / Without Pot" twin of "6 inch / With Pot".
 */
async function getSizeSiblingVariantIds(dbClient, variantId) {
    const runner = dbClient || pool;
    const r = await runner.query(
        'SELECT product_config_id, variant_title FROM size_mappings WHERE shopify_variant_id = $1 LIMIT 1',
        [variantId]
    );
    if (r.rows.length === 0) return [];
    const { product_config_id, variant_title } = r.rows[0];
    const seg = (variant_title || '').split(' / ')[0].trim().toLowerCase();
    if (!seg) return [];
    const all = await runner.query(
        'SELECT shopify_variant_id, variant_title FROM size_mappings WHERE product_config_id = $1',
        [product_config_id]
    );
    return all.rows
        .filter(x => x.shopify_variant_id.toString() !== variantId.toString()
            && (x.variant_title || '').split(' / ')[0].trim().toLowerCase() === seg)
        .map(x => x.shopify_variant_id);
}

/**
 * seedPlantInventoryForConfig - Ensure every size variant of a plant product has a
 * plant_inventory row. Preserves any existing quantity/sku/barcode (only fills gaps).
 * Pass a transaction client when called inside an existing BEGIN/COMMIT, else uses pool.
 * @param {Object} dbClient - pg client or pool
 * @param {Number} configId - product_pot_config.id
 */
async function seedPlantInventoryForConfig(dbClient, configId) {
    const runner = dbClient || pool;
    const mappings = await runner.query(
        'SELECT shopify_variant_id, pot_size, variant_title FROM size_mappings WHERE product_config_id = $1',
        [configId]
    );
    let seeded = 0;
    const sizeSegOf = t => (t || '').split(' / ')[0].trim().toLowerCase();
    for (const m of mappings.rows) {
        // "Without Pot / No Pot" TWIN variants share the plant pool of their
        // With-Pot sibling - they must NOT get their own plant_inventory row.
        // But a bare-root size (e.g. 2 inch, 5 gal) has ONLY a Without-Pot
        // variant: that one IS the plant and must be seeded normally.
        const isNoPotTitle = NO_POT_TITLE_RE.test(m.variant_title || '');
        const hasWithPotSibling = isNoPotTitle && mappings.rows.some(o =>
            o.shopify_variant_id.toString() !== m.shopify_variant_id.toString() &&
            !NO_POT_TITLE_RE.test(o.variant_title || '') &&
            sizeSegOf(o.variant_title) === sizeSegOf(m.variant_title)
        );
        if (isNoPotTitle && hasWithPotSibling) {
            await runner.query('DELETE FROM plant_inventory WHERE shopify_variant_id = $1', [m.shopify_variant_id]);
            continue;
        }
        await runner.query(
            `INSERT INTO plant_inventory (product_config_id, shopify_variant_id, size)
             VALUES ($1, $2, $3)
             ON CONFLICT (shopify_variant_id)
             DO UPDATE SET product_config_id = EXCLUDED.product_config_id,
                           size = EXCLUDED.size,
                           updated_at = CURRENT_TIMESTAMP`,
            [configId, m.shopify_variant_id, m.pot_size]
        );
        seeded++;
    }
    return seeded;
}

/**
 * syncPlantInventoryToShopify - Push a plant variant's stock (and optionally sku/barcode)
 * to its Shopify variant, so Shopify gates add-to-cart on plant availability.
 * @param {String|Number} shopifyProductId
 * @param {String|Number} variantId
 * @param {Number} quantity
 * @param {Object} [opts] - { sku, barcode } to also write to the Shopify variant
 */
async function syncPlantInventoryToShopify(shopifyProductId, variantId, quantity, opts = {}) {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    const token = process.env.ADMIN_API || process.env.SHOPIFY_ACCESS_TOKEN;
    if (!shop || !token) {
        console.warn('Shopify credentials not found. Skipping plant inventory sync to Shopify.');
        return;
    }

    try {
        // 1. Resolve the variant's inventory_item_id
        const variantRes = await fetch(`https://${shop}/admin/api/2023-10/variants/${variantId}.json`, {
            headers: { 'X-Shopify-Access-Token': token }
        });
        if (!variantRes.ok) {
            console.error(`Could not fetch Shopify variant ${variantId}:`, await variantRes.text());
            return;
        }
        const variant = (await variantRes.json()).variant;
        if (!variant) return;

        // 2. Set the inventory level at the primary location
        const locationId = await getShopifyLocationId(shop, token);
        if (locationId && variant.inventory_item_id != null) {
            await fetch(`https://${shop}/admin/api/2023-10/inventory_levels/set.json`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
                body: JSON.stringify({
                    location_id: locationId,
                    inventory_item_id: variant.inventory_item_id,
                    available: Math.max(0, parseInt(quantity) || 0)
                })
            });
            console.log(`Synced plant variant ${variantId} Shopify stock -> ${quantity}`);

            // Mirror the same plant stock to size-sibling variants (e.g. the
            // "Without Pot" twin) so both show identical availability.
            try {
                const sibIds = await getSizeSiblingVariantIds(pool, variantId);
                for (const sibId of sibIds) {
                    const sibRes = await fetch(`https://${shop}/admin/api/2023-10/variants/${sibId}.json`, {
                        headers: { 'X-Shopify-Access-Token': token }
                    });
                    if (!sibRes.ok) continue;
                    const sib = (await sibRes.json()).variant;
                    if (!sib || sib.inventory_item_id == null) continue;
                    await fetch(`https://${shop}/admin/api/2023-10/inventory_levels/set.json`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
                        body: JSON.stringify({
                            location_id: locationId,
                            inventory_item_id: sib.inventory_item_id,
                            available: Math.max(0, parseInt(quantity) || 0)
                        })
                    });
                    console.log(`Mirrored plant stock ${quantity} to size-sibling variant ${sibId}`);
                }
            } catch (sibErr) {
                console.error('Failed to mirror plant stock to sibling variants:', sibErr);
            }
        }

        // 3. Optionally update SKU / barcode on the variant
        const variantPatch = {};
        if (opts.sku !== undefined && opts.sku !== null) variantPatch.sku = opts.sku;
        if (opts.barcode !== undefined && opts.barcode !== null) variantPatch.barcode = opts.barcode;
        if (Object.keys(variantPatch).length > 0) {
            await fetch(`https://${shop}/admin/api/2023-10/variants/${variantId}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
                body: JSON.stringify({ variant: { id: variantId, ...variantPatch } })
            });
            console.log(`Updated plant variant ${variantId} SKU/barcode on Shopify`);
        }
    } catch (e) {
        console.error('Error syncing plant inventory to Shopify:', e);
    }
}

/**
 * syncPlantInventoryFromShopify - Pull current plant stock + sku/barcode FROM Shopify
 * into plant_inventory for every configured plant product. Mirrors syncPotsFromShopify.
 */
async function syncPlantInventoryFromShopify() {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    const token = process.env.ADMIN_API || process.env.SHOPIFY_ACCESS_TOKEN;
    if (!shop || !token) {
        throw new Error('Shopify credentials not configured in environment.');
    }

    const configsRes = await pool.query('SELECT id, shopify_product_id, product_title FROM product_pot_config');
    const configs = configsRes.rows;
    let updatedCount = 0;
    const details = [];

    for (const config of configs) {
        // Make sure rows exist for all current size variants first
        await seedPlantInventoryForConfig(pool, config.id);

        const prodRes = await fetch(`https://${shop}/admin/api/2023-10/products/${config.shopify_product_id}.json`, {
            headers: { 'X-Shopify-Access-Token': token }
        });
        if (!prodRes.ok) continue;
        const product = (await prodRes.json()).product;
        if (!product || !product.variants) continue;

        // A size's With-Pot and Without-Pot variants are the same physical plants.
        // Staff may have edited EITHER one in Shopify, so take the freshest count
        // per size group (max), update the size's pool row, and mirror the number
        // back so both Shopify variants agree again.
        const groups = new Map();
        for (const v of product.variants) {
            const seg = (v.title || '').split(' / ')[0].trim().toLowerCase();
            if (!groups.has(seg)) groups.set(seg, []);
            groups.get(seg).push(v);
        }
        for (const [, vars] of groups) {
            const qty = Math.max(...vars.map(v => v.inventory_quantity || 0));
            const skuV = vars.find(v => v.sku) || {};
            const barV = vars.find(v => v.barcode) || {};
            const res = await pool.query(
                `UPDATE plant_inventory
                 SET quantity = $1, sku = COALESCE($2, sku), barcode = COALESCE($3, barcode), updated_at = CURRENT_TIMESTAMP
                 WHERE shopify_variant_id = ANY($4) AND quantity IS DISTINCT FROM $1
                 RETURNING *`,
                [qty, skuV.sku || null, barV.barcode || null, vars.map(v => v.id)]
            );
            if (res.rows.length > 0) {
                updatedCount++;
                details.push({ product: config.product_title, size: vars[0].title.split(' / ')[0], quantity: qty });
                // re-align both Shopify variants to the pool (mirrors to twins)
                syncPlantInventoryToShopify(config.shopify_product_id, res.rows[0].shopify_variant_id, qty)
                    .catch(err => console.error('Mirror after pull failed:', err.message));
            }
        }
    }

    return { success: true, updatedCount, details };
}

module.exports = {
    processOrder,
    getSizeSiblingVariantIds,
    syncPotInventoryToShopify,
    syncPotsFromShopify,
    seedPlantInventoryForConfig,
    syncPlantInventoryToShopify,
    syncPlantInventoryFromShopify
};
