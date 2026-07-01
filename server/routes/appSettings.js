const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

const DEFAULTS = { pot_low_stock_threshold: '10', plant_low_stock_threshold: '10', dashboard_max_pot_alerts: '5', dashboard_max_plant_alerts: '5', default_pot_price: '10', no_pot_subtext: 'Plant will be shipped bare-root' };

// GET /api/app-settings - all settings with defaults filled in
router.get('/', async (req, res) => {
    try {
        const rows = (await pool.query('SELECT key, value FROM app_settings')).rows;
        const out = { ...DEFAULTS };
        for (const r of rows) out[r.key] = r.value;
        res.json(out);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/app-settings - upsert { key: value, ... }
router.post('/', async (req, res) => {
    try {
        const entries = Object.entries(req.body || {}).filter(([k]) => k in DEFAULTS);
        for (const [k, v] of entries) {
            await pool.query(
                `INSERT INTO app_settings (key, value) VALUES ($1, $2)
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
                [k, String(v)]
            );
        }
        res.json({ success: true, saved: entries.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
