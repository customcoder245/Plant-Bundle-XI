import React, { useState, useEffect } from 'react';
import { Page, Layout, Text, BlockStack, InlineStack, Badge, SkeletonBodyText, Banner, Card, Box, Divider, Button } from '@shopify/polaris';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Palette,
    Package,
    Settings,
    PlusCircle,
    ArrowRight,
    History,
    AlertCircle,
    TrendingUp,
    Box as BoxIcon,
    Leaf
} from 'lucide-react';
import { Link } from 'react-router-dom';

const StatCard = ({ title, value, label, icon: Icon, color, delay }) => (
    <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay }}
        className="premium-card"
    >
        <div className="stat-icon-wrapper" style={{ backgroundColor: `${color}15`, color: color }}>
            <Icon size={24} />
        </div>
        <Text variant="headingSm" as="h3" tone="subdued">{title}</Text>
        <div className="stat-value gradient-text">{typeof value === 'number' ? value.toLocaleString() : value}</div>
        <Text variant="bodySm" tone="subdued">{label}</Text>

        <div style={{ position: 'absolute', bottom: '-10px', right: '-10px', opacity: 0.05, transform: 'rotate(-15deg)' }}>
            <Icon size={80} />
        </div>
    </motion.div>
);

const QuickAction = ({ title, icon: Icon, to, delay, primary }) => (
    <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, delay }}
    >
        <Link to={to} className="quick-action-btn" style={primary ? { background: 'var(--primary)', color: 'white' } : {}}>
            <Icon size={20} />
            <span style={{ flex: 1 }}>{title}</span>
            <ArrowRight size={16} />
        </Link>
    </motion.div>
);

function Dashboard() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [showAllLowPlants, setShowAllLowPlants] = useState(false);
    const [showAllLowPots, setShowAllLowPots] = useState(false);

    useEffect(() => { fetchStats(); }, []);

    const fetchStats = async () => {
        try {
            const [inventoryRes, colorsRes, configRes, activityRes, plantRes, settingsRes, analyticsRes, dailyRes] = await Promise.all([
                fetch('/api/inventory'), fetch('/api/pots/colors'), fetch('/api/product-config'), fetch('/api/activity/stats'), fetch('/api/plant-inventory'),
                fetch('/api/app-settings'), fetch('/api/analytics/summary?days=30'), fetch('/api/analytics/daily?days=30')
            ]);

            if (!inventoryRes.ok || !colorsRes.ok || !configRes.ok) throw new Error('API Error');

            const inventory = await inventoryRes.json();
            const colors = await colorsRes.json();
            const configs = await configRes.json();
            const activity = await activityRes.json();
            const plants = plantRes.ok ? await plantRes.json() : [];

            const appSettings = settingsRes.ok ? await settingsRes.json() : {};
            const threshold = parseInt(appSettings.pot_low_stock_threshold) || 10;
            const plantThreshold = parseInt(appSettings.plant_low_stock_threshold) || 10;
            const maxPots = parseInt(appSettings.dashboard_max_pot_alerts) || 5;
            const maxPlants = parseInt(appSettings.dashboard_max_plant_alerts) || 5;
            const lowPotRows = inventory
                .filter(i => i.quantity < threshold)
                .sort((a, b) => a.quantity - b.quantity);
            const plantLowStock = Array.isArray(plants) ? plants.filter(i => i.is_low_stock).length : 0;
            const totalPots = inventory.reduce((sum, i) => sum + i.quantity, 0);
            const analytics = analyticsRes.ok ? await analyticsRes.json() : null;
            const daily = dailyRes.ok ? await dailyRes.json() : [];

            // Low-stock PLANTS, bestsellers first (rank = position in 30d revenue list)
            const rank = {};
            (analytics?.plants || []).forEach((p, i) => { rank[p.shopify_product_id] = i; });
            const lowPlants = (Array.isArray(plants) ? plants : [])
                .filter(p => p.quantity < plantThreshold)
                .sort((a, b) => (rank[a.shopify_product_id] ?? 9999) - (rank[b.shopify_product_id] ?? 9999) || a.quantity - b.quantity);

            setStats({
                totalColors: colors.length,
                totalPots,
                lowStockItems: lowPotRows.length + plantLowStock,
                configuredProducts: configs.length,
                recentActivity: activity,
                lowPotRows,
                threshold,
                analytics,
                daily,
                lowPlants,
                maxPots,
                maxPlants
            });
        } catch (error) {
            console.error('Failed to fetch stats:', error);
            setError(true);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return (
        <Page title="Dashboard">
            <Layout>
                <Layout.Section><SkeletonBodyText lines={10} /></Layout.Section>
            </Layout>
        </Page>
    );

    return (
        <Page fullWidth>
            <div className="dashboard-container">
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{ marginBottom: '2rem' }}
                >
                    {(stats?.lowPotRows?.length > 0 || stats?.lowPlants?.length > 0) && (
                        <div style={{ display: 'grid', gridTemplateColumns: stats?.lowPotRows?.length > 0 && stats?.lowPlants?.length > 0 ? '1.1fr 1fr' : '1fr', gap: 14, marginBottom: '1.2rem', alignItems: 'start' }}>
                            {stats?.lowPotRows?.length > 0 && (
                                <div style={{ background: '#fff8ec', border: '1px solid #f0d9a8', borderRadius: 14, padding: '14px 18px' }}>
                                    <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>
                                        ⚠ Pots - Low stock
                                    </div>
                                    <BlockStack gap="100">
                                        {(showAllLowPots ? stats.lowPotRows : stats.lowPotRows.slice(0, stats.maxPots)).map((r, i) => (
                                            <InlineStack key={i} gap="200" blockAlign="center">
                                                <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: r.hex_code || '#ccc', border: '1px solid #ddd' }}></span>
                                                <Text variant="bodyMd" fontWeight="semibold">{r.color_name} {r.size} pot</Text>
                                                <Text tone="subdued" variant="bodySm">— stock is {r.quantity}{r.quantity === 0 ? ' (OUT — hidden from customers)' : ''}</Text>
                                            </InlineStack>
                                        ))}
                                        {stats.lowPotRows.length > stats.maxPots && (
                                            <Button size="slim" variant="tertiary" onClick={() => setShowAllLowPots(v => !v)}>
                                                {showAllLowPots ? `Show top ${stats.maxPots}` : `View all ${stats.lowPotRows.length}`}
                                            </Button>
                                        )}
                                    </BlockStack>
                                </div>
                            )}
                            {stats?.lowPlants?.length > 0 && (
                                <div style={{ background: '#fff', border: '1px solid #e8e6df', borderRadius: 14, padding: '12px 16px' }}>
                                    <InlineStack align="space-between" blockAlign="center">
                                        <span style={{ fontSize: 18, fontWeight: 700 }}>🌿 Plants - Low stock</span>
                                        <Badge tone="attention">{`${stats.lowPlants.length} low`}</Badge>
                                    </InlineStack>
                                    <BlockStack gap="100">
                                        {(showAllLowPlants ? stats.lowPlants : stats.lowPlants.slice(0, stats.maxPlants)).map((p, i) => (
                                            <InlineStack key={i} gap="200" blockAlign="center">
                                                <Text variant="bodyMd" fontWeight="semibold">{p.product_title}</Text>
                                                <Text tone="subdued" variant="bodySm">{(p.variant_title || '').split(' / ')[0]} — {p.quantity} left</Text>
                                            </InlineStack>
                                        ))}
                                    </BlockStack>
                                    <InlineStack gap="200">
                                        {stats.lowPlants.length > stats.maxPlants && (
                                            <Button size="slim" variant="tertiary" onClick={() => setShowAllLowPlants(v => !v)}>
                                                {showAllLowPlants ? `Show top ${stats.maxPlants}` : `View all ${stats.lowPlants.length}`}
                                            </Button>
                                        )}
                                        <Button size="slim" variant="tertiary" url="/plant-inventory">Open Plant Inventory →</Button>
                                    </InlineStack>
                                </div>
                            )}
                        </div>
                    )}
                    {stats?.analytics && (
                        <div style={{ marginBottom: '1.2rem', background: '#fff', border: '1px solid #e8e6df', borderRadius: 14, padding: '14px 18px' }}>
                            <InlineStack align="space-between" blockAlign="center">
                                <Text variant="headingMd">Last 30 days</Text>
                                <Button url="/analytics" size="slim" variant="tertiary">Full analytics →</Button>
                            </InlineStack>
                            <InlineStack gap="600" blockAlign="center" wrap>
                                <BlockStack gap="050"><Text variant="bodySm" tone="subdued">Houseplants sold</Text><Text variant="headingLg">{stats.analytics.totals.units.toLocaleString()}</Text></BlockStack>
                                <BlockStack gap="050"><Text variant="bodySm" tone="subdued">Revenue</Text><Text variant="headingLg">${(Math.round(stats.analytics.totals.revenue * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text></BlockStack>
                                <BlockStack gap="050"><Text variant="bodySm" tone="subdued">Page views</Text><Text variant="headingLg">{stats.analytics.totals.views.toLocaleString()}</Text></BlockStack>
                            </InlineStack>
                            {stats.daily && stats.daily.length > 0 && (() => {
                                // 30-day revenue trend, one bar per day
                                const byDay = {};
                                stats.daily.forEach(d => { byDay[(d.day || '').slice(0, 10)] = d.revenue; });
                                const bars = [];
                                for (let i = 29; i >= 0; i--) {
                                    const dt = new Date(Date.now() - i * 86400000);
                                    const k = dt.toISOString().slice(0, 10);
                                    bars.push({ k, v: byDay[k] || 0 });
                                }
                                const max = Math.max(1, ...bars.map(b => b.v));
                                return (
                                    <div style={{ marginTop: 14 }}>
                                        <Text variant="bodySm" tone="subdued">Revenue per day</Text>
                                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 64, marginTop: 6 }}>
                                            {bars.map((b, i) => (
                                                <div key={i} title={`${b.k}: $${(Math.round(b.v * 100) / 100).toFixed(2)}`}
                                                    style={{ flex: 1, height: Math.max(2, Math.round((b.v / max) * 64)) + 'px', background: b.v > 0 ? '#1a4d2e' : '#eceae2', borderRadius: 2 }}></div>
                                            ))}
                                        </div>
                                        <InlineStack align="space-between"><Text variant="bodyXs" tone="subdued">30 days ago</Text><Text variant="bodyXs" tone="subdued">today</Text></InlineStack>
                                    </div>
                                );
                            })()}
                        </div>
                    )}
                    {stats?.analytics?.plants?.length > 0 && (
                        <div style={{ marginBottom: '1.2rem', background: '#fff', border: '1px solid #e8e6df', borderRadius: 14, padding: '14px 18px' }}>
                            <InlineStack align="space-between" blockAlign="center">
                                <Text variant="headingMd">🏆 Top sellers — last 30 days</Text>
                                <Button url="/analytics" size="slim" variant="tertiary">All houseplants by sales →</Button>
                            </InlineStack>
                            <BlockStack gap="150">
                                {stats.analytics.plants.slice(0, 5).map((p, i) => (
                                    <InlineStack key={p.shopify_product_id} align="space-between" blockAlign="center">
                                        <Text variant="bodyMd" fontWeight="semibold">{i + 1}. {p.title}</Text>
                                        <InlineStack gap="200">
                                            <Badge>{`${p.units} sold`}</Badge>
                                            <Badge tone="success">{`$${(Math.round(p.revenue * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}</Badge>
                                        </InlineStack>
                                    </InlineStack>
                                ))}
                            </BlockStack>
                        </div>
                    )}
                    <BlockStack gap="200">
                        <Text variant="heading2xl" as="h1">Welcome back!</Text>
                        <Text variant="bodyLg" tone="subdued">Houseplant App — manage your plant bundles, plant stock, and pot stock with ease.</Text>

                        <div style={{
                            marginTop: '1rem',
                            padding: '12px 18px',
                            background: 'rgba(143, 177, 73, 0.1)',
                            borderLeft: '4px solid #8fb149',
                            borderRadius: '0 12px 12px 0',
                            display: 'inline-block'
                        }}>
                            <InlineStack gap="200" blockAlign="center">
                                <Leaf size={16} color="#1a4d2e" />
                                <Text variant="bodySm" fontWeight="semibold" tone="success">
                                    Quick Care Tip: Madagascar Palms (Pachypodium) thrive in bright direct sun. Keep soil dry between waterings!
                                </Text>
                            </InlineStack>
                        </div>
                    </BlockStack>
                </motion.div>

                <AnimatePresence>
                    {error && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            style={{ marginBottom: '2rem' }}
                        >
                            <Banner title="Connection Warning" tone="warning" onDismiss={() => setError(false)}>
                                <p>There was an issue connecting to the backend. Please check your Shopify API credentials in the Settings.</p>
                            </Banner>
                        </motion.div>
                    )}
                </AnimatePresence>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginBottom: '3rem' }}>
                    <StatCard
                        title="Pot Library"
                        value={stats?.totalColors || 0}
                        label="Available pot styles"
                        icon={Palette}
                        color="#2b6cb0"
                        delay={0.1}
                    />
                    <StatCard
                        title="Total Pot Inventory"
                        value={stats?.totalPots || 0}
                        label={stats?.lowStockItems > 0 ? `${stats.lowStockItems} low stock alerts` : "Stock levels healthy"}
                        icon={BoxIcon}
                        color={stats?.lowStockItems > 0 ? "#c05621" : "#2f855a"}
                        delay={0.2}
                    />
                    <StatCard
                        title="Plant Products"
                        value={stats?.configuredProducts || 0}
                        label="Each has its own plant inventory"
                        icon={Package}
                        color="#6b46c1"
                        delay={0.3}
                    />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '3rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.5, delay: 0.4 }}
                            className="premium-card"
                            style={{ padding: 0 }}
                        >
                            <Card padding="0">
                                <Box padding="400">
                                    <InlineStack align="space-between" blockAlign="center">
                                        <Text variant="headingMd">🌿 Recently Configured</Text>
                                        <Button url="/products" variant="tertiary" size="slim">View All</Button>
                                    </InlineStack>
                                </Box>
                                <Divider />
                                <div style={{ padding: '0 16px' }}>
                                    {[
                                        { title: 'Madagascar Palm Plant', sizes: 2, pots: 3, date: '2h ago' },
                                        { title: 'Snake Plant Laurentii', sizes: 3, pots: 5, date: '5h ago' },
                                        { title: 'Monstera Deliciosa', sizes: 1, pots: 4, date: 'Yesterday' }
                                    ].map((b, i) => (
                                        <div key={i} style={{
                                            padding: '12px 0',
                                            borderBottom: i < 2 ? '1px solid #f1f2f3' : 'none',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between'
                                        }}>
                                            <InlineStack gap="300" blockAlign="center">
                                                <div style={{ width: 40, height: 40, background: '#f6f6f7', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <Leaf size={20} color="#8fb149" />
                                                </div>
                                                <BlockStack gap="0">
                                                    <Text variant="bodyMd" fontWeight="semibold">{b.title}</Text>
                                                    <Text variant="bodyXs" tone="subdued">{b.sizes} Sizes • {b.pots} Pots</Text>
                                                </BlockStack>
                                            </InlineStack>
                                            <Text variant="bodySm" tone="subdued">{b.date}</Text>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        </motion.div>

                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.5, delay: 0.5 }}
                            className="premium-card"
                        >
                            <BlockStack gap="500">
                                <InlineStack align="space-between">
                                    <InlineStack gap="200">
                                        <History size={20} className="gradient-text" />
                                        <Text variant="headingMd" as="h2">System Activity</Text>
                                    </InlineStack>
                                </InlineStack>

                                <div className="activity-list">
                                    {Array.isArray(stats?.recentActivity) && stats.recentActivity.slice(0, 5).map((item, index) => (
                                        <div key={index} className="timeline-item">
                                            <div className="timeline-point" />
                                            <div style={{ flex: 1 }}>
                                                <InlineStack align="space-between">
                                                    <Text variant="bodyMd" fontWeight="semibold">{item.event_type.replace(/_/g, ' ')}</Text>
                                                    <Badge tone="info">{item.count}</Badge>
                                                </InlineStack>
                                                <Text variant="bodySm" tone="subdued">Platform event update</Text>
                                            </div>
                                        </div>
                                    ))}
                                    {(!stats?.recentActivity || stats.recentActivity.length === 0) && (
                                        <div style={{ padding: '2rem', textAlign: 'center' }}>
                                            <AlertCircle size={32} style={{ margin: '0 auto 1rem', opacity: 0.2 }} />
                                            <Text tone="subdued">No recent activity recorded.</Text>
                                        </div>
                                    )}
                                </div>
                            </BlockStack>
                        </motion.div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.5, delay: 0.6 }}
                            className="premium-card"
                        >
                            <BlockStack gap="500">
                                <InlineStack gap="200">
                                    <PlusCircle size={20} className="gradient-text" />
                                    <Text variant="headingMd" as="h2">Quick Actions</Text>
                                </InlineStack>

                                <BlockStack gap="300">
                                    <QuickAction
                                        title="New Bundle Builder"
                                        icon={PlusCircle}
                                        to="/builder"
                                        primary
                                        delay={0.7}
                                    />
                                    <QuickAction
                                        title="Manage Pot Library"
                                        icon={Palette}
                                        to="/pot-colors"
                                        delay={0.8}
                                    />
                                    <QuickAction
                                        title="Inventory Control"
                                        icon={BoxIcon}
                                        to="/inventory"
                                        delay={0.9}
                                    />
                                    <QuickAction
                                        title="Manual Sync"
                                        icon={Settings}
                                        to="/add-product"
                                        delay={1.0}
                                    />
                                </BlockStack>
                            </BlockStack>
                        </motion.div>
                    </div>
                </div>
            </div>
        </Page>
    );
}

export default Dashboard;
