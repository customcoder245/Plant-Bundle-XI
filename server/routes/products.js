const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { logActivity } = require('../services/activityService');
const { seedPlantInventoryForConfig, syncPlantInventoryToShopify } = require('../services/inventoryService');
const { buildSetupPlan } = require('../services/bundleSetup');
const { applyPotPricingToProduct } = require('../services/potPricingService');
const { collapseLegacyProduct, isLegacyProduct } = require('../services/legacyConvert');
const { normalizeSizeLabel: normSizeLabel, sizeLabelOfVariant, potPriceForSize } = require('../services/sizeRules');
const { getSyncedCollectionIds, fetchProductIdsForCollections } = require('../services/collectionService');
const { shopify } = require('../index');

function predictPotSize(optionValue) {
    const shop = (optionValue || '').toLowerCase().trim();
    if (shop.includes('2"') || shop.includes('3"') || shop.includes('4"') || shop.includes('2 inch') || shop.includes('4 inch') || shop.includes('small') || shop.includes('2') || shop.includes('4')) {
        return 'Small';
    }
    if (shop.includes('6"') || shop.includes('6 inch') || shop.includes('medium') || shop.includes('standard') || shop.includes('6')) {
        return 'Medium';
    }
    if (shop.includes('8"') || shop.includes('10"') || shop.includes('8 inch') || shop.includes('10 inch') || shop.includes('large') || shop.includes('8') || shop.includes('10') || shop.includes('gal')) {
        return 'Large';
    }
    if (shop.includes('12"') || shop.includes('14"') || shop.includes('12 inch') || shop.includes('xl') || shop.includes('extra-large') || shop.includes('extra large') || shop.includes('12') || shop.includes('14')) {
        return 'Extra Large';
    }
    return 'Medium';
}

// POST /api/products/create - Create a new plant product in Shopify and configure it
router.post('/create', async (req, res) => {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    let accessToken = process.env.ADMIN_API || process.env.SHOPIFY_ACCESS_TOKEN;

    // FALLBACK: If no permanent token is in .env, try to find an active session (for local dev)
    if (!accessToken) {
        try {
            const sessions = await shopify.config.sessionStorage.findSessionsByShop(shop);
            if (sessions && sessions.length > 0) {
                accessToken = sessions[0].accessToken;
                console.log("Using fallover OAuth session token for local development.");
            }
        } catch (e) {
            console.error("Session lookup failed:", e.message);
        }
    }

    if (!accessToken) {
        return res.status(500).json({ error: 'No access token found. Add SHOPIFY_ACCESS_TOKEN to .env or log in through /api/auth.' });
    }

    const { title, description, variants } = req.body;

    try {
        console.log(`Attempting to create product "${title}" on ${shop}...`);

        const productPayload = {
            title,
            body_html: description,
        };

        // If multi-option product is sent from front-end
        if (req.body.options && req.body.options.length > 0) {
            productPayload.options = req.body.options;
            productPayload.variants = req.body.variants.map(v => ({
                option1: v.option1,
                option2: v.option2,
                option3: v.option3,
                price: v.price,
                compare_at_price: v.compare_at_price || null,
                inventory_management: v.inventory_management || 'shopify',
                inventory_quantity: parseInt(v.inventory_quantity) || 0,
                sku: v.sku || undefined,
                barcode: v.barcode || undefined,
                weight: v.weight ? parseFloat(v.weight) : undefined,
                weight_unit: v.weight_unit || 'lb'
            }));
        } else {
            // Legacy single-option product support
            productPayload.variants = variants.map(v => ({
                option1: v.title,
                price: v.price
            }));
        }

        const shopifyRes = await fetch(`https://${shop}/admin/api/2023-10/products.json`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': accessToken,
            },
            body: JSON.stringify({
                product: productPayload,
            }),
        });

        if (!shopifyRes.ok) {
            const errText = await shopifyRes.text();
            console.error('Shopify API Error Response:', errText);
            return res.status(shopifyRes.status).json({ error: `Shopify rejected creation: ${errText}` });
        }

        const shopifyData = await shopifyRes.json();
        const shopifyProduct = shopifyData.product;
        const shopifyProductId = shopifyProduct.id;

        // NEW: Add to Collection
        const collectionId = process.env.SHOPIFY_COLLECTION_ID || 320337641590;
        try {
            await fetch(`https://${shop}/admin/api/2023-10/collects.json`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': accessToken,
                },
                body: JSON.stringify({
                    collect: {
                        collection_id: collectionId,
                        product_id: shopifyProductId
                    }
                })
            });
            console.log(`Product ${shopifyProductId} added to collection ${collectionId}.`);
        } catch (err) {
            console.error('Failed to add to collection:', err.message);
            // Non-fatal error for the product creation itself
        }

        // Save configuration to Database
        const clientDb = await pool.connect();
        try {
            await clientDb.query('BEGIN');
            const configResult = await clientDb.query(
                `INSERT INTO product_pot_config (shopify_product_id, product_title, no_pot_discount) VALUES ($1, $2, 10.00) RETURNING *`,
                [shopifyProductId, title]
            );
            const configId = configResult.rows[0].id;

            // Iterate over the created Shopify variants to save mappings
            for (let i = 0; i < shopifyProduct.variants.length; i++) {
                const shopifyVariant = shopifyProduct.variants[i];
                // Find matching input variant or fallback
                const inputVariant = (req.body.variants && req.body.variants[i]) || {};
                const potSize = inputVariant.pot_size || predictPotSize(shopifyVariant.option1 || shopifyVariant.title);

                await clientDb.query(
                    `INSERT INTO size_mappings (product_config_id, shopify_variant_id, variant_title, pot_size) VALUES ($1, $2, $3, $4)`,
                    [configId, shopifyVariant.id, shopifyVariant.title, potSize]
                );
            }
            await seedPlantInventoryForConfig(clientDb, configId);
            await clientDb.query('COMMIT');
            console.log("Product successfully configured in Database.");
            await logActivity('PRODUCT_CREATED', `Created and configured product: ${title}`, { shopify_product_id: shopifyProductId });
        } catch (e) {
            await clientDb.query('ROLLBACK');
            console.error("Database Save Error:", e.message);
            throw e;
        } finally {
            clientDb.release();
        }

        res.json({ success: true, product: shopifyProduct });
    } catch (error) {
        console.error('SERVER FATAL ERROR:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

// POST /api/products/sync-config - Sync product titles & config with Shopify collection
router.post('/sync-config', async (req, res) => {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    const accessToken = process.env.ADMIN_API || process.env.SHOPIFY_ACCESS_TOKEN;

    if (!accessToken) {
        return res.status(500).json({ error: 'SHOPIFY_ACCESS_TOKEN missing' });
    }

    const collectionIds = await getSyncedCollectionIds();
    if (collectionIds.length === 0) {
        return res.status(400).json({ error: 'No collections selected. Choose collections on the Collections page first.' });
    }

    try {
        const productIds = await fetchProductIdsForCollections(shop, accessToken, collectionIds);

        let products = [];
        for (let i = 0; i < productIds.length; i += 250) {
            const chunk = productIds.slice(i, i + 250);
            const prodRes = await fetch(
                `https://${shop}/admin/api/2023-10/products.json?ids=${chunk.join(',')}&limit=250`,
                { headers: { 'X-Shopify-Access-Token': accessToken } }
            );
            if (!prodRes.ok) throw new Error('Failed to fetch product details');
            const data = await prodRes.json();
            products = products.concat(data.products || []);
        }

        const clientDb = await pool.connect();
        try {
            await clientDb.query('BEGIN');
            for (const p of products) {
                const configResult = await clientDb.query(
                    `INSERT INTO product_pot_config (shopify_product_id, product_title, no_pot_discount)
                     VALUES ($1, $2, 10.00)
                     ON CONFLICT (shopify_product_id) DO UPDATE SET product_title = EXCLUDED.product_title, updated_at = CURRENT_TIMESTAMP
                     RETURNING id`,
                    [p.id, p.title]
                );
                
                const configId = configResult.rows[0].id;

                // Sync exact variant names (sizes) from Shopify
                if (p.variants && p.variants.length > 0) {
                    // Fetch existing mappings to preserve user configuration
                    const existingRes = await clientDb.query(
                        'SELECT shopify_variant_id, pot_size FROM size_mappings WHERE product_config_id = $1',
                        [configId]
                    );
                    const existingMap = new Map();
                    for (const row of existingRes.rows) {
                        existingMap.set(String(row.shopify_variant_id), row.pot_size);
                    }

                    // Clear old mappings to perfectly reflect Shopify's current variants
                    await clientDb.query('DELETE FROM size_mappings WHERE product_config_id = $1', [configId]);
                    
                    for (const v of p.variants) {
                        const vIdStr = String(v.id);
                        let potSize = existingMap.get(vIdStr);
                        if (!potSize) {
                            potSize = predictPotSize(v.option1 || v.title);
                        }
                        
                        await clientDb.query(
                            `INSERT INTO size_mappings (product_config_id, shopify_variant_id, variant_title, pot_size) 
                             VALUES ($1, $2, $3, $4)`,
                            [configId, v.id, v.title, potSize]
                        );
                    }
                }
                // Ensure each plant size variant has its own plant inventory row
                await seedPlantInventoryForConfig(clientDb, configId);
            }
            const dbIdsRes = await clientDb.query(`SELECT shopify_product_id FROM product_pot_config`);
            const dbIds = dbIdsRes.rows.map(r => r.shopify_product_id);
            const staleIds = dbIds.filter(id => !productIds.includes(id.toString()) && !productIds.includes(Number(id)));
            if (staleIds.length) {
                await clientDb.query('DELETE FROM product_pot_config WHERE shopify_product_id = ANY($1)', [staleIds]);
            }
            await clientDb.query('COMMIT');
        } catch (e) {
            await clientDb.query('ROLLBACK');
            throw e;
        } finally {
            clientDb.release();
        }

        res.json({ success: true, synced: products.length, products });
    } catch (error) {
        console.error('Sync config error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/products - Get all products from Shopify for configuration
// GET /api/products/search?q=... - search the ENTIRE store by title
// (the default list only shows synced collections; this finds anything)
router.get('/search', async (req, res) => {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    const accessToken = process.env.ADMIN_API || process.env.SHOPIFY_ACCESS_TOKEN;
    if (!shop || !accessToken) return res.status(500).json({ error: 'Shopify credentials not configured' });
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    try {
        const gql = `{
          products(first: 20, query: "title:${q.replace(/["\\]/g, '')}* status:active") {
            nodes {
              legacyResourceId title
              featuredImage { url }
              variants(first: 50) {
                nodes { legacyResourceId title price inventoryQuantity selectedOptions { value } }
              }
            }
          }
        }`;
        const r = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
            method: 'POST',
            headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: gql })
        });
        if (!r.ok) throw new Error(`Shopify search failed (${r.status})`);
        const data = await r.json();
        const products = (data.data?.products?.nodes || []).map(p => ({
            id: parseInt(p.legacyResourceId),
            title: p.title,
            image: p.featuredImage ? { src: p.featuredImage.url } : null,
            variants: (p.variants?.nodes || []).map(v => ({
                id: parseInt(v.legacyResourceId),
                title: v.title,
                price: v.price,
                inventory_quantity: v.inventoryQuantity,
                option1: v.selectedOptions?.[0]?.value || v.title
            }))
        }));
        res.json(products);
    } catch (error) {
        console.error('Store search failed:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/', async (req, res) => {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    const accessToken = process.env.ADMIN_API || process.env.SHOPIFY_ACCESS_TOKEN;

    if (!accessToken) {
        // Fallback for local dev session
        try {
            const sessions = await shopify.config.sessionStorage.findSessionsByShop(shop);
            if (sessions && sessions.length > 0) {
                const session = sessions[0];
                const client = new shopify.api.clients.Rest({ session });
                const response = await client.get({ path: 'products' });
                return res.json(response.body.products);
            }
        } catch (e) {
            console.error("Local session lookup failed:", e);
        }
        return res.status(500).json({ error: 'SHOPIFY_ACCESS_TOKEN not found for syncing.' });
    }

    try {
        // Only pull products from the collections the user selected (Collections page).
        const collectionIds = await getSyncedCollectionIds();
        let products = [];

        if (collectionIds.length > 0) {
            console.log(`Fetching product IDs from selected collections: ${collectionIds.join(', ')}`);
            const productIds = await fetchProductIdsForCollections(shop, accessToken, collectionIds);

            // Fetch FULL product details in chunks (Shopify caps the ids param)
            for (let i = 0; i < productIds.length; i += 250) {
                const chunk = productIds.slice(i, i + 250);
                const url = `https://${shop}/admin/api/2023-10/products.json?ids=${chunk.join(',')}&limit=250`;
                const shopifyRes = await fetch(url, { headers: { 'X-Shopify-Access-Token': accessToken } });
                if (!shopifyRes.ok) throw new Error(await shopifyRes.text());
                const data = await shopifyRes.json();
                products = products.concat(data.products || []);
            }
        } else {
            // No collections chosen yet — return nothing rather than the whole catalog.
            console.log('No synced collections configured; returning empty product list. Pick collections on the Collections page.');
        }

        console.log(`Successfully fetched ${products.length} products from ${collectionIds.length} collection(s)`);
        res.json(products);
    } catch (error) {
        console.error('Fetch Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/products/:id/generate-variants
router.post('/:id/generate-variants', async (req, res) => {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    let accessToken = process.env.ADMIN_API || process.env.SHOPIFY_ACCESS_TOKEN;
    const { id } = req.params;
    const { sizesConfig, colors } = req.body;

    if (!accessToken) return res.status(500).json({ error: 'No access token found' });

    try {
        const variants = [];
        sizesConfig.forEach(sizeObj => {
            colors.forEach(color => {
                variants.push({
                    option1: sizeObj.name,
                    option2: color.name, // e.g. "White"
                    price: sizeObj.price,
                    inventory_management: 'shopify',
                    inventory_quantity: parseInt(sizeObj.inventory) || 0
                });
            });
        });

        // 1. Update the product to have the right options
        const shopifyResOptions = await fetch(`https://${shop}/admin/api/2023-10/products/${id}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
            body: JSON.stringify({
                product: {
                    id: id,
                    options: [
                        { name: "Size", values: sizesConfig.map(s => s.name) },
                        { name: "Color", values: colors.map(c => c.name) }
                    ],
                    variants: variants
                }
            })
        });

        if (!shopifyResOptions.ok) {
            const err = await shopifyResOptions.text();
            throw new Error(err);
        }

        const data = await shopifyResOptions.json();
        const shopifyProduct = data.product;

        // Auto-configure the product in our DB so it moves to "Configured Products"
        const clientDb = await pool.connect();
        try {
            await clientDb.query('BEGIN');
            const configResult = await clientDb.query(
                `INSERT INTO product_pot_config (shopify_product_id, product_title, no_pot_discount) VALUES ($1, $2, 10.00) ON CONFLICT (shopify_product_id) DO UPDATE SET product_title = EXCLUDED.product_title, updated_at = CURRENT_TIMESTAMP RETURNING *`,
                [shopifyProduct.id, shopifyProduct.title]
            );
            const configId = configResult.rows[0].id;

            // Clear old mappings just in case
            await clientDb.query('DELETE FROM size_mappings WHERE product_config_id = $1', [configId]);

            // Add new mappings safely
            if (shopifyProduct.variants && shopifyProduct.variants.length > 0) {
                for (const v of shopifyProduct.variants) {
                    const potSize = predictPotSize(v.option1 || v.title);
                    await clientDb.query(
                        `INSERT INTO size_mappings (product_config_id, shopify_variant_id, variant_title, pot_size) VALUES ($1, $2, $3, $4)`,
                        [configId, v.id, v.title, potSize]
                    );
                }
            }
            await seedPlantInventoryForConfig(clientDb, configId);
            await clientDb.query('COMMIT');
            await logActivity('PRODUCT_CONFIGURED', `Insta-built and configured product: ${shopifyProduct.title}`, { shopify_product_id: shopifyProduct.id });
        } catch (e) {
            await clientDb.query('ROLLBACK');
            console.error("Database Save Error:", e.message);
        } finally {
            clientDb.release();
        }

        res.json({ success: true, product: shopifyProduct });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});


// ─── NO-POT PRICING ─────────────────────────────────────────────────────────
const NO_POT_RE = /(no pot|without pot|bare ?root)/i;
const WITH_POT_RE = /with pot/i;
function isNoPotValue(v) { return NO_POT_RE.test(v || ''); }
function isWithPotValue(v) { const s = v || ''; return WITH_POT_RE.test(s) && !NO_POT_RE.test(s); }
function normalizeSizeLabel(s) {
    return (s || '').toLowerCase()
        .replace(/["\u201c\u201d]/g, ' inch')
        .replace(/gallons?\b/g, 'gal')
        .replace(/\bgal\./g, 'gal')
        .replace(/\bpot\b/g, '')
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// POST /api/products/:id/apply-no-pot-pricing
// (Route name kept for compatibility.) Applies pot pricing to one product via
// the shared service: With-Pot price = base sibling + pot price (+ adjust).
router.post('/:id/apply-no-pot-pricing', async (req, res) => {
    try {
        const result = await applyPotPricingToProduct(req.params.id);
        await logActivity('POT_PRICING_APPLIED', `Applied pot pricing to "${result.product}": ${result.updated.length} With-Pot variant(s) repriced`, { product_id: req.params.id, updated: result.updated, skipped: result.skipped });
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Failed to apply pot pricing:', error);
        res.status(500).json({ error: error.message });
    }
});

// ─── ONE-CLICK BUNDLE SETUP ─────────────────────────────────────────────────
// POST /api/products/:id/setup-bundle
// Takes any size-only plant product (or one already carrying a Pot option) and
// fully sets it up: adds the Pot (With Pot / Without Pot) option, creates and
// prices Without-Pot twins for pot-eligible sizes (2 inch & 5 gal+ stay
// bare-root), saves the config + size->pot mappings, seeds plant inventory
// from current Shopify stock, and mirrors stock to the twins.
router.post('/:id/setup-bundle', async (req, res) => {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    const accessToken = process.env.ADMIN_API || process.env.SHOPIFY_ACCESS_TOKEN;
    if (!shop || !accessToken) return res.status(500).json({ error: 'Shopify credentials not configured' });
    const headers = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };
    try {
        const { product_title, size_mappings: requestedMappings = [] } = req.body || {};

        let prodRes = await fetch(`https://${shop}/admin/api/2023-10/products/${req.params.id}.json`, { headers });
        if (!prodRes.ok) throw new Error(`Shopify product fetch failed (${prodRes.status})`);
        let product = (await prodRes.json()).product;

        // OLD-style product (Size x Pot Color x With/Without Pot)? Collapse it
        // to clean size-only variants first - fully automatic.
        let legacyConverted = false;
        if (isLegacyProduct(product)) {
            product = await collapseLegacyProduct(product);
            legacyConverted = true;
            await logActivity('LEGACY_PRODUCT_CONVERTED', `Collapsed old-style variants of "${product.title}" to size-only before bundle setup`, { product_id: product.id });
        }

        const rules = (await pool.query('SELECT plant_size, amount, pots_offered, bare_root_option FROM no_pot_discounts')).rows;
        const potPrices = (await pool.query('SELECT pot_size, price, no_pot_deduction FROM pot_prices')).rows;
        const { getSettingNum } = require('../services/settingsService');
        const defaultPotPrice = await getSettingNum('default_pot_price', 10);

        // size -> pot size: wizard mapping wins, else prediction per size label
        const sizeToPot = {};
        for (const m of requestedMappings) {
            sizeToPot[normSizeLabel((m.variant_title || '').split(' / ')[0])] = m.pot_size;
        }
        for (const v of product.variants) {
            const n = normSizeLabel(sizeLabelOfVariant(v));
            if (!sizeToPot[n]) sizeToPot[n] = predictPotSize(v.option1 || v.title);
        }
        // per-plant price adjusters survive re-runs (saved on size_mappings)
        const sizeAdjust = {};
        const oldCfg = await pool.query('SELECT id FROM product_pot_config WHERE shopify_product_id = $1', [product.id]);
        if (oldCfg.rows.length) {
            const oldMaps = await pool.query('SELECT variant_title, pot_price_adjust FROM size_mappings WHERE product_config_id = $1', [oldCfg.rows[0].id]);
            for (const m of oldMaps.rows) {
                const n = normSizeLabel((m.variant_title || '').split(' / ')[0]);
                if (parseFloat(m.pot_price_adjust)) sizeAdjust[n] = parseFloat(m.pot_price_adjust);
            }
        }
        for (const m of requestedMappings) {
            const n = normSizeLabel((m.variant_title || '').split(' / ')[0]);
            if (m.pot_price_adjust !== undefined && m.pot_price_adjust !== null && m.pot_price_adjust !== '') sizeAdjust[n] = parseFloat(m.pot_price_adjust) || 0;
        }

        // Edited prices from the wizard: base price (pushed to Shopify) and
        // with-pot TOTAL. A total that differs from base+standard+adjust becomes
        // a frozen manual override (skipped by store-wide standard repricing).
        const { potPriceForSize: ppfs } = require('../services/sizeRules');
        const sizeBase = {}, sizeOverride = {};
        for (const m of requestedMappings) {
            const n = normSizeLabel((m.variant_title || '').split(' / ')[0]);
            if (m.base_price !== undefined && m.base_price !== null && m.base_price !== '') sizeBase[n] = parseFloat(m.base_price);
            if (m.with_pot_price !== undefined && m.with_pot_price !== null && m.with_pot_price !== '') {
                const baseForCalc = sizeBase[n];
                const standard = ppfs(sizeToPot[n], potPrices, defaultPotPrice) + (sizeAdjust[n] || 0);
                const entered = Math.round(parseFloat(m.with_pot_price) * 100) / 100;
                if (baseForCalc === undefined || Math.round((baseForCalc + standard) * 100) / 100 !== entered) {
                    sizeOverride[n] = entered;
                }
            }
        }
        // overrides saved earlier survive re-runs unless the wizard sent new ones
        if (oldCfg.rows.length) {
            const prevOv = await pool.query('SELECT variant_title, with_pot_price_override FROM size_mappings WHERE product_config_id = $1 AND with_pot_price_override IS NOT NULL', [oldCfg.rows[0].id]);
            for (const m of prevOv.rows) {
                const n = normSizeLabel((m.variant_title || '').split(' / ')[0]);
                if (sizeOverride[n] === undefined && !requestedMappings.some(r => normSizeLabel((r.variant_title || '').split(' / ')[0]) === n && r.with_pot_price !== undefined)) {
                    sizeOverride[n] = parseFloat(m.with_pot_price_override);
                }
            }
        }

        const plan = buildSetupPlan(product, { rules, potPrices, sizeToPot, sizeAdjust, sizeBase, sizeOverride, defaultPotPrice });
        if (plan.error) return res.status(400).json({ error: plan.error });

        // 1. Add the Pot option and stamp existing variants
        if (plan.needsPotOption) {
            const putRes = await fetch(`https://${shop}/admin/api/2023-10/products/${product.id}.json`, {
                method: 'PUT', headers,
                body: JSON.stringify({ product: {
                    id: product.id,
                    options: [{ name: plan.sizeOptionName }, { name: 'Pot' }],
                    variants: product.variants.map(v => ({
                        id: v.id,
                        option1: v.option1,
                        option2: (plan.variantOption2.find(x => x.id === v.id) || {}).value || 'With Pot'
                    }))
                }})
            });
            if (!putRes.ok) throw new Error(`Failed to add Pot option: ${await putRes.text()}`);
        }

        // 2. Create Without-Pot twins for eligible sizes
        const createFailures = [];
        for (const cv of plan.createVariants) {
            const r = await fetch(`https://${shop}/admin/api/2023-10/products/${product.id}/variants.json`, {
                method: 'POST', headers,
                body: JSON.stringify({ variant: { option1: cv.option1, option2: cv.option2, price: cv.price, inventory_management: 'shopify' } })
            });
            if (!r.ok) createFailures.push({ size: cv.size, error: (await r.text()).slice(0, 200) });
        }

        // 3. Reprice existing twins that drifted from the discount table
        for (const rv of plan.repriceVariants) {
            await fetch(`https://${shop}/admin/api/2023-10/variants/${rv.id}.json`, {
                method: 'PUT', headers,
                body: JSON.stringify({ variant: { id: rv.id, price: rv.price } })
            });
        }

        // 4. Refetch to get the final variant set
        prodRes = await fetch(`https://${shop}/admin/api/2023-10/products/${product.id}.json`, { headers });
        product = (await prodRes.json()).product;

        // 5. Save config + size->pot mappings (wizard mapping wins, else prediction)
        const reqMap = new Map(requestedMappings.map(m => [normSizeLabel((m.variant_title || '').split(' / ')[0]), m.pot_size]));
        const clientDb = await pool.connect();
        let configId;
        try {
            await clientDb.query('BEGIN');
            const cfgRes = await clientDb.query(
                `INSERT INTO product_pot_config (shopify_product_id, product_title, no_pot_discount)
                 VALUES ($1, $2, 10.00)
                 ON CONFLICT (shopify_product_id)
                 DO UPDATE SET product_title = EXCLUDED.product_title, is_enabled = true, updated_at = CURRENT_TIMESTAMP
                 RETURNING id`,
                [product.id, product_title || product.title]
            );
            configId = cfgRes.rows[0].id;
            const imgUrl = (product.image && product.image.src) || (product.images && product.images[0] && product.images[0].src) || null;
            if (imgUrl) await clientDb.query('UPDATE product_pot_config SET product_image_url = $1 WHERE id = $2', [imgUrl, configId]);
            await clientDb.query('DELETE FROM size_mappings WHERE product_config_id = $1', [configId]);
            const baseBySize = {};
            for (const e of plan.sizes) baseBySize[normSizeLabel(e.size)] = e.base_used ?? null;
            for (const v of product.variants) {
                const label = sizeLabelOfVariant(v);
                const norm = normSizeLabel(label);
                const potSize = reqMap.get(norm) || predictPotSize(v.option1 || v.title);
                await clientDb.query(
                    `INSERT INTO size_mappings (product_config_id, shopify_variant_id, variant_title, pot_size, pot_price_adjust, with_pot_price_override, base_price) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [configId, v.id, v.title, potSize, sizeAdjust[norm] || 0, sizeOverride[norm] ?? null, baseBySize[norm] ?? null]
                );
            }
            await seedPlantInventoryForConfig(clientDb, configId);
            // Drop plant rows for variants that no longer exist (e.g. after legacy conversion)
            await clientDb.query(
                'DELETE FROM plant_inventory WHERE product_config_id = $1 AND NOT (shopify_variant_id = ANY($2))',
                [configId, product.variants.map(v => v.id)]
            );
            await clientDb.query('COMMIT');
        } catch (e) {
            await clientDb.query('ROLLBACK');
            throw e;
        } finally {
            clientDb.release();
        }

        // 6. Pull current Shopify stock into plant inventory, then mirror to twins.
        // Stock per SIZE = max across that size's variants (the original variant
        // holds the real count; a just-created twin is 0).
        const sizeGroups = new Map();
        for (const v of product.variants) {
            const n = normSizeLabel(sizeLabelOfVariant(v));
            if (!sizeGroups.has(n)) sizeGroups.set(n, []);
            sizeGroups.get(n).push(v);
        }
        for (const [, vars] of sizeGroups) {
            const qty = Math.max(...vars.map(v => v.inventory_quantity || 0));
            const skuV = vars.find(v => v.sku) || {};
            await pool.query(
                `UPDATE plant_inventory SET quantity = $1, sku = COALESCE($2, sku), barcode = COALESCE($3, barcode), updated_at = CURRENT_TIMESTAMP
                 WHERE shopify_variant_id = ANY($4)`,
                [qty, skuV.sku || null, skuV.barcode || null, vars.map(v => v.id)]
            );
        }
        const invRows = (await pool.query('SELECT shopify_variant_id, quantity FROM plant_inventory WHERE product_config_id = $1', [configId])).rows;
        for (const r of invRows) {
            syncPlantInventoryToShopify(product.id, r.shopify_variant_id, r.quantity)
                .catch(err => console.error(`Twin stock mirror failed for variant ${r.shopify_variant_id}:`, err));
        }

        await logActivity('BUNDLE_SETUP', `One-click bundle setup for "${product.title}": ${plan.createVariants.length} twin(s) created, ${plan.repriceVariants.length} repriced`, { product_id: product.id, plan: plan.sizes, createFailures });
        res.json({
            success: true,
            product: product.title,
            product_id: product.id,
            handle: product.handle,
            shop_domain: process.env.SHOPIFY_STORE_DOMAIN,
            legacy_converted: legacyConverted,
            sizes: plan.sizes,
            created: plan.createVariants.length - createFailures.length,
            repriced: plan.repriceVariants.length,
            failures: createFailures
        });
    } catch (error) {
        console.error('Bundle setup failed:', error);
        await logActivity('BUNDLE_SETUP_FAILED', `Bundle setup FAILED for product ${req.params.id}: ${error.message}`, { product_id: req.params.id, error: error.message }).catch(() => {});
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
