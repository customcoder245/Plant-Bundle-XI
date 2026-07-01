const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { logActivity } = require('../services/activityService');
const { applyPotPricingToAllProducts } = require('../services/potPricingService');

// ONE set of pots: each pot size has one price, used everywhere.
// GET /api/pot-prices
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM pot_prices ORDER BY pot_size');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/pot-prices - upsert { pot_size, price }
router.post('/', async (req, res) => {
    const { pot_size, price } = req.body;
    if (!pot_size || price === undefined || isNaN(parseFloat(price))) {
        return res.status(400).json({ error: 'pot_size and a numeric price are required' });
    }
    try {
        const ded = req.body.no_pot_deduction;
        const dedVal = (ded === undefined || ded === null || ded === '') ? null : parseFloat(ded);
        const result = await pool.query(
            `INSERT INTO pot_prices (pot_size, price, no_pot_deduction) VALUES ($1, $2, $3)
             ON CONFLICT (pot_size) DO UPDATE SET price = EXCLUDED.price, no_pot_deduction = EXCLUDED.no_pot_deduction, updated_at = CURRENT_TIMESTAMP
             RETURNING *`,
            [pot_size.trim(), parseFloat(price), dedVal]
        );
        await logActivity('POT_PRICE_SET', `Pot price for ${pot_size.trim()} set to $${parseFloat(price).toFixed(2)}`, { pot_size, price });

        // Dynamic store-wide pricing: changing a pot price reprices every
        // configured product's With-Pot variants (pass apply_to_products:false to skip)
        let repriced = null;
        if (req.body.apply_to_products !== false) {
            try {
                repriced = await applyPotPricingToAllProducts();
            } catch (e) {
                console.error('Store-wide repricing after pot price change failed:', e.message);
                repriced = { error: e.message };
            }
        }
        res.json({ ...result.rows[0], repriced });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/pot-prices/:id
router.delete('/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM pot_prices WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/pot-prices/reprice-all - manually re-push pot pricing to every product
router.post('/reprice-all', async (req, res) => {
    try {
        const result = await applyPotPricingToAllProducts();
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
