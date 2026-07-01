import React, { useState, useEffect } from 'react';
import {
    Page, Layout, Card, ResourceList, ResourceItem,
    Button, Modal, FormLayout, TextField, InlineStack,
    Badge, Text, BlockStack, Box, Divider, EmptyState,
    Thumbnail, Banner
} from '@shopify/polaris';
import { PlusIcon, EditIcon, DeleteIcon, DragHandleIcon } from '@shopify/polaris-icons';
import { Palette, CheckCircle2, Package } from 'lucide-react';

function PotColors() {
    const [colors, setColors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingColor, setEditingColor] = useState(null);
    const [imgUploading, setImgUploading] = useState(false);
    const [rowImgBusy, setRowImgBusy] = useState(null);
    const [formData, setFormData] = useState({ name: '', type: '', hex_code: '#000000', display_order: 0, image_url: '' });

    const [saving, setSaving] = useState(false);

    useEffect(() => { fetchColors(); }, []);

    const fetchColors = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/pots/colors');
            const data = await res.json();
            setColors(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to fetch colors:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const url = editingColor ? `/api/pots/colors/${editingColor.id}` : '/api/pots/colors';
            const method = editingColor ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                setModalOpen(false);
                setEditingColor(null);
                setFormData({ name: '', hex_code: '#000000', display_order: 0 });
                fetchColors();
            }
        } catch (error) {
            console.error('Failed to save color:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('Warning: Deleting this color will also remove its inventory and bundle images. Continue?')) return;
        try {
            const res = await fetch(`/api/pots/colors/${id}`, { method: 'DELETE' });
            if (res.ok) fetchColors();
        } catch (error) { console.error('Failed to delete color:', error); }
    };

    const openEditModal = (color) => {
        setEditingColor(color);
        setFormData({ name: color.name, hex_code: color.hex_code, display_order: color.display_order });
        setModalOpen(true);
    };

    return (
        <Page
            title="Pot Library"
            primaryAction={{
                content: 'Add New Pot Type',
                icon: PlusIcon,
                onAction: () => {
                    setEditingColor(null);
                    setFormData({ name: '', hex_code: '#8fb149', display_order: colors.length });
                    setModalOpen(true);
                }
            }}
        >
            <BlockStack gap="500">
                <Banner tone="info">
                    These colors will appear as swatches on your product pages. Order them to control how they appear to customers.
                </Banner>

                <Card padding="0">
                    <Box padding="400">
                        <InlineStack gap="200" align="start" blockAlign="center">
                            <Palette size={20} color="#636363" />
                            <Text variant="headingMd">Available Swatches</Text>
                        </InlineStack>
                    </Box>
                    <Divider />

                    <ResourceList
                        resourceName={{ singular: 'color', plural: 'colors' }}
                        items={colors}
                        loading={loading}
                        renderItem={(color) => (
                            <ResourceItem id={color.id.toString()} verticalAlignment="center">
                                <InlineStack align="space-between" blockAlign="center">
                                    <InlineStack gap="400" blockAlign="center">
                                        <div style={{ padding: '0 8px', color: '#ccc' }}>
                                            <DragHandleIcon />
                                        </div>
                                        <div style={{
                                            width: 44, height: 44,
                                            background: '#f6f6f7',
                                            borderRadius: '8px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: '#1a4d2e',
                                            overflow: 'hidden',
                                            border: '1px solid #eee'
                                        }}>
                                            {color.image_url ? (
                                                <img src={color.image_url} alt={color.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                            ) : (
                                                <Package size={20} />
                                            )}
                                        </div>

                                        <BlockStack gap="050">
                                            <InlineStack gap="100" blockAlign="center">
                                                <Text variant="bodyMd" fontWeight="bold">{color.name}</Text>
                                                {color.type && <Badge size="small">{color.type}</Badge>}
                                            </InlineStack>
                                        </BlockStack>
                                    </InlineStack>

                                    <InlineStack gap="200">
                                        <Badge tone={color.is_active ? 'success' : 'info'}>
                                            {color.is_active ? 'Visible' : 'Hidden'}
                                        </Badge>
                                        <span onClick={(e) => e.stopPropagation()}>
                                            <input
                                                type="file" accept="image/*" id={`pot-row-file-${color.id}`} style={{ display: 'none' }}
                                                onChange={async (e) => {
                                                    const file = e.target.files && e.target.files[0];
                                                    if (!file) return;
                                                    setRowImgBusy(color.id);
                                                    const fd = new FormData();
                                                    fd.append('image', file);
                                                    try {
                                                        const res = await fetch(`/api/pots/colors/${color.id}/image`, { method: 'POST', body: fd });
                                                        const d = await res.json();
                                                        if (!res.ok) throw new Error(d.error || 'Upload failed');
                                                        fetchColors();
                                                    } catch (err) { alert(err.message); }
                                                    finally { setRowImgBusy(null); }
                                                }}
                                            />
                                            <Button loading={rowImgBusy === color.id} onClick={() => document.getElementById(`pot-row-file-${color.id}`).click()}>
                                                {color.image_url ? 'Change image' : 'Add image'}
                                            </Button>
                                        </span>
                                        <Button icon={EditIcon} onClick={() => openEditModal(color)}>Edit</Button>
                                        <Button icon={DeleteIcon} tone="critical" onClick={() => handleDelete(color.id)}>Delete</Button>
                                    </InlineStack>
                                </InlineStack>
                            </ResourceItem>
                        )}
                        emptyState={(
                            <EmptyState
                                heading="No colors created"
                                action={{ content: 'Create First Color', onAction: () => setModalOpen(true) }}
                                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                            >
                                <p>Add your pot colors here to start configuring bundles.</p>
                            </EmptyState>
                        )}
                    />
                </Card>
            </BlockStack>

            <Modal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                title={editingColor ? 'Edit Swatch' : 'Create New Swatch'}
                primaryAction={{ content: 'Save Color', onAction: handleSave, loading: saving }}
                secondaryActions={[{ content: 'Cancel', onAction: () => setModalOpen(false) }]}
            >
                <Modal.Section>
                    <FormLayout>
                        <InlineStack gap="400">
                            <div style={{ flex: 1 }}>
                                <TextField
                                    label="Pot Style / Type"
                                    value={formData.type || ''}
                                    onChange={(value) => setFormData({ ...formData, type: value })}
                                    placeholder="e.g. Ceramic White, Matte Black"
                                    autoComplete="off"
                                />
                            </div>
                            <div style={{ flex: 1 }}>
                                <TextField
                                    label="Internal Label"
                                    value={formData.name}
                                    onChange={(value) => setFormData({ ...formData, name: value })}
                                    autoComplete="off"
                                    placeholder="e.g. White Pot Small"
                                />
                            </div>
                        </InlineStack>
                        <BlockStack gap="200">
                            <InlineStack gap="300" blockAlign="center">
                                {(formData.image_url) && (
                                    <img src={formData.image_url} alt="Pot swatch" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 10, border: '1px solid #e0ddd4' }} />
                                )}
                                {editingColor ? (
                                    <span>
                                        <input
                                            type="file" accept="image/*" id="pot-image-file" style={{ display: 'none' }}
                                            onChange={async (e) => {
                                                const file = e.target.files && e.target.files[0];
                                                if (!file) return;
                                                setImgUploading(true);
                                                const fd = new FormData();
                                                fd.append('image', file);
                                                try {
                                                    const res = await fetch(`/api/pots/colors/${editingColor.id}/image`, { method: 'POST', body: fd });
                                                    const d = await res.json();
                                                    if (!res.ok) throw new Error(d.error || 'Upload failed');
                                                    setFormData(prev => ({ ...prev, image_url: d.image_url }));
                                                    fetchColors();
                                                } catch (err) { alert(err.message); }
                                                finally { setImgUploading(false); }
                                            }}
                                        />
                                        <Button loading={imgUploading} onClick={() => document.getElementById('pot-image-file').click()}>
                                            {formData.image_url ? 'Replace pot image' : 'Upload pot image'}
                                        </Button>
                                    </span>
                                ) : (
                                    <Text variant="bodySm" tone="subdued">Save the swatch first, then edit it to upload a photo.</Text>
                                )}
                            </InlineStack>
                            <TextField
                                label="Pot Image URL (or paste a link)"
                                value={formData.image_url || ''}
                                onChange={(value) => setFormData({ ...formData, image_url: value })}
                                autoComplete="off"
                                placeholder="https://cdn.shopify.com/.../pot.jpg"
                                helpText="This thumbnail shows in the Pot Library AND as the pot color swatch customers click on product pages."
                            />
                        </BlockStack>

                        <Banner tone="info">
                            <p>Pot images are now automatically pulled from your Shopify product variants to ensure 100% accuracy.</p>
                        </Banner>
                        <TextField
                            label="Sort Priority"
                            type="number"
                            value={formData.display_order.toString()}
                            onChange={(value) => setFormData({ ...formData, display_order: parseInt(value) || 0 })}
                            autoComplete="off"
                        />
                    </FormLayout>
                </Modal.Section>
            </Modal>
        </Page>
    );
}

export default PotColors;
