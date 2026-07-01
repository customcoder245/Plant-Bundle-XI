const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { logActivity } = require('../services/activityService');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// POST /api/pots/colors/:id/image - upload a pot photo to Shopify Files (CDN)
// and set it as this color's swatch thumbnail (image_url).


router.get('/colors', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM pot_colors WHERE is_active = true ORDER BY display_order');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/colors', async (req, res) => {
    const { name, type, hex_code, display_order, image_url } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO pot_colors (name, type, hex_code, display_order, image_url) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [name, type, hex_code || '#000', display_order || 0, image_url]
        );

        await logActivity('POT_COLOR_CREATED', `Created pot color: ${name}`, { color_id: result.rows[0].id });
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/colors/:id', async (req, res) => {
    const { id } = req.params;
    const { name, type, hex_code, display_order, is_active, image_url } = req.body;
    try {
        const result = await pool.query(
            `UPDATE pot_colors SET 
                name = COALESCE($1, name), 
                type = COALESCE($2, type), 
                hex_code = COALESCE($3, hex_code), 
                display_order = COALESCE($4, display_order), 
                is_active = COALESCE($5, is_active), 
                image_url = COALESCE($6, image_url), 
                updated_at = CURRENT_TIMESTAMP 
             WHERE id = $7 RETURNING *`,
            [name || null, type || null, hex_code || null, display_order || null, is_active !== undefined ? is_active : null, image_url || null, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pot color not found' });
        }

        await logActivity('POT_COLOR_UPDATED', `Updated pot color: ${result.rows[0].name}`, { color_id: id });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Pot Update Error:', error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/colors/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM pot_colors WHERE id = $1', [id]);
        await logActivity('POT_COLOR_DELETED', `Deleted pot color ID: ${id}`, { color_id: id });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// ─── POT IMAGE UPLOAD (Shopify Files via staged upload) ─────────────────────
async function gql(shop, token, query, variables) {
    const r = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables })
    });
    const d = await r.json();
    if (!r.ok || d.errors) throw new Error('Shopify GraphQL: ' + JSON.stringify(d.errors || d).slice(0, 300));
    return d.data;
}

router.post('/colors/:id/image', upload.single('image'), async (req, res) => {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    const token = process.env.ADMIN_API || process.env.SHOPIFY_ACCESS_TOKEN;
    if (!shop || !token) return res.status(500).json({ error: 'Shopify credentials not configured' });
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });
    try {
        // 1. staged upload target
        const staged = await gql(shop, token, `
          mutation($input: [StagedUploadInput!]!) {
            stagedUploadsCreate(input: $input) {
              stagedTargets { url resourceUrl parameters { name value } }
              userErrors { message }
            }
          }`, { input: [{ filename: req.file.originalname || 'pot.png', mimeType: req.file.mimetype || 'image/png', httpMethod: 'POST', resource: 'FILE' }] });
        const target = staged.stagedUploadsCreate.stagedTargets[0];
        if (!target) throw new Error('No staged upload target: ' + JSON.stringify(staged.stagedUploadsCreate.userErrors));

        // 2. upload the bytes
        const form = new FormData();
        for (const p of target.parameters) form.append(p.name, p.value);
        form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype || 'image/png' }), req.file.originalname || 'pot.png');
        const up = await fetch(target.url, { method: 'POST', body: form });
        if (!up.ok && up.status !== 201) throw new Error(`Staged upload failed (${up.status})`);

        // 3. create the file
        const created = await gql(shop, token, `
          mutation($files: [FileCreateInput!]!) {
            fileCreate(files: $files) {
              files { id }
              userErrors { message }
            }
          }`, { files: [{ originalSource: target.resourceUrl, contentType: 'IMAGE' }] });
        const fileId = created.fileCreate.files?.[0]?.id;
        if (!fileId) throw new Error('fileCreate failed: ' + JSON.stringify(created.fileCreate.userErrors));

        // 4. poll until Shopify processes it and hands us the CDN URL
        let url = null;
        for (let i = 0; i < 10 && !url; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const node = await gql(shop, token, `
              query($id: ID!) { node(id: $id) { ... on MediaImage { image { url } fileStatus } } }`, { id: fileId });
            url = node.node?.image?.url || null;
            if (node.node?.fileStatus === 'FAILED') throw new Error('Shopify could not process the image');
        }
        if (!url) throw new Error('Image is still processing - try saving again in a minute');

        // 5. save as the swatch thumbnail
        const result = await pool.query(
            'UPDATE pot_colors SET image_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
            [url, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Pot color not found' });
        await logActivity('POT_IMAGE_UPDATED', `New swatch image for pot color "${result.rows[0].name}"`, { color_id: req.params.id, url });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Pot image upload failed:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
