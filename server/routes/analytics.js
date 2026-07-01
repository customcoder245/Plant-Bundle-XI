const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// POST /api/analytics/view - storefront beacon: one product-page view
router.post('/view', async (req, res) => {
    const productId = parseInt(req.body && req.body.product_id);
    if (!productId) return res.status(400).json({ error: 'product_id required' });
    try {
        // only count views for products the app manages
        const cfg = await pool.query('SELECT 1 FROM product_pot_config WHERE shopify_product_id = $1', [productId]);
        if (cfg.rows.length === 0) return res.json({ ok: true, ignored: true });
        await pool.query(
            `INSERT INTO product_views_daily (shopify_product_id, day, views) VALUES ($1, CURRENT_DATE, 1)
             ON CONFLICT (shopify_product_id, day) DO UPDATE SET views = product_views_daily.views + 1`,
            [productId]
        );
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/analytics/daily?days=30 - units & revenue per day (for the trend chart)
router.get('/daily', async (req, res) => {
    const days = Math.max(1, Math.min(365, parseInt(req.query.days) || 30));
    try {
        const rows = (await pool.query(
            `SELECT created_at::date AS day, COALESCE(SUM(quantity),0) AS units, COALESCE(SUM(revenue),0) AS revenue
             FROM houseplant_sales
             WHERE created_at > NOW() - ($1 || ' days')::interval
             GROUP BY created_at::date
             ORDER BY day`, [days])).rows;
        res.json(rows.map(r => ({ day: r.day, units: parseInt(r.units), revenue: parseFloat(r.revenue) })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/analytics/summary?days=30 - everything the Analytics page needs
router.get('/summary', async (req, res) => {
    const days = Math.max(1, Math.min(3650, parseInt(req.query.days) || 30));
    try {
        const totals = (await pool.query(
            `SELECT COALESCE(SUM(quantity),0) AS units, COALESCE(SUM(revenue),0) AS revenue,
                    COALESCE(SUM(CASE WHEN with_pot THEN quantity ELSE 0 END),0) AS with_pot_units
             FROM houseplant_sales WHERE created_at > NOW() - ($1 || ' days')::interval`, [days])).rows[0];
        const viewsRow = (await pool.query(
            `SELECT COALESCE(SUM(views),0) AS views FROM product_views_daily WHERE day > CURRENT_DATE - $1::int`, [days])).rows[0];
        const plants = (await pool.query(
            `SELECT s.shopify_product_id, MAX(s.product_title) AS title,
                    SUM(s.quantity) AS units, SUM(s.revenue) AS revenue,
                    SUM(CASE WHEN s.with_pot THEN s.quantity ELSE 0 END) AS with_pot_units,
                    COALESCE(v.views, 0) AS views
             FROM houseplant_sales s
             LEFT JOIN (
                SELECT shopify_product_id, SUM(views) AS views
                FROM product_views_daily WHERE day > CURRENT_DATE - $1::int
                GROUP BY shopify_product_id
             ) v ON v.shopify_product_id = s.shopify_product_id
             WHERE s.created_at > NOW() - ($1 || ' days')::interval
             GROUP BY s.shopify_product_id, v.views
             ORDER BY SUM(s.revenue) DESC
             LIMIT 100`, [days])).rows;
        // viewed but never sold (still interesting)
        const viewedOnly = (await pool.query(
            `SELECT v.shopify_product_id, MAX(p.product_title) AS title, SUM(v.views) AS views
             FROM product_views_daily v
             JOIN product_pot_config p ON p.shopify_product_id = v.shopify_product_id
             WHERE v.day > CURRENT_DATE - $1::int
               AND v.shopify_product_id NOT IN (SELECT DISTINCT shopify_product_id FROM houseplant_sales WHERE created_at > NOW() - ($1 || ' days')::interval)
             GROUP BY v.shopify_product_id ORDER BY SUM(v.views) DESC LIMIT 20`, [days])).rows;
        res.json({
            days,
            totals: {
                units: parseInt(totals.units), revenue: parseFloat(totals.revenue),
                with_pot_units: parseInt(totals.with_pot_units), views: parseInt(viewsRow.views)
            },
            plants: plants.map(p => ({
                shopify_product_id: p.shopify_product_id, title: p.title,
                units: parseInt(p.units), revenue: parseFloat(p.revenue),
                with_pot_units: parseInt(p.with_pot_units), views: parseInt(p.views),
                conversion: parseInt(p.views) > 0 ? Math.round((parseInt(p.units) / parseInt(p.views)) * 1000) / 10 : null
            })),
            viewed_no_sale: viewedOnly.map(v => ({ shopify_product_id: v.shopify_product_id, title: v.title, views: parseInt(v.views) }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
