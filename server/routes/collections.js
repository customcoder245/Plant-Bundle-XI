const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { fetchProductIdsForCollections } = require('../services/collectionService');
const { logActivity } = require('../services/activityService');

function getCreds() {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    const token = process.env.ADMIN_API || process.env.SHOPIFY_ACCESS_TOKEN;
    return { shop, token };
}

// Fetch all collections (custom + smart) from Shopify
async function fetchShopifyCollections(shop, token) {
    const headers = { 'X-Shopify-Access-Token': token };
    const out = [];
    for (const kind of ['custom_collections', 'smart_collections']) {
        try {
            const res = await fetch(`https://${shop}/admin/api/2023-10/${kind}.json?limit=250`, { headers });
            if (!res.ok) {
                console.error(`Failed to fetch ${kind}:`, await res.text());
                continue;
            }
            const data = await res.json();
            const list = data[kind] || [];
            for (const c of list) {
                out.push({
                    id: c.id,
                    title: c.title,
                    handle: c.handle,
                    products_count: c.products_count ?? null,
                    type: kind === 'custom_collections' ? 'custom' : 'smart'
                });
            }
        } catch (e) {
            console.error(`Error fetching ${kind}:`, e.message);
        }
    }
    out.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    return out;
}

// GET /api/collections - list all Shopify collections, flagging which are selected
router.get('/', async (req, res) => {
    const { shop, token } = getCreds();
    if (!shop || !token) return res.status(500).json({ error: 'Shopify credentials not configured.' });
    try {
        const all = await fetchShopifyCollections(shop, token);
        const selRes = await pool.query('SELECT shopify_collection_id FROM synced_collections');
        const selected = new Set(selRes.rows.map(r => String(r.shopify_collection_id)));
        res.json(all.map(c => ({ ...c, selected: selected.has(String(c.id)) })));
    } catch (error) {
        console.error('List collections error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/collections/selected - the collections currently chosen to sync
// GET /api/collections/:collectionId/products - all products in one collection,
// with a configured flag, so the UI can bulk set up a whole collection.
router.get('/:collectionId/products', async (req, res) => {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    const token = process.env.ADMIN_API || process.env.SHOPIFY_ACCESS_TOKEN;
    if (!shop || !token) return res.status(500).json({ error: 'Shopify credentials not configured' });
    try {
        const ids = await fetchProductIdsForCollections(shop, token, [req.params.collectionId]);
        if (ids.length === 0) return res.json([]);
        const configured = new Set(
            (await pool.query('SELECT shopify_product_id FROM product_pot_config')).rows.map(r => r.shopify_product_id.toString())
        );
        const out = [];
        for (let i = 0; i < ids.length; i += 100) {
            const chunk = ids.slice(i, i + 100);
            const r = await fetch(`https://${shop}/admin/api/2023-10/products.json?ids=${chunk.join(',')}&limit=250&fields=id,title`, {
                headers: { 'X-Shopify-Access-Token': token }
            });
            if (!r.ok) continue;
            for (const p of (await r.json()).products || []) {
                out.push({ id: p.id, title: p.title, configured: configured.has(p.id.toString()) });
            }
        }
        res.json(out);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/selected', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM synced_collections ORDER BY title');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/collections/selected - replace the chosen collection set
// body: { collections: [{ id, title, handle }] }
router.post('/selected', async (req, res) => {
    const { collections } = req.body;
    if (!Array.isArray(collections)) return res.status(400).json({ error: 'collections array required' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM synced_collections');
        for (const c of collections) {
            if (c.id == null) continue;
            await client.query(
                `INSERT INTO synced_collections (shopify_collection_id, title, handle)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (shopify_collection_id) DO UPDATE SET title = EXCLUDED.title, handle = EXCLUDED.handle`,
                [c.id, c.title || null, c.handle || null]
            );
        }
        await client.query('COMMIT');
        await logActivity('COLLECTIONS_UPDATED', `Set ${collections.length} synced collection(s)`, { count: collections.length });
        res.json({ success: true, count: collections.length });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Save selected collections error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

module.exports = router;
