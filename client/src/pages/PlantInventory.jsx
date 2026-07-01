import React, { useState, useEffect, useMemo } from 'react';
import {
    Page, Card, TextField, Button, InlineStack, Badge, Text,
    Banner, BlockStack, Box, Divider, EmptyState, Select,
    SkeletonBodyText, Collapsible, Icon
} from '@shopify/polaris';
import { SaveIcon, RefreshIcon, SearchIcon, ChevronDownIcon, ChevronRightIcon } from '@shopify/polaris-icons';
import { Leaf, AlertTriangle } from 'lucide-react';

function PlantInventory() {
    const [inventory, setInventory] = useState([]);
    const [potSizes, setPotSizes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [edited, setEdited] = useState({});      // { [id]: { quantity, sku, barcode } }
    const [mapEdits, setMapEdits] = useState({});  // { [id]: pot_size }
    const [openPlants, setOpenPlants] = useState({}); // { [product_config_id]: bool }
    const [saving, setSaving] = useState(false);
    const [queryValue, setQueryValue] = useState('');
    const [syncing, setSyncing] = useState(false);
    const [banner, setBanner] = useState(null);

    useEffect(() => { fetchAll(); }, []);

    const fetchAll = async () => {
        setLoading(true);
        try {
            const [invRes, potRes] = await Promise.all([
                fetch('/api/plant-inventory'),
                fetch('/api/inventory')
            ]);
            const data = await invRes.json();
            setInventory(Array.isArray(data) ? data : []);
            const pots = await potRes.json();
            if (Array.isArray(pots)) {
                const sizes = [...new Set(pots.map(p => p.size).filter(Boolean))];
                setPotSizes(sizes);
            }
        } catch (error) {
            console.error('Failed to fetch plant inventory:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSyncShopify = async () => {
        setSyncing(true);
        setBanner(null);
        try {
            const res = await fetch('/api/plant-inventory/sync', { method: 'POST' });
            const data = await res.json();
            if (res.ok && data.success) {
                setBanner({ tone: 'success', title: 'Plant Sync Complete', content: `Pulled stock & SKUs for ${data.updatedCount} plant variants from Shopify.` });
                fetchAll();
            } else {
                throw new Error(data.error || 'Failed to sync plants.');
            }
        } catch (error) {
            setBanner({ tone: 'critical', title: 'Sync Failed', content: error.message });
        } finally {
            setSyncing(false);
        }
    };

    const setField = (id, field, value) => {
        setEdited(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    };

    const valueOf = (item, field) => {
        if (edited[item.id] && edited[item.id][field] !== undefined) return edited[item.id][field];
        return item[field] ?? '';
    };

    const potSizeOf = (item) => mapEdits[item.id] ?? (item.mapped_pot_size || '');

    const handleSaveAll = async () => {
        setSaving(true);
        try {
            // 1) stock / sku / barcode
            const updates = Object.entries(edited).map(([id, fields]) => {
                const u = { id: parseInt(id) };
                if (fields.quantity !== undefined && fields.quantity !== '') u.quantity = parseInt(fields.quantity) || 0;
                if (fields.sku !== undefined) u.sku = fields.sku;
                if (fields.barcode !== undefined) u.barcode = fields.barcode;
                return u;
            });
            if (updates.length > 0) {
                const res = await fetch('/api/plant-inventory/bulk-update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ updates })
                });
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.error || 'Save failed');
                }
            }
            // 2) pot-size mappings
            for (const [id, pot_size] of Object.entries(mapEdits)) {
                const res = await fetch(`/api/plant-inventory/${id}/mapping`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pot_size })
                });
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.error || 'Mapping save failed');
                }
            }
            const total = updates.length + Object.keys(mapEdits).length;
            setEdited({});
            setMapEdits({});
            setBanner({ tone: 'success', title: 'Saved', content: `Updated ${total} item${total !== 1 ? 's' : ''}.` });
            fetchAll();
        } catch (error) {
            setBanner({ tone: 'critical', title: 'Save Failed', content: error.message });
        } finally {
            setSaving(false);
        }
    };

    // ── Group rows by plant product ──
    const plants = useMemo(() => {
        const q = queryValue.toLowerCase();
        const groups = new Map();
        for (const item of inventory) {
            if (q && !(
                item.product_title?.toLowerCase().includes(q) ||
                item.size?.toLowerCase().includes(q) ||
                item.variant_title?.toLowerCase().includes(q) ||
                item.sku?.toLowerCase().includes(q)
            )) continue;
            const key = item.product_config_id;
            if (!groups.has(key)) {
                groups.set(key, { configId: key, title: item.product_title, image: item.product_image_url, variants: [] });
            }
            groups.get(key).variants.push(item);
        }
        return [...groups.values()].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    }, [inventory, queryValue]);

    const lowStockItems = inventory.filter(i => i.is_low_stock);
    const hasChanges = Object.keys(edited).length > 0 || Object.keys(mapEdits).length > 0;
    const togglePlant = (id) => setOpenPlants(prev => ({ ...prev, [id]: !prev[id] }));

    const potSizeOptions = [
        { label: 'No pot mapping', value: '' },
        ...potSizes.map(s => ({ label: `${s} pot`, value: s }))
    ];

    return (
        <Page title="Plant Inventory" fullWidth>
            <BlockStack gap="500">
                <Banner tone="info">
                    <p>One entry per plant — open it to manage stock for each size. Each plant size maps to a pot
                        size (they can be labeled differently, e.g. a "1 gal" plant can use a 6" pot), and customers
                        only see pot colors available in that mapped size.</p>
                </Banner>

                <InlineStack align="end" gap="200">
                    <Button onClick={handleSyncShopify} loading={syncing} icon={RefreshIcon} variant="secondary">Sync Plants from Shopify</Button>
                    <Button onClick={fetchAll} icon={RefreshIcon} variant="tertiary">Refresh</Button>
                    <Button onClick={handleSaveAll} loading={saving} disabled={!hasChanges} icon={SaveIcon} variant="primary">Save Inventory</Button>
                </InlineStack>

                {banner && (
                    <Banner tone={banner.tone} title={banner.title} onDismiss={() => setBanner(null)}>
                        <p>{banner.content}</p>
                    </Banner>
                )}

                {lowStockItems.length > 0 && (
                    <Banner tone="warning" title={`${lowStockItems.length} plant size${lowStockItems.length !== 1 ? 's are' : ' is'} low on stock`}>
                        <p>These plant sizes will soon show as out of stock to customers.</p>
                    </Banner>
                )}

                {loading && inventory.length === 0 ? (
                    <Card><Box padding="400"><SkeletonBodyText lines={15} /></Box></Card>
                ) : (
                    <Card padding="0">
                        <Box padding="400">
                            <BlockStack gap="400">
                                <InlineStack align="space-between" blockAlign="center">
                                    <InlineStack gap="200">
                                        <Leaf size={20} color="#2f855a" />
                                        <Text variant="headingMd">Plant Stock Levels</Text>
                                    </InlineStack>
                                    {hasChanges && <Badge tone="attention">Unsaved changes</Badge>}
                                </InlineStack>
                                <TextField
                                    prefix={<SearchIcon style={{ width: 18 }} />}
                                    placeholder="Filter by plant, size, or SKU..."
                                    value={queryValue}
                                    onChange={setQueryValue}
                                    autoComplete="off"
                                    clearButton
                                    onClearButtonClick={() => setQueryValue('')}
                                />
                            </BlockStack>
                        </Box>
                        <Divider />

                        {plants.length === 0 ? (
                            <EmptyState
                                heading="No plant inventory yet"
                                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                            >
                                <p>Connect a plant product (Collections or Manual Sync), or click "Sync Plants from Shopify" to pull current stock.</p>
                            </EmptyState>
                        ) : plants.map((plant, idx) => {
                            const isOpen = !!openPlants[plant.configId];
                            const totalQty = plant.variants.reduce((s, v) => s + (parseInt(valueOf(v, 'quantity')) || 0), 0);
                            const anyLow = plant.variants.some(v => v.is_low_stock);
                            const plantEdited = plant.variants.some(v => edited[v.id] || mapEdits[v.id] !== undefined);
                            return (
                                <div key={plant.configId}>
                                    {idx > 0 && <Divider />}
                                    <div
                                        onClick={() => togglePlant(plant.configId)}
                                        style={{ cursor: 'pointer', padding: '14px 16px', background: isOpen ? '#f6f8f4' : 'transparent' }}
                                    >
                                        <InlineStack align="space-between" blockAlign="center" wrap={false}>
                                            <InlineStack gap="300" blockAlign="center" wrap={false}>
                                                <Icon source={isOpen ? ChevronDownIcon : ChevronRightIcon} tone="subdued" />
                                                {plant.image
                                                    ? <img src={plant.image} alt={plant.title} style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 12, border: '1px solid #e8e6df', flexShrink: 0 }} />
                                                    : <div style={{ width: 100, height: 100, borderRadius: 12, border: '1px solid #e8e6df', background: '#f1f5ee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, flexShrink: 0 }}>🌿</div>}
                                                <Text variant="bodyMd" fontWeight="bold">{plant.title}</Text>
                                            </InlineStack>
                                            <InlineStack gap="200" blockAlign="center" wrap={false}>
                                                {plantEdited && <Badge tone="attention">Edited</Badge>}
                                                {anyLow && <Badge tone="warning">Low Stock</Badge>}
                                                <Badge>{`${plant.variants.length} size${plant.variants.length !== 1 ? 's' : ''}`}</Badge>
                                                <Badge tone="success">{`${totalQty} units`}</Badge>
                                            </InlineStack>
                                        </InlineStack>
                                    </div>
                                    <Collapsible open={isOpen} id={`plant-${plant.configId}`}>
                                        <Box paddingInlineStart="600" paddingInlineEnd="400" paddingBlockEnd="300">
                                            {/* column headers */}
                                            <div className="plant-variant-grid plant-variant-grid--head">
                                                <Text tone="subdued" variant="bodySm">Plant size</Text>
                                                <Text tone="subdued" variant="bodySm">SKU</Text>
                                                <Text tone="subdued" variant="bodySm">Barcode</Text>
                                                <Text tone="subdued" variant="bodySm">In stock</Text>
                                                <Text tone="subdued" variant="bodySm">Pot size shown</Text>
                                                <Text tone="subdued" variant="bodySm">Status</Text>
                                            </div>
                                            {plant.variants.map(item => (
                                                <div key={item.id} className="plant-variant-grid">
                                                    <Text variant="bodyMd" fontWeight="semibold">
                                                        {item.variant_title || item.size || '—'}
                                                    </Text>
                                                    <TextField
                                                        label="SKU" labelHidden placeholder="SKU"
                                                        value={valueOf(item, 'sku').toString()}
                                                        onChange={(val) => setField(item.id, 'sku', val)}
                                                        autoComplete="off"
                                                    />
                                                    <TextField
                                                        label="Barcode" labelHidden placeholder="Barcode"
                                                        value={valueOf(item, 'barcode').toString()}
                                                        onChange={(val) => setField(item.id, 'barcode', val)}
                                                        autoComplete="off"
                                                    />
                                                    <TextField
                                                        type="number" label="In Stock" labelHidden
                                                        value={valueOf(item, 'quantity').toString()}
                                                        onChange={(val) => setField(item.id, 'quantity', val)}
                                                        autoComplete="off" suffix="units" align="right"
                                                    />
                                                    <Select
                                                        label="Pot size" labelHidden
                                                        options={potSizeOptions}
                                                        value={potSizeOf(item)}
                                                        onChange={(val) => setMapEdits(prev => ({ ...prev, [item.id]: val }))}
                                                    />
                                                    <div>
                                                        {item.is_low_stock
                                                            ? <Badge tone="warning">Low</Badge>
                                                            : <Badge tone="success">OK</Badge>}
                                                    </div>
                                                </div>
                                            ))}
                                        </Box>
                                    </Collapsible>
                                </div>
                            );
                        })}
                    </Card>
                )}

                <RecentPlantMovements />
            </BlockStack>
        </Page>
    );
}

function RecentPlantMovements() {
    const [movements, setMovements] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/activity?event_type=PLANT_INVENTORY_DEDUCTED&limit=5');
                const data = await res.json();
                setMovements(Array.isArray(data) ? data : []);
            } catch (e) { console.error(e); }
            finally { setLoading(false); }
        })();
    }, []);

    if (loading) return <Card><Box padding="400"><SkeletonBodyText lines={3} /></Box></Card>;
    if (movements.length === 0) return null;

    return (
        <Card>
            <Box padding="400">
                <BlockStack gap="300">
                    <InlineStack gap="200">
                        <AlertTriangle size={18} color="#c05621" />
                        <Text variant="headingSm">Recent Plant Deductions</Text>
                    </InlineStack>
                    <Divider />
                    {movements.map((m, i) => (
                        <div key={i} style={{ padding: '8px 0', borderBottom: i < movements.length - 1 ? '1px solid #f1f2f3' : 'none' }}>
                            <InlineStack align="space-between">
                                <BlockStack gap="050">
                                    <Text variant="bodyMd" fontWeight="semibold">{m.description}</Text>
                                    <Text variant="bodyXs" tone="subdued">{new Date(m.created_at).toLocaleString()}</Text>
                                </BlockStack>
                                <Badge tone="warning">- {m.metadata?.quantity || 1}</Badge>
                            </InlineStack>
                        </div>
                    ))}
                </BlockStack>
            </Box>
        </Card>
    );
}

export default PlantInventory;
