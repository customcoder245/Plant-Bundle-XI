const pool = require('../db/pool');

/**
 * getSyncedCollectionIds - The Shopify collection IDs the app should pull plant products from.
 * Uses the user-selected collections (synced_collections table). Falls back to the legacy
 * single SHOPIFY_COLLECTION_ID env var if nothing has been selected yet.
 * @returns {Promise<string[]>} array of collection IDs as strings
 */
async function getSyncedCollectionIds() {
    try {
        const r = await pool.query('SELECT shopify_collection_id FROM synced_collections');
        let ids = r.rows.map(x => String(x.shopify_collection_id));
        if (ids.length === 0 && process.env.SHOPIFY_COLLECTION_ID) {
            ids = [String(process.env.SHOPIFY_COLLECTION_ID)];
        }
        return ids;
    } catch (e) {
        // Table may not exist yet on a brand-new DB; fall back to env
        if (process.env.SHOPIFY_COLLECTION_ID) return [String(process.env.SHOPIFY_COLLECTION_ID)];
        return [];
    }
}

/**
 * fetchProductIdsForCollections - Union of product IDs across the given collections.
 */
async function fetchProductIdsForCollections(shop, token, collectionIds) {
    const headers = { 'X-Shopify-Access-Token': token };
    const idSet = new Set();
    for (const cid of collectionIds) {
        try {
            const res = await fetch(`https://${shop}/admin/api/2023-10/collections/${cid}/products.json?fields=id&limit=250`, { headers });
            if (!res.ok) {
                console.error(`Failed to fetch products for collection ${cid}:`, await res.text());
                continue;
            }
            const data = await res.json();
            for (const p of (data.products || [])) idSet.add(p.id);
        } catch (e) {
            console.error(`Error fetching products for collection ${cid}:`, e.message);
        }
    }
    return [...idSet];
}

module.exports = { getSyncedCollectionIds, fetchProductIdsForCollections };
