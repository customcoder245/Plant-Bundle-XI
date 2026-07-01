import React, { useState, useEffect } from 'react';
import {
    Page, Card, ResourceList, ResourceItem, Checkbox,
    Button, InlineStack, Badge, Text, Banner, BlockStack,
    Box, Divider, EmptyState, SkeletonBodyText, TextField,
    Modal, ProgressBar
} from '@shopify/polaris';
import { SaveIcon, RefreshIcon, SearchIcon } from '@shopify/polaris-icons';

// Lets the user choose which Shopify collections the app pulls plant products from,
// so a 2000-product store only syncs the handful of plant collections that matter.
function Collections() {
    const [collections, setCollections] = useState([]);
    const [selected, setSelected] = useState({}); // id -> bool
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [query, setQuery] = useState('');
    const [banner, setBanner] = useState(null);

    useEffect(() => { fetchCollections(); }, []);

    const fetchCollections = async () => {
        setLoading(true);
        setBanner(null);
        try {
            const res = await fetch('/api/collections');
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load collections');
            const list = Array.isArray(data) ? data : [];
            setCollections(list);
            const sel = {};
            list.forEach(c => { if (c.selected) sel[c.id] = true; });
            setSelected(sel);
        } catch (error) {
            setBanner({ tone: 'critical', title: 'Could not load collections', content: error.message });
        } finally {
            setLoading(false);
        }
    };

    const toggle = (id) => setSelected(prev => ({ ...prev, [id]: !prev[id] }));

    // ── Bulk setup: configure every plant in a collection in one go ──
    const [bulk, setBulk] = useState(null); // { collection, products, done, results, running, finished }
    const startBulk = async (c) => {
        setBulk({ collection: c, products: null, done: 0, results: [], running: false, finished: false });
        try {
            const res = await fetch(`/api/collections/${c.id}/products`);
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'Could not load products');
            setBulk(prev => ({ ...prev, products: Array.isArray(d) ? d : [] }));
        } catch (e) {
            setBulk(prev => ({ ...prev, products: [], results: [{ title: 'Error', ok: false, detail: e.message }], finished: true }));
        }
    };
    const runBulk = async () => {
        setBulk(prev => ({ ...prev, running: true }));
        const products = bulk.products || [];
        const results = [];
        for (let i = 0; i < products.length; i++) {
            const p = products[i];
            try {
                const res = await fetch(`/api/products/${p.id}/setup-bundle`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ product_title: p.title, size_mappings: [] })
                });
                const d = await res.json();
                if (res.ok && d.success) {
                    results.push({ title: p.title, ok: true, detail: `${(d.sizes || []).length} sizes${d.legacy_converted ? ' · old variants converted' : ''}` });
                } else {
                    results.push({ title: p.title, ok: false, detail: d.error || `failed (${res.status})` });
                }
            } catch (e) {
                results.push({ title: p.title, ok: false, detail: e.message });
            }
            setBulk(prev => ({ ...prev, done: i + 1, results: [...results] }));
        }
        setBulk(prev => ({ ...prev, running: false, finished: true }));
    };

    const handleSave = async () => {
        setSaving(true);
        setBanner(null);
        try {
            const chosen = collections
                .filter(c => selected[c.id])
                .map(c => ({ id: c.id, title: c.title, handle: c.handle }));
            const res = await fetch('/api/collections/selected', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ collections: chosen })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Save failed');
            setBanner({ tone: 'success', title: 'Collections saved', content: `Now syncing ${chosen.length} collection${chosen.length !== 1 ? 's' : ''}. Use Manual Sync to pull in their plant products.` });
        } catch (error) {
            setBanner({ tone: 'critical', title: 'Save failed', content: error.message });
        } finally {
            setSaving(false);
        }
    };

    const selectedCount = Object.values(selected).filter(Boolean).length;
    const filtered = collections.filter(c =>
        c.title?.toLowerCase().includes(query.toLowerCase()) ||
        c.handle?.toLowerCase().includes(query.toLowerCase())
    );

    return (
        <Page title="Collections" subtitle="Choose which Shopify collections the app pulls plant products from">
            <BlockStack gap="500">
                <Banner tone="info">
                    <p>Only the collections you tick here are synced — everything else in your store is ignored.
                        Pick your plant collections (e.g. <strong>Houseplants for Sale</strong> and <strong>Living Gifts</strong>),
                        click Save, then run <strong>Manual Sync</strong> to bring their products into the app.</p>
                </Banner>

                <InlineStack align="end" gap="200">
                    <Button onClick={fetchCollections} icon={RefreshIcon} variant="tertiary">Refresh</Button>
                    <Button onClick={handleSave} loading={saving} icon={SaveIcon} variant="primary">
                        Save Selection{selectedCount > 0 ? ` (${selectedCount})` : ''}
                    </Button>
                </InlineStack>

                {banner && (
                    <Banner tone={banner.tone} title={banner.title} onDismiss={() => setBanner(null)}>
                        <p>{banner.content}</p>
                    </Banner>
                )}

                {loading ? (
                    <Card><Box padding="400"><SkeletonBodyText lines={12} /></Box></Card>
                ) : (
                    <Card padding="0">
                        <Box padding="400">
                            <BlockStack gap="300">
                                <InlineStack align="space-between" blockAlign="center">
                                    <Text variant="headingMd">Your Shopify Collections</Text>
                                    <Badge>{`${collections.length} total`}</Badge>
                                </InlineStack>
                                <TextField
                                    prefix={<SearchIcon style={{ width: 18 }} />}
                                    placeholder="Filter collections..."
                                    value={query}
                                    onChange={setQuery}
                                    autoComplete="off"
                                    clearButton
                                    onClearButtonClick={() => setQuery('')}
                                />
                            </BlockStack>
                        </Box>
                        <Divider />
                        <ResourceList
                            resourceName={{ singular: 'collection', plural: 'collections' }}
                            items={filtered}
                            renderItem={(c) => (
                                <ResourceItem id={String(c.id)} onClick={() => toggle(c.id)}>
                                    <InlineStack align="space-between" blockAlign="center" wrap={false}>
                                        <InlineStack gap="300" blockAlign="center">
                                            <Checkbox label="" labelHidden checked={!!selected[c.id]} onChange={() => toggle(c.id)} />
                                            <BlockStack gap="050">
                                                <Text variant="bodyMd" fontWeight="bold">{c.title}</Text>
                                                <Text variant="bodySm" tone="subdued">/{c.handle}</Text>
                                            </BlockStack>
                                        </InlineStack>
                                        <InlineStack gap="200" blockAlign="center">
                                            {typeof c.products_count === 'number' && <Badge>{`${c.products_count} products`}</Badge>}
                                            <Badge tone={c.type === 'smart' ? 'attention' : 'info'}>{c.type === 'smart' ? 'Smart' : 'Manual'}</Badge>
                                            <div onClick={(e) => e.stopPropagation()}>
                                                <Button size="slim" onClick={() => startBulk(c)}>Set up all plants</Button>
                                            </div>
                                        </InlineStack>
                                    </InlineStack>
                                </ResourceItem>
                            )}
                            emptyState={(
                                <EmptyState
                                    heading="No collections found"
                                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                                >
                                    <p>No collections matched, or the app can't reach Shopify. Check your API token, then Refresh.</p>
                                </EmptyState>
                            )}
                        />
                    </Card>
                )}
            </BlockStack>

            <Modal
                open={!!bulk}
                onClose={() => { if (!bulk?.running) setBulk(null); }}
                title={bulk ? `Set up entire collection: ${bulk.collection.title}` : ''}
                primaryAction={bulk && !bulk.running && !bulk.finished && bulk.products?.length
                    ? { content: `Set up ${bulk.products.length} product(s)`, onAction: runBulk }
                    : bulk?.finished ? { content: 'Close', onAction: () => setBulk(null) } : undefined}
                secondaryActions={bulk && !bulk.running ? [{ content: 'Cancel', onAction: () => setBulk(null) }] : []}
            >
                <Modal.Section>
                    {!bulk ? null : bulk.products === null ? (
                        <Text tone="subdued">Loading products in this collection…</Text>
                    ) : (
                        <BlockStack gap="300">
                            {!bulk.running && !bulk.finished && (
                                <Banner tone="info">
                                    <p>This runs the same one-click setup on every product: standard pot prices, automatic
                                    size rules (2 inch / 5 gal+ bare-root, 4 inch pot-included), old-style variants converted.
                                    Already-configured products are safely refreshed. You can fine-tune any single plant
                                    afterwards via Houseplants → Edit. Takes ~5–20 seconds per product.</p>
                                </Banner>
                            )}
                            {bulk.products.length === 0 && <Text tone="subdued">No products found in this collection.</Text>}
                            {(bulk.running || bulk.finished) && bulk.products.length > 0 && (
                                <BlockStack gap="200">
                                    <Text variant="bodyMd" fontWeight="semibold">
                                        {bulk.finished ? `Done — ${bulk.results.filter(r => r.ok).length} of ${bulk.products.length} set up` : `Setting up ${bulk.done} / ${bulk.products.length}…`}
                                    </Text>
                                    <ProgressBar progress={Math.round((bulk.done / bulk.products.length) * 100)} size="small" />
                                </BlockStack>
                            )}
                            {bulk.results.map((r, i) => (
                                <InlineStack key={i} gap="200" blockAlign="center">
                                    <Badge tone={r.ok ? 'success' : 'critical'}>{r.ok ? 'OK' : 'FAILED'}</Badge>
                                    <Text variant="bodySm" fontWeight="semibold">{r.title}</Text>
                                    <Text variant="bodySm" tone="subdued">{r.detail}</Text>
                                </InlineStack>
                            ))}
                        </BlockStack>
                    )}
                </Modal.Section>
            </Modal>
        </Page>
    );
}

export default Collections;
