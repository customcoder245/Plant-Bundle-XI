const { logActivity } = require('./activityService');

// Order webhooks are how the app hears about sales: no webhooks = no plant/pot
// deduction. This service keeps them registered automatically.
const TOPICS = ['orders/create', 'orders/cancelled', 'orders/refunded'];

function resolveAppUrl() {
    if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
    if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
    return null;
}

async function listWebhooks() {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    const token = process.env.ADMIN_API || process.env.SHOPIFY_ACCESS_TOKEN;
    if (!shop || !token) throw new Error('Shopify credentials not configured');
    const r = await fetch(`https://${shop}/admin/api/2023-10/webhooks.json?limit=100`, {
        headers: { 'X-Shopify-Access-Token': token }
    });
    if (!r.ok) throw new Error(`Webhook list failed (${r.status})`);
    return (await r.json()).webhooks || [];
}

/**
 * ensureWebhooks - register orders/create|cancelled|refunded against THIS server.
 * Replaces stale registrations (old tunnel/Railway URLs) for our topics.
 * Safe to run on every boot.
 */
async function ensureWebhooks() {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    const token = process.env.ADMIN_API || process.env.SHOPIFY_ACCESS_TOKEN;
    const appUrl = resolveAppUrl();
    const result = { appUrl, registered: [], replaced: [], kept: [], errors: [] };
    if (!shop || !token) { result.errors.push('Shopify credentials not configured'); return result; }
    if (!appUrl) { result.errors.push('No APP_URL or RAILWAY_PUBLIC_DOMAIN env var - cannot register webhooks'); return result; }

    const headers = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };
    let existing;
    try { existing = await listWebhooks(); }
    catch (e) { result.errors.push(e.message); return result; }

    for (const topic of TOPICS) {
        const address = `${appUrl}/webhooks/${topic.replace('orders/', 'orders/')}`;
        const mine = existing.filter(w => w.topic === topic);
        const correct = mine.find(w => w.address === address);
        if (correct) { result.kept.push(topic); continue; }
        // remove stale registrations for this topic (old URLs)
        for (const stale of mine) {
            await fetch(`https://${shop}/admin/api/2023-10/webhooks/${stale.id}.json`, { method: 'DELETE', headers });
            result.replaced.push({ topic, old_address: stale.address });
        }
        const r = await fetch(`https://${shop}/admin/api/2023-10/webhooks.json`, {
            method: 'POST', headers,
            body: JSON.stringify({ webhook: { topic, address, format: 'json' } })
        });
        if (r.ok) result.registered.push(topic);
        else result.errors.push(`${topic}: ${(await r.text()).slice(0, 200)}`);
    }
    if (result.registered.length || result.replaced.length) {
        await logActivity('WEBHOOKS_REGISTERED', `Order webhooks registered to ${appUrl} (${result.registered.length} new, ${result.replaced.length} replaced)`, result).catch(() => {});
    }
    console.log('Webhook check:', JSON.stringify({ appUrl, kept: result.kept, registered: result.registered, replaced: result.replaced.length, errors: result.errors }));
    return result;
}

module.exports = { ensureWebhooks, listWebhooks, resolveAppUrl, TOPICS };
