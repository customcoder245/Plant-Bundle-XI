const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { logActivity } = require('../services/activityService');

// GET /api/no-pot-discounts - global No-Pot discount per plant size
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM no_pot_discounts ORDER BY plant_size');
        res.json(result.rows);
    } catch (error) {
        console.error('Failed to fetch no-pot discounts:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/no-pot-discounts - upsert { plant_size, amount }
router.post('/', async (req, res) => {
    const { plant_size, amount } = req.body;
    if (!plant_size || amount === undefined || amount === null || isNaN(parseFloat(amount))) {
        return res.status(400).json({ error: 'plant_size and a numeric amount are required' });
    }
    try {
        const potsOffered = req.body.pots_offered === undefined ? true : !!req.body.pots_offered;
        const bareRoot = req.body.bare_root_option === true ? true : req.body.bare_root_option === false ? false : null;
        const result = await pool.query(
            `INSERT INTO no_pot_discounts (plant_size, amount, pots_offered, bare_root_option)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (plant_size)
             DO UPDATE SET amount = EXCLUDED.amount, pots_offered = EXCLUDED.pots_offered, bare_root_option = EXCLUDED.bare_root_option, updated_at = CURRENT_TIMESTAMP
             RETURNING *`,
            [plant_size.trim(), parseFloat(amount), potsOffered, bareRoot]
        );
        await logActivity('NO_POT_DISCOUNT_SET', `No-Pot discount for "${plant_size.trim()}" set to $${parseFloat(amount).toFixed(2)}`, { plant_size, amount });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Failed to save no-pot discount:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/no-pot-discounts/:id
router.delete('/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM no_pot_discounts WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Failed to delete no-pot discount:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
