import React, { useState, useEffect } from 'react';
import {
    Page, Layout, Card, Text, BlockStack, List, Badge, InlineStack,
    TextField, Button, Banner, Divider, Checkbox, Select
} from '@shopify/polaris';
import { SaveIcon, DeleteIcon, PlusIcon } from '@shopify/polaris-icons';

/* ONE set of pots: each pot size has one standard price, added on top of the
   plant's base price whenever a customer picks that pot. */
function PotPrices() {
    const [rows, setRows] = useState([]);
    const [invSizes, setInvSizes] = useState([]);
    const [newSize, setNewSize] = useState('');
    const [newPrice, setNewPrice] = useState('10.00');
    const [newDeduction, setNewDeduction] = useState('');
    const [banner, setBanner] = useState(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => { fetchAll(); }, []);

    const fetchAll = async () => {
        try {
            const [pricesRes, invRes] = await Promise.all([
                fetch('/api/pot-prices'),
                fetch('/api/inventory')
            ]);
            const prices = await pricesRes.json();
            setRows(Array.isArray(prices) ? prices : []);
            const inv = await invRes.json();
            if (Array.isArray(inv)) setInvSizes([...new Set(inv.map(i => i.size).filter(Boolean))]);
        } catch (e) { console.error(e); }
    };

    const saveRow = async (pot_size, price, no_pot_deduction) => {
        setBusy(true); setBanner(null);
        try {
            const res = await fetch('/api/pot-prices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pot_size, price, no_pot_deduction: no_pot_deduction === '' ? null : no_pot_deduction })
            });
            if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Save failed'); }
            const data = await res.json();
            const r = data.repriced;
            setBanner({
                tone: 'success',
                content: r && !r.error
                    ? `${pot_size} pot → +$${parseFloat(price).toFixed(2)}. Automatically repriced ${r.totalUpdated} With-Pot variant(s) across ${r.products} product(s) in Shopify.`
                    : `${pot_size} pot → +$${parseFloat(price).toFixed(2)} saved.${r?.error ? ' Store-wide repricing failed: ' + r.error : ''}`
            });
            setNewSize(''); setNewPrice('10.00'); setNewDeduction('');
            fetchAll();
        } catch (e) { setBanner({ tone: 'critical', content: e.message }); }
        finally { setBusy(false); }
    };

    const deleteRow = async (id) => { await fetch(`/api/pot-prices/${id}`, { method: 'DELETE' }); fetchAll(); };
    const updateLocal = (id, patch) => setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    // Same loose matching the pricing engine uses: '6" Pot', '6 inch' and '6"' are one size
    const normSize = (t) => (t || '').toLowerCase()
        .replace(/["“”]/g, ' inch').replace(/gallons?\b/g, 'gal').replace(/\bgal\./g, 'gal')
        .replace(/\bpot\b/g, '').replace(/[^a-z0-9. ]/g, ' ').replace(/\s+/g, ' ').trim();
    const missingSizes = invSizes.filter(s => !rows.some(r => normSize(r.pot_size) === normSize(s)));

    return (
        <Card>
            <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Pot prices — one set of pots</Text>
                <Text as="p" tone="subdued">
                    Two numbers per pot size: what the pot ADDS to the plant's base price, and what
                    "No Pot" SAVES off the with-pot price (blank = saves the full pot price).
                    Example: 6" adds $15, No Pot saves $10 → a $19.25 plant sells at $34.25 with pot,
                    $24.25 without. Fully dynamic: saving here reprices every configured product in
                    Shopify automatically. Per-plant price adjusters are in Houseplants → Edit.
                </Text>
                {banner && <Banner tone={banner.tone} onDismiss={() => setBanner(null)}><p>{banner.content}</p></Banner>}

                {rows.map(r => (
                    <InlineStack key={r.id} gap="300" blockAlign="center" wrap={false}>
                        <div style={{ flex: 2 }}><Text variant="bodyMd" fontWeight="semibold">{r.pot_size} pot</Text></div>
                        <div style={{ flex: 1 }}>
                            <TextField label="Pot adds" type="number" prefix="+$"
                                value={r.price?.toString() ?? ''} onChange={(v) => updateLocal(r.id, { price: v })} autoComplete="off" />
                        </div>
                        <div style={{ flex: 1 }}>
                            <TextField label="No Pot saves" type="number" prefix="−$"
                                placeholder={parseFloat(r.price || 0).toFixed(2)}
                                helpText="blank = full pot price"
                                value={(r.no_pot_deduction ?? '').toString()}
                                onChange={(v) => updateLocal(r.id, { no_pot_deduction: v })} autoComplete="off" />
                        </div>
                        <Button icon={SaveIcon} onClick={() => saveRow(r.pot_size, r.price, r.no_pot_deduction ?? '')} loading={busy} accessibilityLabel={`Save ${r.pot_size}`} />
                        <Button icon={DeleteIcon} tone="critical" variant="tertiary" onClick={() => deleteRow(r.id)} accessibilityLabel={`Delete ${r.pot_size}`} />
                    </InlineStack>
                ))}

                {missingSizes.length > 0 && (
                    <Banner tone="warning">
                        <p>Pot sizes in your inventory without a price yet: {missingSizes.join(', ')} (they fall back to $10).</p>
                    </Banner>
                )}

                <Divider />
                <InlineStack gap="300" blockAlign="end" wrap={false}>
                    <div style={{ flex: 2 }}>
                        {missingSizes.length > 0
                            ? <Select label="Pot size" options={[{ label: 'Choose…', value: '' }, ...missingSizes.map(s => ({ label: s, value: s }))]} value={newSize} onChange={setNewSize} />
                            : <TextField label="Pot size" placeholder='e.g. 6", 1 gal' value={newSize} onChange={setNewSize} autoComplete="off" />}
                    </div>
                    <div style={{ flex: 1 }}>
                        <TextField label="Pot adds" type="number" prefix="+$" value={newPrice} onChange={setNewPrice} autoComplete="off" />
                    </div>
                    <div style={{ flex: 1 }}>
                        <TextField label="No Pot saves" type="number" prefix="−$" placeholder="= pot price" value={newDeduction} onChange={setNewDeduction} autoComplete="off" />
                    </div>
                    <Button icon={PlusIcon} variant="primary" disabled={!newSize.trim()} onClick={() => saveRow(newSize, newPrice, newDeduction)} loading={busy}>Add</Button>
                </InlineStack>
            </BlockStack>
        </Card>
    );
}

/* Per plant-size behavior. Built-in defaults: 2 inch & 5 gal+ = no pot UI;
   4 inch = pot mandatory (no bare-root choice); everything else = optional. */
function PlantSizeRules() {
    const [rows, setRows] = useState([]);
    const [newSize, setNewSize] = useState('');
    const [newMode, setNewMode] = useState('optional');
    const [banner, setBanner] = useState(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => { fetchRows(); }, []);
    const fetchRows = async () => {
        try {
            const res = await fetch('/api/no-pot-discounts');
            const data = await res.json();
            setRows(Array.isArray(data) ? data : []);
        } catch (e) { console.error(e); }
    };

    const modeOf = (r) => r.pots_offered === false ? 'none' : (r.bare_root_option === false ? 'required' : 'optional');
    const normRule = (t) => (t || '').toLowerCase().replace(/["“”]/g, ' inch').replace(/gallons?\b/g, 'gal').replace(/\bgal\./g, 'gal').replace(/\bpot\b/g, '').replace(/[^a-z0-9. ]/g, ' ').replace(/\s+/g, ' ').trim();
    // Built-in defaults shown as editable rows; changing one saves a real override
    const BUILTINS = [
        { plant_size: '2 inch', mode: 'none', note: 'built-in default' },
        { plant_size: '4 inch', mode: 'required', note: 'built-in default' },
        { plant_size: '5 gal', mode: 'none', note: 'built-in default (applies to 5 gal and larger)' }
    ];
    const overridden = new Set(rows.map(r => normRule(r.plant_size)));
    const builtinRows = BUILTINS.filter(b => !overridden.has(normRule(b.plant_size)));
    const saveRow = async (plant_size, mode) => {
        setBusy(true); setBanner(null);
        try {
            const body = {
                plant_size, amount: 0,
                pots_offered: mode !== 'none',
                bare_root_option: mode === 'none' ? null : mode === 'optional'
            };
            const res = await fetch('/api/no-pot-discounts', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            });
            if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Save failed'); }
            setBanner({ tone: 'success', content: `Saved rule for ${plant_size}.` });
            setNewSize('');
            fetchRows();
        } catch (e) { setBanner({ tone: 'critical', content: e.message }); }
        finally { setBusy(false); }
    };
    const deleteRow = async (id) => { await fetch(`/api/no-pot-discounts/${id}`, { method: 'DELETE' }); fetchRows(); };

    const modeOptions = [
        { label: 'Pot optional (base price + pot, No-Pot choice shown)', value: 'optional' },
        { label: 'Pot always included (no bare-root choice, like 4 inch)', value: 'required' },
        { label: 'No pots — bare-root / as-is (like 2 inch, 5 gal+)', value: 'none' }
    ];

    return (
        <Card>
            <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Plant size rules</Text>
                <Text as="p" tone="subdued">
                    Built-in defaults: 2 inch and 5 gal+ have no pot UI; 4 inch always includes the
                    decorative pot; all other sizes offer the choice. Add a row only to override a size.
                    Per-product overrides are in Product Config → Edit.
                </Text>
                {banner && <Banner tone={banner.tone} onDismiss={() => setBanner(null)}><p>{banner.content}</p></Banner>}

                {builtinRows.map(b => (
                    <InlineStack key={'b-' + b.plant_size} gap="300" blockAlign="center" wrap={false}>
                        <div style={{ flex: 1 }}>
                            <Text variant="bodyMd" fontWeight="semibold">{b.plant_size}</Text>
                            <Text variant="bodyXs" tone="subdued">{b.note}</Text>
                        </div>
                        <div style={{ flex: 3 }}>
                            <Select label="Rule" labelHidden options={modeOptions} value={b.mode}
                                onChange={(v) => saveRow(b.plant_size, v)} />
                        </div>
                        <div style={{ width: 64 }}><Badge>Default</Badge></div>
                    </InlineStack>
                ))}
                {rows.map(r => (
                    <InlineStack key={r.id} gap="300" blockAlign="center" wrap={false}>
                        <div style={{ flex: 1 }}><Text variant="bodyMd" fontWeight="semibold">{r.plant_size}</Text></div>
                        <div style={{ flex: 3 }}>
                            <Select label="Rule" labelHidden options={modeOptions} value={modeOf(r)}
                                onChange={(v) => setRows(prev => prev.map(x => x.id === r.id ? { ...x, pots_offered: v !== 'none', bare_root_option: v === 'none' ? null : v === 'optional' } : x))} />
                        </div>
                        <Button icon={SaveIcon} onClick={() => saveRow(r.plant_size, modeOf(r))} loading={busy} accessibilityLabel={`Save ${r.plant_size}`} />
                        <Button icon={DeleteIcon} tone="critical" variant="tertiary" onClick={() => deleteRow(r.id)} accessibilityLabel={`Delete ${r.plant_size}`} />
                    </InlineStack>
                ))}

                <Divider />
                <InlineStack gap="300" blockAlign="end" wrap={false}>
                    <div style={{ flex: 1 }}>
                        <TextField label="Plant size" placeholder='e.g. 5 gal' value={newSize} onChange={setNewSize} autoComplete="off" />
                    </div>
                    <div style={{ flex: 3 }}>
                        <Select label="Rule" options={modeOptions} value={newMode} onChange={setNewMode} />
                    </div>
                    <Button icon={PlusIcon} variant="primary" disabled={!newSize.trim()} onClick={() => saveRow(newSize, newMode)} loading={busy}>Add</Button>
                </InlineStack>
            </BlockStack>
        </Card>
    );
}

function OrderWebhooks() {
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState(false);
    const [banner, setBanner] = useState(null);

    const fetchStatus = async () => {
        try {
            const res = await fetch('/api/webhook-admin/status');
            const d = await res.json();
            setStatus(res.ok ? d : { error: d.error });
        } catch (e) { setStatus({ error: e.message }); }
    };
    useEffect(() => { fetchStatus(); }, []);

    const register = async () => {
        setBusy(true); setBanner(null);
        try {
            const res = await fetch('/api/webhook-admin/register', { method: 'POST' });
            const d = await res.json();
            if (res.ok && d.success) setBanner({ tone: 'success', content: `Webhooks registered to ${d.appUrl}. Orders will now deduct plant & pot stock.` });
            else throw new Error((d.errors || [d.error]).join('; ') || 'Registration failed');
            fetchStatus();
        } catch (e) { setBanner({ tone: 'critical', content: e.message }); }
        finally { setBusy(false); }
    };

    return (
        <Card>
            <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Order webhooks — inventory deduction</Text>
                <Text as="p" tone="subdued">
                    These tell the app about new and cancelled orders so plant and pot stock deduct and
                    restore automatically. They self-register on every server start; this shows their health.
                </Text>
                {banner && <Banner tone={banner.tone} onDismiss={() => setBanner(null)}><p>{banner.content}</p></Banner>}
                {!status ? <Text tone="subdued">Checking…</Text> : status.error ? (
                    <Banner tone="critical"><p>{status.error}</p></Banner>
                ) : (
                    <BlockStack gap="200">
                        {!status.app_url && (
                            <Banner tone="critical" title="No server URL configured">
                                <p>Set the APP_URL environment variable to this server's public URL (e.g. https://your-app.up.railway.app) and restart. Without it, orders will NOT deduct inventory.</p>
                            </Banner>
                        )}
                        {(status.topics || []).map(t => (
                            <InlineStack key={t.topic} gap="200" blockAlign="center">
                                <Badge tone={t.ok ? 'success' : 'critical'}>{t.ok ? 'OK' : 'NOT REGISTERED'}</Badge>
                                <Text variant="bodyMd" fontWeight="semibold">{t.topic}</Text>
                                <Text tone="subdued" variant="bodySm">{t.addresses[0] || 'no registration found'}</Text>
                            </InlineStack>
                        ))}
                        <InlineStack gap="200">
                            <Button variant="primary" onClick={register} loading={busy}>Register / repair now</Button>
                            <Button variant="tertiary" onClick={fetchStatus}>Refresh</Button>
                        </InlineStack>
                    </BlockStack>
                )}
            </BlockStack>
        </Card>
    );
}

function LowStockAlerts() {
    const [vals, setVals] = useState({ pot_low_stock_threshold: '10', plant_low_stock_threshold: '10', dashboard_max_pot_alerts: '5', dashboard_max_plant_alerts: '5', default_pot_price: '10', no_pot_subtext: 'Plant will be shipped bare-root' });
    const [busy, setBusy] = useState(false);
    const [banner, setBanner] = useState(null);
    useEffect(() => { (async () => {
        try {
            const res = await fetch('/api/app-settings');
            const d = await res.json();
            if (res.ok) setVals(prev => ({ ...prev, ...Object.fromEntries(Object.keys(prev).map(k => [k, String(d[k] ?? prev[k])])) }));
        } catch (e) { console.error(e); }
    })(); }, []);
    const set = (k) => (v) => setVals(prev => ({ ...prev, [k]: v }));
    const save = async () => {
        setBusy(true); setBanner(null);
        try {
            const body = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, k === 'no_pot_subtext' ? v : (parseFloat(v) || 1)]));
            const res = await fetch('/api/app-settings', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!res.ok) throw new Error('Save failed');
            setBanner({ tone: 'success', content: 'Saved — the Dashboard panels follow these settings.' });
        } catch (e) { setBanner({ tone: 'critical', content: e.message }); }
        finally { setBusy(false); }
    };
    return (
        <Card>
            <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Dashboard alerts & app defaults</Text>
                <Text as="p" tone="subdued">
                    When a pot variant or a plant size drops below its threshold it appears in the
                    Dashboard low-stock panels. The "show" numbers control how many lines each panel
                    lists before the "View all" link.
                </Text>
                {banner && <Banner tone={banner.tone} onDismiss={() => setBanner(null)}><p>{banner.content}</p></Banner>}
                <InlineStack gap="300" blockAlign="end" wrap>
                    <div style={{ width: 150 }}>
                        <TextField label="Pots: alert below" type="number" value={vals.pot_low_stock_threshold} onChange={set('pot_low_stock_threshold')} autoComplete="off" />
                    </div>
                    <div style={{ width: 150 }}>
                        <TextField label="Plants: alert below" type="number" value={vals.plant_low_stock_threshold} onChange={set('plant_low_stock_threshold')} autoComplete="off" />
                    </div>
                    <div style={{ width: 150 }}>
                        <TextField label="Show max pots" type="number" value={vals.dashboard_max_pot_alerts} onChange={set('dashboard_max_pot_alerts')} autoComplete="off" />
                    </div>
                    <div style={{ width: 150 }}>
                        <TextField label="Show max plants" type="number" value={vals.dashboard_max_plant_alerts} onChange={set('dashboard_max_plant_alerts')} autoComplete="off" />
                    </div>
                </InlineStack>
                <InlineStack gap="300" blockAlign="end" wrap>
                    <div style={{ width: 180 }}>
                        <TextField label="Default pot price" type="number" prefix="+$" helpText="Used when a pot size has no price row" value={vals.default_pot_price} onChange={set('default_pot_price')} autoComplete="off" />
                    </div>
                    <div style={{ minWidth: 320, flex: 1 }}>
                        <TextField label="No-Pot text on product pages" helpText='Shows after "SAVE $X –" on the storefront' value={vals.no_pot_subtext} onChange={set('no_pot_subtext')} autoComplete="off" />
                    </div>
                    <Button variant="primary" onClick={save} loading={busy}>Save</Button>
                </InlineStack>
            </BlockStack>
        </Card>
    );
}

function Settings() {
    const [syncing, setSyncing] = useState(false);
    const [syncBanner, setSyncBanner] = useState(null);
    const runSync = async () => {
        setSyncing(true); setSyncBanner(null);
        try {
            const res = await fetch('/api/plant-inventory/sync', { method: 'POST' });
            const d = await res.json();
            if (res.ok && d.success) setSyncBanner({ tone: 'success', content: `Synced with Shopify — ${d.updatedCount} plant size(s) updated.` });
            else throw new Error(d.error || 'Sync failed');
        } catch (e) { setSyncBanner({ tone: 'critical', content: e.message }); }
        finally { setSyncing(false); }
    };
    return (
        <Page
            title="Settings"
            primaryAction={{ content: 'Sync products from Shopify', onAction: runSync, loading: syncing }}
        >
            <Layout>
                {syncBanner && (
                    <Layout.Section>
                        <Banner tone={syncBanner.tone} onDismiss={() => setSyncBanner(null)}><p>{syncBanner.content}</p></Banner>
                    </Layout.Section>
                )}
                <Layout.Section>
                    <PotPrices />
                </Layout.Section>

                <Layout.Section>
                    <PlantSizeRules />
                </Layout.Section>

                <Layout.Section>
                    <LowStockAlerts />
                </Layout.Section>

                <Layout.Section>
                    <OrderWebhooks />
                </Layout.Section>

                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text variant="headingMd" as="h2">System Configuration</Text>
                            <Text as="p">Your app is currently using the <strong>Admin API Token</strong> from your environment variables for Shopify communication.</Text>
                            <InlineStack gap="200">
                                <Badge tone="success">Connected to API</Badge>
                                <Badge tone="info">Railway Environment</Badge>
                            </InlineStack>
                        </BlockStack>
                    </Card>
                </Layout.Section>

                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text variant="headingMd" as="h2">Webhook Configuration</Text>
                            <Text as="p">If you are moving from local development to Railway, these webhooks should be updated in your Shopify App setup:</Text>
                            <List>
                                <List.Item>Orders Create: <code>/api/webhooks/orders/create</code></List.Item>
                                <List.Item>Orders Cancelled: <code>/api/webhooks/orders/cancelled</code></List.Item>
                            </List>
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}

export default Settings;
