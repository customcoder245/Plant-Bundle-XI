const pool = require('../db/pool');

// Hardcoded default collections: Houseplants (planetdesert.com/collections/houseplants-for-sale)
// and Living Gifts (planetdesert.com/collections/living-gifts). These are the only two
// collections the app needs to sync from. Kept as a code-level default (not just the
// SHOPIFY_COLLECTION_ID env var, which still points at a leftover "Testing Collection")
// so product sync works correctly even if the in-app Collections picker page is unavailable.
const DEFAULT_COLLECTION_IDS = ['461170737395', '446252318963']; // Houseplants, Living Gifts

/**
 * getSyncedCollectionIds - The Shopify collection IDs the app should pull plant products from.
 * Uses the user-selected collections (synced_collections table) if any have been saved there.
 * Otherwise falls back to the hardcoded Houseplants + Living Gifts collection IDs above.
 * @returns {Promise<string[]>} array of collection IDs as strings
 */
async function getSyncedCollectionIds() {
    try {
        const r = await pool.query('SELECT shopify_collection_id FROM synced_collections');
        const ids = r.rows.map(x => String(x.shopify_collection_id));
        if (ids.length > 0) return ids;
        return DEFAULT_COLLECTION_IDS;
    } catch (e) {
        // Table may not exist yet on a brand-new DB; fall back to the hardcoded defaults
        return DEFAULT_COLLECTION_IDS;
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
            const res = await fetch(`https://${shop}/admin/api/2026-07/collections/${cid}/products.json?fields=id&limit=250`, { headers });
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
