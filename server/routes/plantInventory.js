const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { logActivity } = require('../services/activityService');
const inventoryService = require('../services/inventoryService');

// GET /api/plant-inventory - List plant stock (one row per plant size variant)
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT pli.id, pli.shopify_variant_id, pli.size, pli.sku, pli.barcode,
                   pli.quantity, pli.low_stock_threshold,
                   ppc.id AS product_config_id, ppc.product_title, ppc.shopify_product_id, ppc.product_image_url,
                   sm.variant_title, sm.pot_size AS mapped_pot_size,
                   CASE WHEN pli.quantity <= pli.low_stock_threshold THEN true ELSE false END AS is_low_stock
            FROM plant_inventory pli
            JOIN product_pot_config ppc ON pli.product_config_id = ppc.id
            LEFT JOIN size_mappings sm ON sm.shopify_variant_id = pli.shopify_variant_id
            WHERE ppc.is_enabled = true
            ORDER BY ppc.product_title, pli.size
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Failed to fetch plant inventory:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/plant-inventory/sync - Pull plant stock + SKU/barcode from Shopify
router.post('/sync', async (req, res) => {
    try {
        const result = await inventoryService.syncPlantInventoryFromShopify();
        await logActivity('PLANT_INVENTORY_SYNC', `Synced plant inventory from Shopify. Updated ${result.updatedCount} variants.`, { count: result.updatedCount });
        res.json(result);
    } catch (error) {
        console.error('Failed to sync plant inventory from Shopify:', error);
        res.status(500).json({ error: error.message });
    }
});


// PUT /api/plant-inventory/:id/mapping - change which pot size this plant size uses
router.put('/:id/mapping', async (req, res) => {
    const { id } = req.params;
    const { pot_size } = req.body;
    if (!pot_size) return res.status(400).json({ error: 'pot_size is required' });
    try {
        const pli = await pool.query('SELECT shopify_variant_id, product_config_id FROM plant_inventory WHERE id = $1', [id]);
        if (pli.rows.length === 0) return res.status(404).json({ error: 'Plant inventory record not found' });
        const { shopify_variant_id, product_config_id } = pli.rows[0];

        const upd = await pool.query(
            'UPDATE size_mappings SET pot_size = $1 WHERE shopify_variant_id = $2 RETURNING *',
            [pot_size, shopify_variant_id]
        );
        if (upd.rows.length === 0) {
            await pool.query(
                'INSERT INTO size_mappings (product_config_id, shopify_variant_id, pot_size) VALUES ($1, $2, $3)',
                [product_config_id, shopify_variant_id, pot_size]
            );
        }
        await logActivity('SIZE_MAPPING_UPDATED', `Plant variant ${shopify_variant_id} now maps to ${pot_size} pots`, { plant_inventory_id: id, pot_size });
        res.json({ success: true, pot_size });
    } catch (error) {
        console.error('Failed to update size mapping:', error);
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/plant-inventory/:id - Update one plant variant's stock / sku / barcode / threshold
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { quantity, low_stock_threshold, sku, barcode } = req.body;
    try {
        const result = await pool.query(
            `UPDATE plant_inventory
             SET quantity = COALESCE($1, quantity),
                 low_stock_threshold = COALESCE($2, low_stock_threshold),
                 sku = COALESCE($3, sku),
                 barcode = COALESCE($4, barcode),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $5
             RETURNING *`,
            [quantity, low_stock_threshold, sku, barcode, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Plant inventory record not found' });

        const row = result.rows[0];
        const cfg = await pool.query('SELECT shopify_product_id FROM product_pot_config WHERE id = $1', [row.product_config_id]);
        const shopifyProductId = cfg.rows[0]?.shopify_product_id;

        // Push stock + sku/barcode to the Shopify variant in the background
        inventoryService.syncPlantInventoryToShopify(shopifyProductId, row.shopify_variant_id, row.quantity, { sku: row.sku, barcode: row.barcode })
            .catch(err => console.error(`Failed to sync plant variant ${row.shopify_variant_id} to Shopify after update:`, err));

        await logActivity('PLANT_INVENTORY_UPDATED', `Updated plant inventory ID ${id} to quantity: ${row.quantity}`, { plant_inventory_id: id, quantity: row.quantity, sku: row.sku });
        res.json(row);
    } catch (error) {
        console.error('Failed to update plant inventory:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/plant-inventory/bulk-update - Save multiple rows at once
router.post('/bulk-update', async (req, res) => {
    const { updates } = req.body;
    try {
        const synced = [];
        for (const update of updates) {
            const result = await pool.query(
                `UPDATE plant_inventory
                 SET quantity = COALESCE($1, quantity),
                     low_stock_threshold = COALESCE($2, low_stock_threshold),
                     sku = COALESCE($3, sku),
                     barcode = COALESCE($4, barcode),
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $5
                 RETURNING *`,
                [update.quantity, update.low_stock_threshold, update.sku, update.barcode, update.id]
            );
            if (result.rows.length > 0) synced.push(result.rows[0]);
        }

        // Background-sync each changed variant to Shopify
        for (const row of synced) {
            const cfg = await pool.query('SELECT shopify_product_id FROM product_pot_config WHERE id = $1', [row.product_config_id]);
            const shopifyProductId = cfg.rows[0]?.shopify_product_id;
            inventoryService.syncPlantInventoryToShopify(shopifyProductId, row.shopify_variant_id, row.quantity, { sku: row.sku, barcode: row.barcode })
                .catch(err => console.error(`Failed to sync plant variant ${row.shopify_variant_id} after bulk update:`, err));
        }

        await logActivity('PLANT_INVENTORY_BULK_UPDATE', `Bulk updated ${synced.length} plant inventory items`, { count: synced.length });
        res.json({ success: true, updated: synced.length });
    } catch (error) {
        console.error('Failed to bulk update plant inventory:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
