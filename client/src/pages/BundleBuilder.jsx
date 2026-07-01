import React, { useState, useEffect } from 'react';
import {
    Page, Card, BlockStack, InlineStack, Text, Badge,
    Button, TextField, Select, Divider, Banner,
    Box, SkeletonBodyText, Modal, FormLayout, Layout
} from '@shopify/polaris';
import { SearchIcon, RefreshIcon, PlusIcon, CheckIcon } from '@shopify/polaris-icons';
import { Leaf } from 'lucide-react';

/* ════════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════════ */
const Spinner = () => (
    <>
        <div style={{
            width: 40, height: 40,
            border: '4px solid #e4e5e7',
            borderTop: '4px solid #008060',
            borderRadius: '50%',
            animation: 'bbspin 0.8s linear infinite',
            margin: '0 auto 12px'
        }} />
        <style>{`@keyframes bbspin{to{transform:rotate(360deg)}}`}</style>
    </>
);

/** Parse "4\" Pot / White" -> { size: '4" Pot', color: 'White' } */
function parseVariantTitle(title = '') {
    if (title.includes(' / ')) {
        const [size, color] = title.split(' / ');
        return { size: size.trim(), color: color.trim() };
    }
    return { size: title.trim(), color: '' };
}

/* colour map for known pot colours */
const COLOR_HEX = {
    white: '#f5f5f0', black: '#2c2c2c', green: '#4a7c59',
    beige: '#d4b483', gold: '#c9a84c', blue: '#4a90d9',
    red: '#c0392b', grey: '#9e9e9e', gray: '#9e9e9e',
    brown: '#795548', terracotta: '#c1440e', cream: '#fffdd0',
};
function colorHex(name = '') {
    return COLOR_HEX[name.toLowerCase()] || '#a9a9a9';
}

/* ════════════════════════════════════════════════════════════
   STEP — STEP INDICATOR
   ════════════════════════════════════════════════════════════ */
function StepIndicator({ current }) {
    const steps = ['1. Pick Plant', '2. Sizes & Pots', '3. Done'];
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 28 }}>
            {steps.map((label, idx) => {
                const done = idx < current;
                const active = idx === current;
                return (
                    <React.Fragment key={idx}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                            <div style={{
                                width: 36, height: 36, borderRadius: '50%',
                                background: done ? '#008060' : active ? '#004c3f' : '#e4e5e7',
                                color: done || active ? '#fff' : '#8c9196',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontWeight: 700, fontSize: 15,
                                boxShadow: active ? '0 0 0 4px rgba(0,128,96,.2)' : 'none',
                                transition: 'all .3s'
                            }}>
                                {done ? '✓' : idx + 1}
                            </div>
                            <span style={{ fontSize: 12, fontWeight: active ? 700 : 400, color: active ? '#004c3f' : '#8c9196', whiteSpace: 'nowrap' }}>
                                {label}
                            </span>
                        </div>
                        {idx < steps.length - 1 && (
                            <div style={{ flex: 1, height: 2, background: done ? '#008060' : '#e4e5e7', margin: '0 8px', marginBottom: 22, transition: 'background .3s' }} />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
}

/* ════════════════════════════════════════════════════════════
   STEP 1: PLANT GALLERY
   ════════════════════════════════════════════════════════════ */
function PlantGallery({ onSelect }) {
    const [plants, setPlants] = useState([]);
    const [loading, setLoading] = useState(false);
    const [query, setQuery] = useState('');
    const [error, setError] = useState('');

    // No collection lists - plants are found one at a time via store search.

    const load = async () => {
        setLoading(true); setError('');
        try {
            const res = await fetch('/api/products');
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'Failed');
            setPlants(Array.isArray(d) ? d : []);
        } catch (e) { setError(e.message); }
        finally { setLoading(false); }
    };

    const [storeResults, setStoreResults] = useState([]);
    const [searching, setSearching] = useState(false);
    useEffect(() => {
        if (query.trim().length < 2) { setStoreResults([]); return; }
        const t = setTimeout(async () => {
            setSearching(true);
            try {
                const res = await fetch(`/api/products/search?q=${encodeURIComponent(query.trim())}`);
                const d = await res.json();
                setStoreResults(res.ok && Array.isArray(d) ? d : []);
            } catch (e) { console.error(e); }
            finally { setSearching(false); }
        }, 400);
        return () => clearTimeout(t);
    }, [query]);

    const filtered = storeResults;

    if (loading) return (
        <Card><Box padding="800" style={{ textAlign: 'center' }}>
            <Spinner /><Text tone="subdued">Loading plants from Shopify…</Text>
        </Box></Card>
    );

    return (
        <BlockStack gap="400">
            {error && <Banner tone="critical"><p>{error}</p></Banner>}
            <Banner tone="info">
                <p>Select the <strong>plant or tree</strong> you want to configure for pot bundling. You'll set pot sizes and colours in the next step.</p>
            </Banner>

            <Card padding="0">
                <Box padding="400">
                    <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="200">
                            <Text variant="headingMd">🌿 Find your plant</Text>
                            {query.trim().length >= 2 && <Badge>{`${filtered.length} match(es)`}</Badge>}
                        </InlineStack>
                    </InlineStack>
                    <div style={{ marginTop: 10 }}>
                        <TextField
                            prefix={<SearchIcon style={{ width: 18 }} />}
                            placeholder="Search your ENTIRE store by name — any product, any collection..."
                            value={query} onChange={setQuery}
                            autoComplete="off" clearButton
                            onClearButtonClick={() => setQuery('')}
                            helpText={query.trim().length >= 2
                                ? (searching ? 'Searching your whole store…' : `${filtered.length} match(es) from your entire store`)
                                : 'Type at least 2 letters of the plant name — searches all your store products.'}
                        />
                    </div>
                </Box>
                <Divider />

                {filtered.length === 0 ? (
                    <Box padding="800"><Text tone="subdued" alignment="center">No plants found.</Text></Box>
                ) : (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                        gap: '1px', background: '#e1e3e5'
                    }}>
                        {filtered.map(plant => {
                            const img = plant.image?.src || plant.images?.[0]?.src;
                            const variants = plant.variants || [];
                            // parse unique pot sizes from variants
                            const sizes = [...new Set(variants.map(v => parseVariantTitle(v.title).size).filter(Boolean))];
                            const colors = [...new Set(variants.map(v => parseVariantTitle(v.title).color).filter(Boolean))];

                            return (
                                <div key={plant.id} style={{ 
                                    background: '#fff', 
                                    display: 'flex', 
                                    flexDirection: 'column',
                                    borderRadius: 16,
                                    overflow: 'hidden',
                                    border: '1px solid #f0f0f0',
                                    transition: 'all 0.4s ease',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.03)'
                                }}
                                className="plant-card-hover"
                                >
                                    {/* image */}
                                    <div style={{ height: 240, background: '#f6f6f7', overflow: 'hidden', position: 'relative' }}>
                                        {img ? (
                                            <img src={img} alt={plant.title} style={{
                                                width: '100%', height: '100%', objectFit: 'cover',
                                                transition: 'transform 0.6s cubic-bezier(0.23, 1, 0.32, 1)'
                                            }}
                                            className="plant-img"
                                            />
                                        ) : (
                                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c4cdd5' }}>
                                                <Leaf size={40} />
                                            </div>
                                        )}
                                        <div style={{
                                            position: 'absolute', top: 12, left: 12, padding: '4px 10px',
                                            borderRadius: 20, fontSize: 10, fontWeight: 700,
                                            background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(4px)',
                                            color: '#1a4d2e', display: 'flex', alignItems: 'center', gap: 4
                                        }}>
                                            ☀️ Full Sun
                                        </div>
                                        <div style={{
                                            position: 'absolute', top: 12, right: 12, padding: '4px 10px',
                                            borderRadius: 20, fontSize: 10, fontWeight: 700,
                                            background: plant.status === 'active' ? '#1a4d2e' : '#8c9196',
                                            color: '#fff'
                                        }}>
                                            {plant.status === 'active' ? 'ACTIVE' : 'DRAFT'}
                                        </div>
                                    </div>

                                    {/* info */}
                                    <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                                        <BlockStack gap="100">
                                            <Text variant="headingMd" fontWeight="bold">{plant.title}</Text>
                                            <Text variant="bodyXs" tone="subdued">Pachypodium lamerei & others</Text>
                                        </BlockStack>

                                        {/* Pot sizes chips */}
                                        {sizes.length > 0 && (
                                            <InlineStack gap="150" wrap={false}>
                                                {sizes.map(s => (
                                                    <span key={s} style={{
                                                        padding: '3px 10px', borderRadius: 6, fontSize: 11,
                                                        background: '#f1f8f1', color: '#1a4d2e', fontWeight: 600,
                                                        border: '1px solid #e2eee2'
                                                    }}>{s}</span>
                                                ))}
                                            </InlineStack>
                                        )}

                                        <div style={{ marginTop: 'auto', paddingTop: 10 }}>
                                            <Button fullWidth variant="primary" onClick={() => onSelect(plant)} size="large">
                                                Configure Houseplant
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </Card>
        </BlockStack>
    );
}

/* ════════════════════════════════════════════════════════════
   STEP 2: BUNDLE CONFIGURATOR (IMAGE-FIRST)
   Shows every variant's real photo from Shopify so the user can
   choose exactly which plant+pot combos to enable.
   ════════════════════════════════════════════════════════════ */
function ConfigureSizes({ plant, onBack, onDone }) {
    const [rules, setRules] = useState([]);
    const [potPrices, setPotPrices] = useState({});
    const [deductions, setDeductions] = useState({});
    const [potSizes, setPotSizes] = useState([]);
    const [rows, setRows] = useState([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const norm = (t) => (t || '').toLowerCase()
        .replace(/["“”]/g, ' inch').replace(/gallons?\b/g, 'gal').replace(/\bgal\./g, 'gal')
        .replace(/\bpot\b/g, '').replace(/[^a-z0-9. ]/g, ' ').replace(/\s+/g, ' ').trim();
    const NO_POT_RE = /(no pot|without pot|bare ?root)/i;
    const isLegacy = (plant.options || []).length >= 2 &&
        !(plant.variants || []).some(v => [v.option1, v.option2, v.option3].some(o => NO_POT_RE.test(o || '') || /with pot/i.test(o || '')));

    const modeOf = (label) => {
        const n = norm(label);
        const row = rules.find(r => norm(r.plant_size) === n);
        const offered = row ? row.pots_offered !== false : (() => {
            const i = n.match(/([\d.]+)\s*inch/); if (i && parseFloat(i[1]) <= 2) return false;
            const g = n.match(/([\d.]+)\s*gal/); if (g && parseFloat(g[1]) >= 5) return false;
            return true;
        })();
        if (!offered) return 'none';
        const bare = row && (row.bare_root_option === true || row.bare_root_option === false)
            ? row.bare_root_option
            : (() => { const i = n.match(/([\d.]+)\s*inch/); return !(i && parseFloat(i[1]) > 2 && parseFloat(i[1]) < 6); })();
        return bare ? 'optional' : 'required';
    };
    const potPriceOf = (pot) => {
        const n = norm(pot);
        const k = Object.keys(potPrices).find(x => norm(x) === n);
        return k !== undefined ? potPrices[k] : 10;
    };
    const deductionOf = (pot) => {
        const n = norm(pot);
        const k = Object.keys(deductions).find(x => norm(x) === n);
        return k !== undefined ? deductions[k] : potPriceOf(pot);
    };
    const standardTotal = (r) => ((parseFloat(r.base) || 0) + potPriceOf(r.pot)).toFixed(2);
    const shownTotal = (r) => (r.totalTouched && r.total !== '') ? r.total : standardTotal(r);
    const isManual = (r) => r.totalTouched && r.total !== '' && parseFloat(r.total) !== parseFloat(standardTotal(r));

    useEffect(() => { (async () => {
        try {
            const [rRes, pRes, iRes] = await Promise.all([
                fetch('/api/no-pot-discounts'), fetch('/api/pot-prices'), fetch('/api/inventory')
            ]);
            const rls = await rRes.json();
            setRules(Array.isArray(rls) ? rls : []);
            const pp = await pRes.json();
            const ppMap = {}, ddMap = {};
            (Array.isArray(pp) ? pp : []).forEach(x => {
                ppMap[x.pot_size] = parseFloat(x.price);
                ddMap[x.pot_size] = (x.no_pot_deduction === null || x.no_pot_deduction === undefined) ? parseFloat(x.price) : parseFloat(x.no_pot_deduction);
            });
            setPotPrices(ppMap);
            setDeductions(ddMap);
            const inv = await iRes.json();
            const sizes = Array.isArray(inv) ? [...new Set(inv.map(i => i.size).filter(Boolean))] : [];
            setPotSizes(sizes);

            // ONE row per plant size - never per variant
            const groups = new Map();
            (plant.variants || []).forEach(v => {
                const label = (v.option1 || (v.title || '').split(' / ')[0] || 'Unknown').trim();
                if (!groups.has(label)) groups.set(label, []);
                groups.get(label).push(v);
            });
            setRows([...groups.entries()].map(([label, vars]) => {
                const guess = sizes.find(ps => norm(ps) === norm(label)) || sizes.find(ps => norm(label).includes(norm(ps))) || sizes[0] || '6"';
                const baseV = vars.find(v => [v.option1, v.option2, v.option3].some(o => NO_POT_RE.test(o || ''))) || vars.reduce((a, b) => (parseFloat(a.price) || 0) <= (parseFloat(b.price) || 0) ? a : b);
                return {
                    label,
                    qty: Math.max(...vars.map(v => v.inventory_quantity || 0)),
                    base: (parseFloat(baseV.price) || 0).toFixed(2),
                    pot: guess,
                    total: '', totalTouched: false,
                    variantId: vars[0].id
                };
            }));
        } catch (e) { console.error(e); }
    })(); }, []);

    const handleSetup = async () => {
        setSaving(true); setError('');
        try {
            const res = await fetch(`/api/products/${plant.id}/setup-bundle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_title: plant.title,
                    size_mappings: rows.map(r => ({
                        shopify_variant_id: r.variantId?.toString(),
                        variant_title: r.label,
                        pot_size: r.pot,
                        pot_price_adjust: 0,
                        base_price: parseFloat(r.base) || undefined,
                        with_pot_price: (r.totalTouched && r.total !== '') ? parseFloat(r.total) : undefined
                    }))
                })
            });
            let d;
            try { d = await res.json(); }
            catch { throw new Error(`Server error (${res.status}). Check Settings → Order webhooks and the Activity Log, then try again.`); }
            if (res.ok && d.success) onDone(d);
            else throw new Error(d.error || `Setup failed (${res.status})`);
        } catch (e) {
            setError(e.message);
            try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
        }
        finally { setSaving(false); }
    };

    const money = (n) => '$' + (Math.round(n * 100) / 100).toFixed(2);

    return (
        <BlockStack gap="500">
            {error && <Banner tone="critical"><p>{error}</p></Banner>}
            <Card>
                <Box padding="400">
                    <BlockStack gap="300">
                        <Text variant="headingLg" fontWeight="bold">{plant.title}</Text>
                        <Banner tone="info">
                            One row per plant size — the app handles all variants for you. Pot colors come from the
                            shared pot pool automatically. Just confirm each size's pot match (and a price adjust for
                            heavy plants if needed), then click Set Up.
                        </Banner>
                        {isLegacy && (
                            <Banner tone="warning" title="Old-style product detected">
                                <p>This product still has old Pot Color variants in Shopify. Setup will automatically
                                collapse it to clean size-only variants first (stock and SKUs are kept per size),
                                then add the pot option the new way.</p>
                            </Banner>
                        )}
                    </BlockStack>
                </Box>
                <Divider />
                <Box padding="400">
                    <div style={{ display: 'grid', gridTemplateColumns: '80px 110px 130px 110px 180px 1fr', gap: 10, fontSize: 12, color: '#8a8f8a', borderBottom: '1px solid #e8e6df', paddingBottom: 6 }}>
                        <span>Plant size</span><span>Behavior</span><span>Base / No-Pot price</span><span>Pot size</span><span>Price with pot</span><span></span>
                    </div>
                    {rows.map((r, i) => {
                        const m = modeOf(r.label);
                        return (
                            <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '80px 110px 130px 110px 180px 1fr', gap: 10, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f4f2ec' }}>
                                <Text variant="bodyMd" fontWeight="bold">{r.label}</Text>
                                <Badge tone={m === 'optional' ? 'success' : m === 'required' ? 'attention' : 'info'}>
                                    {m === 'none' ? 'No pot UI' : m === 'required' ? 'Pot included' : 'Pot optional'}
                                </Badge>
                                <TextField label="Base price" labelHidden type="number" prefix="$"
                                    value={r.base}
                                    onChange={(v) => setRows(prev => prev.map((x, xi) => xi === i ? { ...x, base: v } : x))}
                                    autoComplete="off" />
                                {m === 'none' ? <Text tone="subdued">—</Text> : (
                                    <Select label="Pot size" labelHidden
                                        options={(potSizes.length ? potSizes : ['4\"', '6\"']).map(ps => ({ label: ps, value: ps }))}
                                        value={r.pot}
                                        onChange={(v) => setRows(prev => prev.map((x, xi) => xi === i ? { ...x, pot: v } : x))} />
                                )}
                                {m === 'none' ? <Text tone="subdued">—</Text> : (
                                    <TextField label="Price with pot" labelHidden type="number" prefix="$"
                                        value={shownTotal(r)}
                                        onChange={(v) => setRows(prev => prev.map((x, xi) => xi === i ? { ...x, total: v, totalTouched: true } : x))}
                                        autoComplete="off"
                                        helpText={(isManual(r) ? 'Manual — stays put. ' : `Standard: base + $${potPriceOf(r.pot).toFixed(2)} pot. `) + `No Pot sells at $${Math.max(0, parseFloat(shownTotal(r)) - deductionOf(r.pot)).toFixed(2)} (saves $${deductionOf(r.pot).toFixed(2)})`} />
                                )}
                                {m !== 'none' && isManual(r) ? (
                                    <Button variant="tertiary" onClick={() => setRows(prev => prev.map((x, xi) => xi === i ? { ...x, total: '', totalTouched: false } : x))}>↺ standard</Button>
                                ) : <span />}
                            </div>
                        );
                    })}
                </Box>
            </Card>
            {error && <Banner tone="critical" title="Setup failed"><p>{error}</p></Banner>}
            {saving && <Banner tone="info"><p>Setting up — creating variants and prices in Shopify, usually 5–20 seconds…</p></Banner>}
            <InlineStack align="space-between">
                <Button onClick={onBack} variant="tertiary">← Back</Button>
                <Button variant="primary" size="large" loading={saving} onClick={handleSetup}>
                    ✓ Set Up Bundle — one click does the rest
                </Button>
            </InlineStack>
        </BlockStack>
    );
}

/* ════════════════════════════════════════════════════════════
   SUCCESS SCREEN
   ════════════════════════════════════════════════════════════ */
function SuccessScreen({ productTitle, onReset, result }) {
    return (
        <Card>
            <Box padding="800">
                <BlockStack gap="400" align="center">
                    <div style={{
                        width: 72, height: 72, borderRadius: '50%',
                        background: '#d4edda', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto', fontSize: 32
                    }}>✓</div>
                    <Text variant="headingLg" fontWeight="bold" alignment="center">Bundle Configured!</Text>
                    <Text tone="subdued" alignment="center">
                        <strong>{productTitle}</strong> is now set up for pot bundling.
                        Customers will see the pot selector on its product page.
                    </Text>
                    {result?.legacy_converted && (
                        <Banner tone="success" title="Old variants cleaned up">
                            <p>This product's old Pot Color variants were automatically collapsed to clean size-only
                            variants before setup. Check prices in Shopify once to confirm.</p>
                        </Banner>
                    )}
                    {Array.isArray(result?.sizes) && (
                        <div style={{ width: '100%', maxWidth: 520, margin: '0 auto', textAlign: 'left' }}>
                            {result.sizes.map(sz => (
                                <div key={sz.size} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 4px', borderBottom: '1px solid #f1f2f3', fontSize: 13 }}>
                                    <span style={{ fontWeight: 600 }}>{sz.size}</span>
                                    <span style={{ color: '#5c625c' }}>
                                        {sz.mode === 'none'
                                            ? `$${sz.base_price} — ships as-is, no pot UI`
                                            : sz.mode === 'required'
                                                ? `$${sz.with_pot_price} pot included (+$${((parseFloat(sz.pot_price) || 0) + (parseFloat(sz.adjust) || 0)).toFixed(2)})`
                                                : `Base $${sz.base_price} · with pot $${sz.with_pot_price} (+$${((parseFloat(sz.pot_price) || 0) + (parseFloat(sz.adjust) || 0)).toFixed(2)})`}
                                    </span>
                                    <Badge tone={sz.mode === 'optional' ? 'success' : 'info'}>{sz.action}</Badge>
                                </div>
                            ))}
                        </div>
                    )}
                    <InlineStack gap="300" align="center">
                        {result?.handle && result?.shop_domain && (
                            <Button url={`https://${result.shop_domain}/products/${result.handle}`} external variant="primary">
                                View live product page
                            </Button>
                        )}
                        {result?.product_id && result?.shop_domain && (
                            <Button url={`https://${result.shop_domain}/admin/products/${result.product_id}`} external variant="secondary">
                                Open in Shopify admin
                            </Button>
                        )}
                        <Button onClick={onReset} variant="secondary">Add Another Houseplant</Button>
                        <Button url="/products" variant="tertiary">View Houseplants</Button>
                    </InlineStack>
                </BlockStack>
            </Box>
        </Card>
    );
}

/* ════════════════════════════════════════════════════════════
   MAIN PAGE
   ════════════════════════════════════════════════════════════ */
export default function BundleBuilder() {
    const [step, setStep] = useState(0);   // 0 = pick plant, 1 = configure pots, 2 = review
    const [selectedPlant, setSelectedPlant] = useState(null);
    const [bundleConfig, setBundleConfig] = useState(null);
    const [saved, setSaved] = useState(false);
    const [savedTitle, setSavedTitle] = useState('');
    const [setupResult, setSetupResult] = useState(null);

    const reset = () => {
        setStep(0);
        setSelectedPlant(null);
        setBundleConfig(null);
        setSaved(false);
        setSavedTitle('');
        setSetupResult(null);
    };

    return (
        <Page
            title="🌿 Add Houseplant"
            subtitle="Pick a plant product — the app adds the pot options, pricing and inventory."
            backAction={step > 0 && !saved ? { content: 'Back', onAction: () => setStep(s => s - 1) } : undefined}
        >
            <div style={{ maxWidth: 1100, margin: '0 auto' }}>
                {!saved && <StepIndicator current={step} />}

                {saved ? (
                    <SuccessScreen productTitle={savedTitle} onReset={reset} result={setupResult} />
                ) : step === 0 ? (
                    <PlantGallery onSelect={plant => { setSelectedPlant(plant); setStep(1); }} />
                ) : (
                    <ConfigureSizes
                        plant={selectedPlant}
                        onBack={() => setStep(0)}
                        onDone={(result) => { setSavedTitle(selectedPlant.title); setSetupResult(result || null); setSaved(true); }}
                    />
                )}
            </div>
        </Page>
    );
}
