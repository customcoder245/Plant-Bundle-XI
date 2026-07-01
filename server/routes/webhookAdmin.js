const express = require('express');
const router = express.Router();
const { ensureWebhooks, listWebhooks, resolveAppUrl, TOPICS } = require('../services/webhookService');

// GET /api/webhook-admin/status - are order webhooks pointing at THIS server?
router.get('/status', async (req, res) => {
    try {
        const appUrl = resolveAppUrl();
        const all = await listWebhooks();
        const topics = TOPICS.map(topic => {
            const hooks = all.filter(w => w.topic === topic);
            const ok = appUrl ? hooks.some(w => w.address.startsWith(appUrl)) : false;
            return { topic, ok, addresses: hooks.map(w => w.address) };
        });
        res.json({ app_url: appUrl, all_ok: !!appUrl && topics.every(t => t.ok), topics });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/webhook-admin/register - (re)register them now
router.post('/register', async (req, res) => {
    try {
        const result = await ensureWebhooks();
        res.json({ success: result.errors.length === 0, ...result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
