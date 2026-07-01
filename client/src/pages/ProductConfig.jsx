import React, { useState, useEffect } from 'react';
import {
    Page, Layout, Card, ResourceList, ResourceItem, Text, Badge,
    Button, Modal, FormLayout, TextField, Select, BlockStack,
    InlineStack, EmptyState, Banner, SkeletonBodyText, Thumbnail,
    Box, Divider, Toast, Frame
} from '@shopify/polaris';
import { RefreshIcon, SearchIcon, SettingsIcon } from '@shopify/polaris-icons';
import { Leaf } from 'lucide-react';

function ProductConfig() {
    const [configs, setConfigs] = useState([]);
    const [shopifyProducts, setShopifyProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [syncLoading, setSyncLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [generateModalOpen, setGenerateModalOpen] = useState(false);
    const [generateData, setGenerateData] = useState({ shopify_product_id: '', product_title: '', sizes: [], colors: [] });
    const [availableColors, setAvailableColors] = useState([]);
    const [potSizeOptions, setPotSizeOptions] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');


    const [formData, setFormData] = useState({
        shopify_product_id: '',
        product_title: '',
        no_pot_discount: '10.00',
        size_mappings: []
    });

    useEffect(() => {
        fetchAllData();
    }, []);

    const fetchAllData = async () => {
        setLoading(true);
        try {
            await Promise.all([fetchConfigs(), fetchShopifyProducts()]);
        } catch (error) {
            console.error('Initial fetch failed:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchConfigs = async () => {
        try {
            const [configsRes, colorsRes, invRes] = await Promise.all([
                fetch('/api/product-config'),
                fetch('/api/pots/colors'),
                fetch('/api/inventory')
            ]);
            const configsData = await configsRes.json();
            const colorsData = await colorsRes.json();
            const invData = await invRes.json();
            setConfigs(Array.isArray(configsData) ? configsData : []);
            setAvailableColors(Array.isArray(colorsData) ? colorsData : []);
            // Real pot sizes the store actually stocks, so plant sizes map to a size that exists
            const sizes = Array.isArray(invData) ? [...new Set(invData.map(i => i.size).filter(Boolean))] : [];
            setPotSizeOptions(sizes);
        } catch (error) { console.error('Failed to fetch configs:', error); }
    };


    const fetchShopifyProducts = async () => {
        setSyncLoading(true);
        try {
            const res = await fetch('/api/products');
            const data = await res.json();
            setShopifyProducts(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to fetch Shopify products:', error);
            setShopifyProducts([]);
        } finally {
            setSyncLoading(false);
        }
    };


    const handleToggle = async (id) => {
        setActionLoading(id);
        try {
            const res = await fetch(`/api/product-config/${id}/toggle`, { method: 'PUT' });
            if (res.ok) fetchConfigs();
        } catch (error) { console.error('Toggle failed:', error); }
        finally { setActionLoading(null); }
    };

    const handleDelete = async (id) => {
        if (!confirm('This will disable the pot selector for customers. Continue?')) return;
        setActionLoading(id);
        try {
            const res = await fetch(`/api/product-config/${id}`, { method: 'DELETE' });
            if (res.ok) fetchConfigs();
        } catch (error) { console.error('Delete failed:', error); }
        finally { setActionLoading(null); }
    };

    const handleConfigSelect = (product) => {
        // Smart mapping prediction
        const initialMappings = (product.variants || []).map(v => {
            const title = (v.title || '').toLowerCase();
            let predictedSize = 'Medium';
            if (title.includes('2') || title.includes('small') || title.includes('4')) predictedSize = 'Small';
            if (title.includes('6') || title.includes('standard')) predictedSize = 'Medium';
            if (title.includes('8') || title.includes('10') || title.includes('large') || title.includes('gal')) predictedSize = 'Large';

            return {
                shopify_variant_id: v.id?.toString() || '',
                variant_title: v.title || 'Unknown',
                pot_size: predictedSize
            };
        });

        setFormData({
            shopify_product_id: product.id.toString(),
            product_title: product.title,
            no_pot_discount: '10.00',
            size_mappings: initialMappings
        });
        setModalOpen(true);
    };

    const isNoPotVariant = (t) => /(no pot|without pot|bare ?root)/i.test(t || '');

    const handleEditConfig = (config) => {
        const shopifyProduct = shopifyProducts.find(p => p.id.toString() === config.shopify_product_id.toString());
        const existing = new Map((config.size_mappings || []).map(m => [m.shopify_variant_id?.toString(), m]));
        const mappings = (shopifyProduct?.variants?.length
            ? shopifyProduct.variants.map(v => ({
                shopify_variant_id: v.id?.toString() || '',
                variant_title: v.title || 'Unknown',
                pot_size: existing.get(v.id?.toString())?.pot_size || 'Medium',
                pots_enabled: existing.get(v.id?.toString())?.pots_enabled ?? null,
                pot_price_adjust: existing.get(v.id?.toString())?.pot_price_adjust ?? '0',
                with_pot_price_override: existing.get(v.id?.toString())?.with_pot_price_override ?? ''
            }))
            : (config.size_mappings || []).map(m => ({
                shopify_variant_id: m.shopify_variant_id?.toString() || '',
                variant_title: m.variant_title || `Variant ${m.shopify_variant_id}`,
                pot_size: m.pot_size,
                pots_enabled: m.pots_enabled ?? null,
                pot_price_adjust: m.pot_price_adjust ?? '0',
                with_pot_price_override: m.with_pot_price_override ?? ''
            })));
        setFormData({
            shopify_product_id: config.shopify_product_id.toString(),
            product_title: config.product_title,
            no_pot_discount: (config.no_pot_discount ?? 10).toString(),
            size_mappings: mappings
        });
        setModalOpen(true);
    };

    const handleApplyNoPotPricing = async (config) => {
        setActionLoading('pricing-' + config.id);
        try {
            const res = await fetch(`/api/products/${config.shopify_product_id}/apply-no-pot-pricing`, { method: 'POST' });
            const data = await res.json();
            if (res.ok && data.success) {
                setToastMsg({ content: `Repriced ${data.updated.length} With-Pot variant(s)${data.skipped?.length ? `, ${data.skipped.length} skipped` : ''}`, status: 'success' });
                fetchShopifyProducts();
            } else {
                throw new Error(data.error || 'Failed to apply No-Pot pricing');
            }
        } catch (e) {
            setToastMsg({ content: e.message, status: 'critical' });
        } finally { setActionLoading(null); }
    };

    const handleSave = async () => {
        try {
            const res = await fetch('/api/product-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...formData,
                    shopify_product_id: parseInt(formData.shopify_product_id),
                    no_pot_discount: parseFloat(formData.no_pot_discount)
                })
            });
            if (res.ok) {
                setModalOpen(false);
                setFormData({ shopify_product_id: '', product_title: '', no_pot_discount: '10.00', size_mappings: [] });
                fetchAllData(); // Refresh everything
            }
        } catch (error) { console.error('Save failed:', error); }
    };

    const handleGenerateOpen = (product) => {
        if (!product) return;
        setGenerateData({
            shopify_product_id: product.id?.toString() || '',
            product_title: product.title || 'Unknown Product',
            sizes: [{ name: '4" Pot', price: product.variants?.[0]?.price || '29.99', inventory: '100' }],
            colors: (Array.isArray(availableColors) ? availableColors : []).filter(c => c.is_active).map(c => c.name)
        });
        setGenerateModalOpen(true);
    };



    const handleGenerateSubmit = async () => {
        setActionLoading('generating');
        try {
            const sizesArr = generateData.sizes.filter(s => s.name.trim() !== '');
            const colorsArr = availableColors.filter(c => generateData.colors.includes(c.name));

            const res = await fetch(`/api/products/${generateData.shopify_product_id}/generate-variants`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sizesConfig: sizesArr,
                    colors: colorsArr
                })
            });

            if (res.ok) {
                setGenerateModalOpen(false);
                fetchAllData(); // Refresh everything from Shopify to see new variants
            } else {
                alert('Failed to generate variants');
            }
        } catch (e) {
            console.error('Generation err:', e);
        } finally {
            setActionLoading(null);
        }
    };


    const [isSyncing, setIsSyncing] = useState(false);
    const [toastMsg, setToastMsg] = useState(null);

    const handleSync = async () => {
        setIsSyncing(true);
        try {
            const res = await fetch('/api/products/sync-config', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setToastMsg({ content: `✅ Synced ${data.synced} products`, status: 'success' });
                fetchAllData();
            } else {
                throw new Error(data.error || 'Sync failed');
            }
        } catch (e) {
            setToastMsg({ content: `⚠️ ${e.message}`, status: 'critical' });
        } finally {
            setIsSyncing(false);
        }
    };

    const configuredIds = (Array.isArray(configs) ? configs : []).map(c => c.shopify_product_id.toString());
    const unconfiguredProducts = (Array.isArray(shopifyProducts) ? shopifyProducts : []).filter(p =>
        !configuredIds.includes(p.id?.toString()) &&
        (p.title || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (loading) return <Page title="Manage Bundles"><SkeletonBodyText lines={20} /></Page>;

    return (
        <Frame>
            <Page
                title="Houseplants"
                subtitle="Every houseplant product, its sizes and pot setup. One way in: Add Houseplant."
                primaryAction={{ content: '+ Add Houseplant', url: '/builder' }}
            >
            <BlockStack gap="600">
                <Card>
                    <Box padding="400">
                        <InlineStack gap="200" align="start" blockAlign="center">
                            <div style={{ padding: 6, background: '#f5f7f5', borderRadius: 8 }}>
                                <Leaf size={20} color="#1a4d2e" />
                            </div>
                            <Text variant="headingMd">Configured Products</Text>
                        </InlineStack>
                    </Box>
                    <Divider />
                    <ResourceList
                        resourceName={{ singular: 'bundle', plural: 'bundles' }}
                        items={configs}
                        renderItem={(config) => {
                            const shopifyProduct = shopifyProducts.find(p => p.id.toString() === config.shopify_product_id.toString());
                            const imageUrl = shopifyProduct?.image?.src || "";
                            const inventoryTotal = (shopifyProduct?.variants || []).reduce((sum, v) => sum + (v.inventory_quantity || 0), 0);

                            const groups = {};
                            const hasVariants = shopifyProduct?.variants?.length > 0;
                            if (hasVariants) {
                                shopifyProduct.variants.forEach(v => {
                                    const sizeName = v.option1 || (v.title || '').split(' / ')[0] || 'Unknown';
                                    const mapping = (config.size_mappings || []).find(m => m.shopify_variant_id?.toString() === v.id?.toString());
                                    if (!groups[sizeName]) {
                                        groups[sizeName] = { variants: [], noPotVariants: [], totalAvailable: 0, prices: [], noPotPrices: [], potSize: null };
                                    }
                                    if (isNoPotVariant(v.title)) {
                                        groups[sizeName].noPotVariants.push(v);
                                        groups[sizeName].noPotPrices.push(parseFloat(v.price) || 0);
                                    } else {
                                        groups[sizeName].variants.push(v);
                                        groups[sizeName].totalAvailable += Math.max(0, parseInt(v.inventory_quantity || 0));
                                        groups[sizeName].prices.push(parseFloat(v.price) || 0);
                                        if (mapping && !groups[sizeName].potSize) groups[sizeName].potSize = mapping.pot_size;
                                    }
                                });
                            }

                            return (
                                <ResourceItem id={config.id.toString()} verticalAlignment="center">
                                    <InlineStack align="space-between" blockAlign="center">
                                        <InlineStack gap="400" blockAlign="center">
                                            <Thumbnail source={imageUrl || 'https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png'} alt={config.product_title} size="medium" />
                                            <BlockStack gap="050">
                                                <Text variant="bodyMd" fontWeight="semibold">{config.product_title}</Text>
                                                <InlineStack gap="200">
                                                    <Badge tone={config.is_enabled ? 'success' : 'attention'}>
                                                        {config.is_enabled ? 'Active' : 'Disabled'}
                                                    </Badge>
                                                    <Text tone="subdued" variant="bodySm">{(config.size_mappings || []).length} Sizes mapped</Text>
                                                    <Text tone="subdued" variant="bodySm">{hasVariants ? shopifyProduct.variants.length : 0} Shopify Variants</Text>
                                                </InlineStack>
                                            </BlockStack>
                                        </InlineStack>

                                        <InlineStack gap="200" blockAlign="center">
                                            {/* Insta-Build (Size x Pot Color) intentionally disabled: it recreated the old
                                                per-plant pot inventory model. Create plant products in Shopify with Size-only
                                                variants and connect them here instead; pots come from the shared pool. */}

                                            <Badge tone={config.is_enabled ? 'success' : 'attention'}>
                                                {config.is_enabled ? 'Live' : 'Hidden'}
                                            </Badge>
                                            <Button variant="primary" onClick={() => handleEditConfig(config)}>Edit</Button>
                                            <Button variant="secondary" onClick={() => handleApplyNoPotPricing(config)} loading={actionLoading === 'pricing-' + config.id}>Apply pot pricing</Button>
                                            <Button variant="secondary" onClick={() => handleToggle(config.id)} loading={actionLoading === config.id}>
                                                {config.is_enabled ? 'Deactivate' : 'Activate'}
                                            </Button>
                                            <Button variant="tertiary" tone="critical" onClick={() => handleDelete(config.id)} loading={actionLoading === config.id}>Remove</Button>
                                        </InlineStack>
                                    </InlineStack>

                                    {/* Variant Grouping Table */}
                                    {hasVariants && Object.keys(groups).length > 0 && (
                                        <div style={{ marginTop: '16px', border: '1px solid #dfe3e8', borderRadius: '8px', overflow: 'hidden' }}>
                                            <div style={{ background: '#f9fafb', padding: '12px 16px', borderBottom: '1px solid #dfe3e8', display: 'flex', alignItems: 'center' }}>
                                                <div style={{ flex: 1.5 }}>
                                                    <Text variant="bodySm" fontWeight="bold">Plant size</Text>
                                                </div>
                                                <div style={{ flex: 2 }}>
                                                    <Text variant="bodySm" fontWeight="bold" tone="subdued">Price</Text>
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <Text variant="bodySm" fontWeight="bold" tone="subdued">Available</Text>
                                                </div>
                                            </div>
                                            {Object.entries(groups).map(([size, data], idx) => {
                                                const minPrice = data.prices.length ? Math.min(...data.prices) : 0;
                                                const maxPrice = data.prices.length ? Math.max(...data.prices) : 0;
                                                const priceStr = data.prices.length === 0 ? '-' : minPrice === maxPrice ? `$ ${minPrice.toFixed(2)}` : `$ ${minPrice.toFixed(2)} - ${maxPrice.toFixed(2)}`;
                                                const noPotStr = data.noPotPrices.length ? `$ ${Math.min(...data.noPotPrices).toFixed(2)}` : null;
                                                const variantCount = data.variants.length + data.noPotVariants.length;

                                                return (
                                                    <div key={idx} style={{ padding: '12px 16px', borderBottom: '1px solid #dfe3e8', display: 'flex', alignItems: 'center' }}>
                                                        <div style={{ flex: 1.5, display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                            <div style={{ width: 40, height: 40, background: '#fff', border: '1px solid #dfe3e8', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                <div style={{ color: '#005bd3' }}>
                                                                    <Leaf size={16} />
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <Text variant="bodyMd" fontWeight="semibold">{size}</Text>
                                                                <Text tone="subdued" variant="bodySm">{variantCount} variant{variantCount > 1 ? 's' : ''}{data.potSize ? ` · ${data.potSize} pot` : ''}</Text>
                                                            </div>
                                                        </div>
                                                        <div style={{ flex: 2 }}>
                                                            <InlineStack gap="200" blockAlign="center">
                                                                <div style={{ border: '1px solid #8c9196', padding: '4px 12px', borderRadius: '4px', display: 'inline-block', background: '#fff' }}>
                                                                    <Text variant="bodyMd">{priceStr}</Text>
                                                                </div>
                                                                {noPotStr && <Badge tone="info">{`Base (no pot): ${noPotStr}`}</Badge>}
                                                            </InlineStack>
                                                        </div>
                                                        <div style={{ flex: 1 }}>
                                                            <Text variant="bodyMd">{data.totalAvailable}</Text>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                            <div style={{ background: '#f9fafb', padding: '12px 16px' }}>
                                                <Text tone="subdued" variant="bodySm">Total inventory across all locations: {inventoryTotal} available</Text>
                                            </div>
                                        </div>
                                    )}
                                </ResourceItem>
                            );
                        }}
                        emptyState={(
                            <EmptyState
                                heading="No houseplants set up yet"
                                action={{ content: '+ Add Houseplant', url: '/builder' }}
                                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                            >
                                <p>Click Add Houseplant, pick any plant product, and the app does the rest.</p>
                            </EmptyState>
                        )}
                    />
                </Card>

            </BlockStack>

            <Modal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                title="Pot Mapping Setup"
                primaryAction={{ content: 'Finish Setup', onAction: handleSave }}
                secondaryActions={[{ content: 'Cancel', onAction: () => setModalOpen(false) }]}
                large
            >
                <Modal.Section>
                    <FormLayout>
                        <Banner tone="info">
                            Assign each Shopify variant to a Pot Size (Small, Medium, etc) to ensure inventory tracking works correctly.
                        </Banner>

                        <TextField label="Product Display Title" value={formData.product_title} onChange={(value) => setFormData({ ...formData, product_title: value })} autoComplete="off" />
                        <Banner tone="info">
                            Pot prices are global per pot size (Settings). With-Pot price = base price + pot price ± this plant's
                            price adjust. Click "Apply pot pricing" after changing anything here.
                        </Banner>

                        <Divider />
                        <Text variant="headingMd">Variant-to-Pot Mapping</Text>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                            {(formData.size_mappings || []).map((mapping, index) => (

                                <Box key={index} padding="300" background="bg-surface-secondary" borderRadius="200" borderStyle="solid" borderWidth="025" borderColor="border-subdued">
                                    <BlockStack gap="300">
                                        <BlockStack gap="050">
                                            <Text fontWeight="bold" variant="bodySm">{mapping.variant_title}</Text>
                                            <Text tone="subdued" variant="bodyXs">SKU: {mapping.shopify_variant_id}</Text>
                                        </BlockStack>
                                        <Select
                                            label="Maps to pot size:"
                                            options={(potSizeOptions.length > 0
                                                ? potSizeOptions
                                                : ['Small', 'Medium', 'Large', 'Extra Large']
                                            ).map(s => ({ label: s, value: s }))}
                                            value={mapping.pot_size}
                                            onChange={(v) => {
                                                const updated = [...formData.size_mappings];
                                                updated[index].pot_size = v;
                                                setFormData({ ...formData, size_mappings: updated });
                                            }}
                                        />
                                        <Select
                                            label="Pots for this size:"
                                            options={[
                                                { label: 'Default rule (2 inch & 5 gal+ are bare-root)', value: 'default' },
                                                { label: 'Always offer pots (e.g. enable 5 gal pots)', value: 'on' },
                                                { label: 'Never offer pots', value: 'off' }
                                            ]}
                                            value={mapping.pots_enabled === true ? 'on' : mapping.pots_enabled === false ? 'off' : 'default'}
                                            onChange={(v) => {
                                                const updated = [...formData.size_mappings];
                                                updated[index].pots_enabled = v === 'on' ? true : v === 'off' ? false : null;
                                                setFormData({ ...formData, size_mappings: updated });
                                            }}
                                        />
                                        <TextField
                                            label="Price adjust (heavy/large plants)"
                                            type="number" prefix="±$"
                                            helpText="Added on top of the standard pot price for this plant."
                                            value={(mapping.pot_price_adjust ?? '0').toString()}
                                            onChange={(v) => {
                                                const updated = [...formData.size_mappings];
                                                updated[index].pot_price_adjust = v;
                                                setFormData({ ...formData, size_mappings: updated });
                                            }}
                                            autoComplete="off"
                                        />
                                        {/with pot/i.test(mapping.variant_title || '') && (
                                            <TextField
                                                label="Manual with-pot price"
                                                type="number" prefix="$"
                                                placeholder="blank = standard formula"
                                                helpText="Set a price here and it stays put when pot standards change. Clear it to go back to base + standard. Click Apply pot pricing after saving."
                                                value={(mapping.with_pot_price_override ?? '').toString()}
                                                onChange={(v) => {
                                                    const updated = [...formData.size_mappings];
                                                    updated[index].with_pot_price_override = v;
                                                    setFormData({ ...formData, size_mappings: updated });
                                                }}
                                                autoComplete="off"
                                            />
                                        )}
                                    </BlockStack>
                                </Box>
                            ))}
                        </div>
                    </FormLayout>
                </Modal.Section>
            </Modal>

            {toastMsg && (
                <Toast
                    content={toastMsg.content}
                    onDismiss={() => setToastMsg(null)}
                    error={toastMsg.status === 'critical'}
                />
            )}
        </Page>
        </Frame>

    );
}

export default ProductConfig;
