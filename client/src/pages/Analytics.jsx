import React, { useState, useEffect } from 'react';
import {
    Page, Card, Text, BlockStack, InlineStack, Badge, Select,
    Box, Divider, SkeletonBodyText, Banner
} from '@shopify/polaris';

const money = (n) => '$' + (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 });

function StatCard({ label, value, sub }) {
    return (
        <div style={{ flex: 1, minWidth: 150, background: '#fff', border: '1px solid #e8e6df', borderRadius: 14, padding: '14px 18px' }}>
            <Text variant="bodySm" tone="subdued">{label}</Text>
            <div style={{ fontSize: 26, fontWeight: 600, margin: '2px 0' }}>{value}</div>
            {sub && <Text variant="bodySm" tone="subdued">{sub}</Text>}
        </div>
    );
}

function Analytics() {
    const [days, setDays] = useState('30');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [sortKey, setSortKey] = useState('revenue');
    const [sortDir, setSortDir] = useState('desc');
    const toggleSort = (key) => {
        if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
        else { setSortKey(key); setSortDir('desc'); }
    };

    useEffect(() => { load(); }, [days]);
    const load = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/analytics/summary?days=${days}`);
            const d = await res.json();
            setData(res.ok ? d : null);
        } catch (e) { setData(null); }
        finally { setLoading(false); }
    };

    const t = data?.totals;
    const plantsRaw = data?.plants || [];
    const plants = [...plantsRaw].sort((a, b) => {
        let av, bv;
        if (sortKey === 'title') { av = (a.title || '').toLowerCase(); bv = (b.title || '').toLowerCase(); return sortDir === 'asc' ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1); }
        if (sortKey === 'with_pot') { av = a.units > 0 ? a.with_pot_units / a.units : -1; bv = b.units > 0 ? b.with_pot_units / b.units : -1; }
        else if (sortKey === 'conversion') { av = a.conversion === null ? -1 : a.conversion; bv = b.conversion === null ? -1 : b.conversion; }
        else { av = a[sortKey] || 0; bv = b[sortKey] || 0; }
        return sortDir === 'asc' ? av - bv : bv - av;
    });
    const top10 = [...plantsRaw].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
    const maxRev = Math.max(1, ...top10.map(p => p.revenue));
    const conv = t && t.views > 0 ? Math.round((t.units / t.views) * 1000) / 10 : null;

    return (
        <Page
            title="Analytics"
            subtitle="How your houseplants are performing — sales recorded per order, views counted on the product page."
            primaryAction={undefined}
        >
            <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd">Performance</Text>
                    <div style={{ width: 180 }}>
                        <Select
                            label="Range" labelHidden
                            options={[
                                { label: 'Last 7 days', value: '7' },
                                { label: 'Last 30 days', value: '30' },
                                { label: 'Last 90 days', value: '90' },
                                { label: 'Last 365 days', value: '365' }
                            ]}
                            value={days} onChange={setDays}
                        />
                    </div>
                </InlineStack>

                {loading ? <Card><Box padding="400"><SkeletonBodyText lines={8} /></Box></Card> : !data ? (
                    <Banner tone="critical"><p>Could not load analytics.</p></Banner>
                ) : (
                    <BlockStack gap="400">
                        <InlineStack gap="300" wrap>
                            <StatCard label="Houseplants sold" value={t.units.toLocaleString()} sub={`${t.with_pot_units} with a pot · ${t.units - t.with_pot_units} without`} />
                            <StatCard label="Revenue" value={money(t.revenue)} />
                            <StatCard label="Product page views" value={t.views.toLocaleString()} sub="counted by the storefront widget" />
                            <StatCard label="View → sale rate" value={conv === null ? '—' : conv + '%'} sub={conv === null ? 'needs views to compute' : 'units sold ÷ views'} />
                        </InlineStack>

                        <Card padding="0">
                            <Box padding="400"><Text variant="headingMd">Top 10 houseplants by revenue</Text></Box>
                            <Divider />
                            <Box padding="400">
                                {top10.length === 0 && <Text tone="subdued">No houseplant sales in this period yet — they appear here automatically as orders come in.</Text>}
                                <BlockStack gap="300">
                                    {top10.map((p, i) => (
                                        <div key={p.shopify_product_id}>
                                            <InlineStack align="space-between" blockAlign="center">
                                                <Text variant="bodyMd" fontWeight="semibold">{i + 1}. {p.title}</Text>
                                                <InlineStack gap="200">
                                                    <Badge>{`${p.units} sold`}</Badge>
                                                    <Badge tone="success">{money(p.revenue)}</Badge>
                                                </InlineStack>
                                            </InlineStack>
                                            <div style={{ height: 8, background: '#f1efe8', borderRadius: 4, marginTop: 4 }}>
                                                <div style={{ width: Math.max(2, Math.round((p.revenue / maxRev) * 100)) + '%', height: 8, background: '#1a4d2e', borderRadius: 4 }}></div>
                                            </div>
                                        </div>
                                    ))}
                                </BlockStack>
                            </Box>
                        </Card>

                        <Card padding="0">
                            <Box padding="400"><Text variant="headingMd">All houseplants</Text></Box>
                            <Divider />
                            <Box padding="400">
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 110px 110px 80px 90px', gap: 10, fontSize: 12, color: '#8a8f8a', borderBottom: '1px solid #e8e6df', paddingBottom: 6, fontWeight: 600 }}>
                                    {[['title', 'Houseplant'], ['units', 'Sold'], ['revenue', 'Revenue'], ['with_pot', 'With pot'], ['views', 'Views'], ['conversion', 'Conv.']].map(([k, label]) => (
                                        <span key={k} onClick={() => toggleSort(k)} style={{ cursor: 'pointer', userSelect: 'none', color: sortKey === k ? '#1a4d2e' : '#8a8f8a' }}>
                                            {label}{sortKey === k ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                                        </span>
                                    ))}
                                </div>
                                {plants.map(p => (
                                    <div key={p.shopify_product_id} style={{ display: 'grid', gridTemplateColumns: '2fr 80px 110px 110px 80px 90px', gap: 10, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid #f4f2ec', fontSize: 13 }}>
                                        <Text variant="bodyMd" fontWeight="semibold">{p.title}</Text>
                                        <span>{p.units}</span>
                                        <span>{money(p.revenue)}</span>
                                        <span>{p.units > 0 ? Math.round((p.with_pot_units / p.units) * 100) + '%' : '—'}</span>
                                        <span>{p.views || '—'}</span>
                                        <span>{p.conversion === null ? '—' : p.conversion + '%'}</span>
                                    </div>
                                ))}
                                {(data.viewed_no_sale || []).length > 0 && (
                                    <Box paddingBlockStart="400">
                                        <Banner tone="warning" title="Viewed but not selling">
                                            <p>{data.viewed_no_sale.map(v => `${v.title} (${v.views} views)`).join(' · ')}</p>
                                        </Banner>
                                    </Box>
                                )}
                            </Box>
                        </Card>
                    </BlockStack>
                )}
            </BlockStack>
        </Page>
    );
}

export default Analytics;
