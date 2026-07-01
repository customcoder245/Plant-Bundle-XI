import React, { useState, useEffect } from 'react';
import {
    Page, Card, Text, BlockStack, InlineStack, Badge, Button,
    Box, Divider, EmptyState, SkeletonBodyText, Banner, Icon,
    TextField, Modal, Popover, ActionList
} from '@shopify/polaris';
import { ChevronDownIcon, ChevronRightIcon, SearchIcon } from '@shopify/polaris-icons';

// Visual Library: one row per configured plant. Expand a plant to see every
// size × pot color combination with its gallery image and an inline uploader.
// The uploaded image is what the product gallery swaps to when a customer
// picks that pot color on that plant size.
function Images() {
    const [configs, setConfigs] = useState([]);
    const [colors, setColors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState({});            // { [configId]: bool }
    const [imagesBy, setImagesBy] = useState({});    // { [configId]: rows[] }
    const [busyKey, setBusyKey] = useState('');
    const [banner, setBanner] = useState(null);
    const [query, setQuery] = useState('');
    // picker: { configId, colorId, colorName, size, mode: 'url'|'shopify', url, libQ, lib, libLoading }
    const [picker, setPicker] = useState(null);
    const [menuKey, setMenuKey] = useState(null); // which row's Image menu is open

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [configsRes, colorsRes] = await Promise.all([
                fetch('/api/product-config'),
                fetch('/api/pots/colors')
            ]);
            const configsData = await configsRes.json();
            const colorsData = await colorsRes.json();
            setConfigs(Array.isArray(configsData) ? configsData : []);
            setColors(Array.isArray(colorsData) ? colorsData : []);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    const fetchImages = async (configId) => {
        try {
            const res = await fetch(`/api/images/product/${configId}`);
            const d = await res.json();
            setImagesBy(prev => ({ ...prev, [configId]: Array.isArray(d) ? d : [] }));
        } catch (e) { console.error(e); }
    };

    const togglePlant = (configId) => {
        const willOpen = !open[configId];
        setOpen(prev => ({ ...prev, [configId]: willOpen }));
        if (willOpen && !imagesBy[configId]) fetchImages(configId);
    };

    const norm = (t) => (t || '').toLowerCase()
        .replace(/["“”]/g, ' inch').replace(/gallons?\b/g, 'gal').replace(/\bgal\./g, 'gal')
        .replace(/\bpot\b/g, '').replace(/[^a-z0-9. ]/g, ' ').replace(/\s+/g, ' ').trim();

    const sizesOf = (config) => [...new Set(((config.size_mappings) || [])
        .map(m => (m.variant_title || '').split(' / ')[0].trim())
        .filter(Boolean))];

    const imageFor = (configId, colorName, size) => {
        const imgs = imagesBy[configId] || [];
        return imgs.find(i => i.color_name === colorName && (norm(i.size) === norm(size) || (i.size || '').toLowerCase() === 'all'));
    };

    const upload = async (configId, colorId, size, file) => {
        if (!file) return;
        const key = `${configId}|${colorId}|${size}`;
        setBusyKey(key);
        const fd = new FormData();
        fd.append('product_config_id', configId.toString());
        fd.append('pot_color_id', colorId.toString());
        fd.append('size', size);
        fd.append('image', file);
        try {
            const res = await fetch('/api/images', { method: 'POST', body: fd });
            if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Upload failed'); }
            setBanner({ tone: 'success', content: `Image saved — customers picking that pot on ${size} now see it.` });
            fetchImages(configId);
        } catch (e) { setBanner({ tone: 'critical', content: e.message }); }
        finally { setBusyKey(''); }
    };

    const removeImage = async (configId, imageId) => {
        await fetch(`/api/images/${imageId}`, { method: 'DELETE' });
        fetchImages(configId);
    };

    const saveByUrl = async (p, url) => {
        if (!url || !url.trim()) return;
        setBusyKey('picker');
        try {
            const res = await fetch('/api/images/by-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ product_config_id: p.configId, pot_color_id: p.colorId, size: p.size, image_url: url.trim() })
            });
            if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Save failed'); }
            setBanner({ tone: 'success', content: `Image linked for ${p.colorName} on ${p.size}.` });
            setPicker(null);
            fetchImages(p.configId);
        } catch (e) { setBanner({ tone: 'critical', content: e.message }); }
        finally { setBusyKey(''); }
    };

    const loadShopifyLibrary = async (p, q) => {
        setPicker(prev => ({ ...prev, libLoading: true }));
        try {
            const res = await fetch(`/api/images/shopify-library?q=${encodeURIComponent(q || '')}`);
            const d = await res.json();
            setPicker(prev => prev ? ({ ...prev, lib: Array.isArray(d) ? d : [], libLoading: false }) : prev);
        } catch (e) {
            setPicker(prev => prev ? ({ ...prev, lib: [], libLoading: false }) : prev);
        }
    };

    if (loading) return (
        <Page title="Visual Library"><Card><Box padding="600"><SkeletonBodyText lines={10} /></Box></Card></Page>
    );

    if (configs.length === 0) return (
        <Page title="Visual Library">
            <EmptyState
                heading="No houseplants set up yet"
                action={{ content: '+ Add Houseplant', url: '/builder' }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
                <p>Set up a houseplant first, then add its gallery images here.</p>
            </EmptyState>
        </Page>
    );

    const activeColors = colors.filter(c => c.is_active);

    return (
        <Page fullWidth title="Visual Library" subtitle="Gallery images per plant — what customers see when they pick a pot color on each size.">
            <BlockStack gap="400">
                {banner && <Banner tone={banner.tone} onDismiss={() => setBanner(null)}><p>{banner.content}</p></Banner>}
                <div style={{ position: 'sticky', top: 0, zIndex: 20, background: '#fcfbf7', padding: '4px 0 10px' }}>
                    <TextField
                        prefix={<SearchIcon style={{ width: 18 }} />}
                        placeholder="Search houseplants..."
                        value={query} onChange={setQuery}
                        autoComplete="off" clearButton
                        onClearButtonClick={() => setQuery('')}
                        label="Search" labelHidden
                    />
                </div>
                <Card padding="0">
                    {configs.filter(c => (c.product_title || '').toLowerCase().includes(query.toLowerCase())).map((config, idx) => {
                        const isOpen = !!open[config.id];
                        const sizes = sizesOf(config);
                        const imgs = imagesBy[config.id] || [];
                        const total = sizes.length * activeColors.length;
                        return (
                            <div key={config.id}>
                                {idx > 0 && <Divider />}
                                <div
                                    onClick={() => togglePlant(config.id)}
                                    style={{ cursor: 'pointer', padding: '14px 16px', background: isOpen ? '#f6f8f4' : 'transparent' }}
                                >
                                    <InlineStack align="space-between" blockAlign="center" wrap={false}>
                                        <InlineStack gap="300" blockAlign="center" wrap={false}>
                                            <Icon source={isOpen ? ChevronDownIcon : ChevronRightIcon} tone="subdued" />
                                            {config.product_image_url
                                                ? <img src={config.product_image_url} alt={config.product_title} style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 12, border: '1px solid #e8e6df', flexShrink: 0 }} />
                                                : <div style={{ width: 100, height: 100, borderRadius: 12, border: '1px solid #e8e6df', background: '#f1f5ee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, flexShrink: 0 }}>🌿</div>}
                                            <Text variant="bodyMd" fontWeight="bold">{config.product_title}</Text>
                                        </InlineStack>
                                        <InlineStack gap="200" blockAlign="center" wrap={false}>
                                            <Badge>{`${sizes.length} size${sizes.length !== 1 ? 's' : ''}`}</Badge>
                                            {isOpen && <Badge tone={imgs.length >= total ? 'success' : 'attention'}>{`${imgs.length} image${imgs.length !== 1 ? 's' : ''}`}</Badge>}
                                            <button
                                                onClick={(e) => { e.stopPropagation(); togglePlant(config.id); }}
                                                style={{
                                                    background: '#f1efe8', color: '#444', border: 'none',
                                                    borderRadius: 10, padding: '5px 12px', fontSize: 12,
                                                    fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap'
                                                }}
                                            >
                                                {isOpen ? 'Close ▴' : 'Select gallery images ▾'}
                                            </button>
                                        </InlineStack>
                                    </InlineStack>
                                </div>
                                {isOpen && (
                                    <Box paddingInlineStart="600" paddingInlineEnd="400" paddingBlockEnd="400">
                                        {!imagesBy[config.id] ? <SkeletonBodyText lines={3} /> : (
                                            <div style={{ border: '1px solid #ece9e1', borderRadius: 12, overflow: 'hidden' }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: '100px 170px 70px 1fr', gap: 10, padding: '8px 14px', background: '#faf9f4', fontSize: 11.5, color: '#5c625c', fontWeight: 600 }}>
                                                    <span>Plant size</span><span>Pot color</span><span>Image</span><span></span>
                                                </div>
                                                {sizes.map(sz => activeColors.map(c => {
                                                    const img = imageFor(config.id, c.name, sz);
                                                    const key = `${config.id}|${c.id}|${sz}`;
                                                    return (
                                                        <div key={key} style={{ display: 'grid', gridTemplateColumns: '100px 170px 70px 1fr', gap: 10, alignItems: 'center', padding: '8px 14px', borderTop: '1px solid #f4f2ec' }}>
                                                            <Text variant="bodyMd" fontWeight="semibold">{sz}</Text>
                                                            <span style={{ fontSize: 13 }}>
                                                                {c.image_url
                                                                    ? <img src={c.image_url} alt={c.name} style={{ width: 22, height: 22, objectFit: 'cover', borderRadius: 5, border: '1px solid #ddd', verticalAlign: -6, marginRight: 6 }} />
                                                                    : <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 4, background: c.hex_code, border: '1px solid #ddd', verticalAlign: -2, marginRight: 6 }}></span>}
                                                                {c.name}
                                                            </span>
                                                            {img
                                                                ? <img src={img.image_url} alt={`${c.name} on ${sz}`} style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 8, border: '2px solid #9ae6b4' }} />
                                                                : <span style={{ width: 52, height: 52, borderRadius: 8, border: '2px dashed #d8d5cc', display: 'inline-block' }}></span>}
                                                            <span>
                                                                <input
                                                                    type="file" accept="image/*" id={`vl-${key}`} style={{ display: 'none' }}
                                                                    onChange={(e) => upload(config.id, c.id, sz, e.target.files && e.target.files[0])}
                                                                />
                                                                <Popover
                                                                    active={menuKey === key}
                                                                    onClose={() => setMenuKey(null)}
                                                                    activator={
                                                                        <Button size="slim" loading={busyKey === key} disclosure onClick={() => setMenuKey(menuKey === key ? null : key)}>
                                                                            🖼 Image
                                                                        </Button>
                                                                    }
                                                                >
                                                                    <ActionList
                                                                        actionRole="menuitem"
                                                                        items={[
                                                                            { content: img ? 'Replace — upload a file' : 'Upload a file', onAction: () => { setMenuKey(null); document.getElementById(`vl-${key}`).click(); } },
                                                                            { content: 'Paste an image URL', onAction: () => { setMenuKey(null); setPicker({ configId: config.id, colorId: c.id, colorName: c.name, size: sz, mode: 'url', url: '', libQ: '', lib: null, libLoading: false }); } },
                                                                            { content: 'Choose from Shopify', onAction: () => { setMenuKey(null); setPicker({ configId: config.id, colorId: c.id, colorName: c.name, size: sz, mode: 'shopify', url: '', libQ: '', lib: null, libLoading: true }); loadShopifyLibrary({ configId: config.id }, ''); } },
                                                                            ...(img && (img.size || '').toLowerCase() !== 'all'
                                                                                ? [{ content: 'Remove image', destructive: true, onAction: () => { setMenuKey(null); removeImage(config.id, img.id); } }]
                                                                                : [])
                                                                        ]}
                                                                    />
                                                                </Popover>
                                                                {img && (img.size || '').toLowerCase() === 'all' && (
                                                                    <span style={{ marginLeft: 8, fontSize: 11, color: '#8a8f8a' }}>shared “all sizes” image</span>
                                                                )}
                                                            </span>
                                                        </div>
                                                    );
                                                }))}
                                            </div>
                                        )}
                                    </Box>
                                )}
                            </div>
                        );
                    })}
                </Card>
            </BlockStack>

            <Modal
                open={!!picker}
                onClose={() => setPicker(null)}
                title={picker ? `Image for ${picker.colorName} pot · ${picker.size}` : ''}
                primaryAction={picker && picker.mode === 'url'
                    ? { content: 'Save image', loading: busyKey === 'picker', onAction: () => saveByUrl(picker, picker.url) }
                    : undefined}
                secondaryActions={[{ content: 'Cancel', onAction: () => setPicker(null) }]}
            >
                <Modal.Section>
                    {picker && (
                        <BlockStack gap="300">
                            <InlineStack gap="200">
                                <Button pressed={picker.mode === 'url'} onClick={() => setPicker(prev => ({ ...prev, mode: 'url' }))}>Paste a URL</Button>
                                <Button pressed={picker.mode === 'shopify'} onClick={() => { setPicker(prev => ({ ...prev, mode: 'shopify' })); if (!picker.lib) loadShopifyLibrary(picker, picker.libQ); }}>Choose from Shopify</Button>
                            </InlineStack>
                            {picker.mode === 'url' ? (
                                <TextField
                                    label="Image URL"
                                    value={picker.url}
                                    onChange={(v) => setPicker(prev => ({ ...prev, url: v }))}
                                    placeholder="https://cdn.shopify.com/.../plant-in-teal-pot.jpg"
                                    autoComplete="off"
                                    helpText="Paste any image link — Shopify CDN or elsewhere."
                                />
                            ) : (
                                <BlockStack gap="300">
                                    <TextField
                                        label="Search your Shopify images"
                                        labelHidden placeholder="Search your Shopify images..."
                                        value={picker.libQ}
                                        onChange={(v) => setPicker(prev => ({ ...prev, libQ: v }))}
                                        autoComplete="off"
                                        connectedRight={<Button onClick={() => loadShopifyLibrary(picker, picker.libQ)}>Search</Button>}
                                    />
                                    {picker.libLoading ? <SkeletonBodyText lines={4} /> : (
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 10, maxHeight: 320, overflowY: 'auto' }}>
                                            {(picker.lib || []).map((im, i) => (
                                                <img
                                                    key={i} src={im.url} alt={im.alt || 'Shopify image'}
                                                    onClick={() => saveByUrl(picker, im.url)}
                                                    style={{ width: '100%', height: 92, objectFit: 'cover', borderRadius: 8, border: '1px solid #e0ddd4', cursor: 'pointer' }}
                                                />
                                            ))}
                                            {(picker.lib || []).length === 0 && <Text tone="subdued">No images found — try a different search.</Text>}
                                        </div>
                                    )}
                                </BlockStack>
                            )}
                        </BlockStack>
                    )}
                </Modal.Section>
            </Modal>
        </Page>
    );
}

export default Images;
