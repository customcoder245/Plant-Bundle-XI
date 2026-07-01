require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db/pool');

// Fix: The official package is @shopify/shopify-api
const { shopifyApi, ApiVersion } = require('@shopify/shopify-api');
const shopifyApp = require('@shopify/shopify-app-express').shopifyApp;
const { PostgreSQLSessionStorage } = require('@shopify/shopify-app-session-storage-postgresql');

// Routes will be required below after module.exports is set

const app = express();
const PORT = process.env.PORT || 3000;

// Force the PostgreSQL driver to use SSL natively to satisfy Neon DB's strict requirements
process.env.PGSSLMODE = 'no-verify';

// Use shopify-app-express for auth and session
const shopify = shopifyApp({
  api: {
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    scopes: process.env.SHOPIFY_SCOPES ? process.env.SHOPIFY_SCOPES.split(',') : [],
    hostName: (process.env.RAILWAY_PUBLIC_DOMAIN || (process.env.APP_URL ? process.env.APP_URL.replace(/https?:\/\//, '') : '')),
    apiVersion: ApiVersion.October23,
    isEmbeddedApp: true,
  },
  auth: {
    path: '/api/auth',
    callbackPath: '/api/auth/callback',
  },
  webhooks: {
    path: '/api/webhooks',
  },
  sessionStorage: new PostgreSQLSessionStorage(process.env.DATABASE_URL),
});

// Important: export shopify to use its API client in products.js
module.exports.shopify = shopify;

const authRoutes = require('./routes/auth');
const potRoutes = require('./routes/pots');
const inventoryRoutes = require('./routes/inventory');
const plantInventoryRoutes = require('./routes/plantInventory');
const collectionRoutes = require('./routes/collections');
const productConfigRoutes = require('./routes/productConfig');
const imageRoutes = require('./routes/images');
const webhookRoutes = require('./routes/webhooks');
const activityRoutes = require('./routes/activity');
const productRoutes = require('./routes/products'); // New route file
const noPotDiscountRoutes = require('./routes/noPotDiscounts');
const potPriceRoutes = require('./routes/potPrices');
const webhookAdminRoutes = require('./routes/webhookAdmin');
const analyticsRoutes = require('./routes/analytics');
const appSettingsRoutes = require('./routes/appSettings');
const { ensureWebhooks } = require('./services/webhookService');

app.use(cors());
app.use(express.json({
  verify: (req, res, buf) => {
    if (req.originalUrl.includes('/webhooks')) {
      req.rawBody = buf;
    }
  }
}));

// Shopify auth routes
app.get('/api/auth', shopify.auth.begin());
app.get('/api/auth/callback', shopify.auth.callback(), (req, res) => {
  const shop = req.query.shop;
  const host = req.query.host;
  res.redirect(`/?shop=${shop}&host=${host}`);
});

// Secure all /api/* routes with session validation (excluding auth and webhooks)
// app.use('/api/*', shopify.validateAuthenticatedSession());  <-- You can use this for production

// Your routes
app.use('/api/pots', potRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/plant-inventory', plantInventoryRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/product-config', productConfigRoutes);
app.use('/api/images', imageRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/products', productRoutes); // New
app.use('/api/no-pot-discounts', noPotDiscountRoutes);
app.use('/api/pot-prices', potPriceRoutes);
app.use('/api/webhook-admin', webhookAdminRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/app-settings', appSettingsRoutes);

// Webhooks (raw body)
app.use('/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

// Add CSP header to allow Shopify to embed this app in an iframe
app.use((req, res, next) => {
  const shop = req.query.shop || req.headers['x-shopify-shop-domain'];
  if (shop) {
    res.setHeader('Content-Security-Policy', `frame-ancestors https://${shop} https://admin.shopify.com;`);
  } else {
    res.setHeader('Content-Security-Policy', `frame-ancestors https://*.myshopify.com https://admin.shopify.com;`);
  }
  next();
});

// Health check (must be before the catch-all)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Always serve the React frontend
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});


// Auto-run DB migrations on startup
async function runMigrations() {
  try {
    const migrations = `
      CREATE TABLE IF NOT EXISTS pot_colors (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, type VARCHAR(100), hex_code VARCHAR(7) NOT NULL, display_order INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS pot_inventory (id SERIAL PRIMARY KEY, pot_color_id INTEGER REFERENCES pot_colors(id) ON DELETE CASCADE, size VARCHAR(50) NOT NULL, quantity INTEGER DEFAULT 0, low_stock_threshold INTEGER DEFAULT 10, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(pot_color_id, size));
      CREATE TABLE IF NOT EXISTS product_pot_config (id SERIAL PRIMARY KEY, shopify_product_id BIGINT NOT NULL UNIQUE, product_title VARCHAR(255), is_enabled BOOLEAN DEFAULT true, no_pot_discount DECIMAL(10,2) DEFAULT 10.00, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS size_mappings (id SERIAL PRIMARY KEY, product_config_id INTEGER REFERENCES product_pot_config(id) ON DELETE CASCADE, shopify_variant_id BIGINT NOT NULL, variant_title VARCHAR(255), pot_size VARCHAR(50) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS plant_inventory (id SERIAL PRIMARY KEY, product_config_id INTEGER REFERENCES product_pot_config(id) ON DELETE CASCADE, shopify_variant_id BIGINT NOT NULL UNIQUE, size VARCHAR(50), sku VARCHAR(100), barcode VARCHAR(100), quantity INTEGER DEFAULT 0, low_stock_threshold INTEGER DEFAULT 10, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      ALTER TABLE plant_inventory ADD COLUMN IF NOT EXISTS sku VARCHAR(100);
      ALTER TABLE plant_inventory ADD COLUMN IF NOT EXISTS barcode VARCHAR(100);
      CREATE TABLE IF NOT EXISTS composite_images (id SERIAL PRIMARY KEY, product_config_id INTEGER REFERENCES product_pot_config(id) ON DELETE CASCADE, pot_color_id INTEGER REFERENCES pot_colors(id) ON DELETE CASCADE, size VARCHAR(50), image_url TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS activity_log (id SERIAL PRIMARY KEY, event_type VARCHAR(50) NOT NULL, description TEXT, metadata JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS synced_collections (id SERIAL PRIMARY KEY, shopify_collection_id BIGINT NOT NULL UNIQUE, title VARCHAR(255), handle VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS no_pot_discounts (id SERIAL PRIMARY KEY, plant_size VARCHAR(100) NOT NULL UNIQUE, amount DECIMAL(10,2) NOT NULL DEFAULT 10.00, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      ALTER TABLE pot_colors ADD COLUMN IF NOT EXISTS image_url TEXT;
      ALTER TABLE no_pot_discounts ADD COLUMN IF NOT EXISTS pots_offered BOOLEAN DEFAULT true;
      ALTER TABLE size_mappings ADD COLUMN IF NOT EXISTS pots_enabled BOOLEAN;
      ALTER TABLE size_mappings ADD COLUMN IF NOT EXISTS pot_price_adjust DECIMAL(10,2) DEFAULT 0;
      ALTER TABLE size_mappings ADD COLUMN IF NOT EXISTS with_pot_price_override DECIMAL(10,2);
      ALTER TABLE size_mappings ADD COLUMN IF NOT EXISTS base_price DECIMAL(10,2);
      ALTER TABLE pot_prices ADD COLUMN IF NOT EXISTS no_pot_deduction DECIMAL(10,2);
      ALTER TABLE product_pot_config ADD COLUMN IF NOT EXISTS product_image_url TEXT;
      CREATE TABLE IF NOT EXISTS houseplant_sales (id SERIAL PRIMARY KEY, product_config_id INTEGER, shopify_product_id BIGINT, product_title VARCHAR(255), size VARCHAR(100), with_pot BOOLEAN DEFAULT false, pot_color VARCHAR(100), quantity INTEGER NOT NULL, revenue DECIMAL(12,2) DEFAULT 0, order_id BIGINT, order_number VARCHAR(50), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX IF NOT EXISTS idx_hp_sales_created ON houseplant_sales(created_at DESC);
      CREATE TABLE IF NOT EXISTS app_settings (key VARCHAR(100) PRIMARY KEY, value TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS product_views_daily (id SERIAL PRIMARY KEY, shopify_product_id BIGINT NOT NULL, day DATE NOT NULL, views INTEGER DEFAULT 0, UNIQUE(shopify_product_id, day));
      CREATE TABLE IF NOT EXISTS pot_prices (id SERIAL PRIMARY KEY, pot_size VARCHAR(50) NOT NULL UNIQUE, price DECIMAL(10,2) NOT NULL DEFAULT 10.00, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      ALTER TABLE no_pot_discounts ADD COLUMN IF NOT EXISTS bare_root_option BOOLEAN;
      INSERT INTO pot_prices (pot_size, price) VALUES ('4"', 5.00), ('6"', 15.00), ('1 gal', 15.00), ('2 gal', 20.00), ('3 gal', 25.00) ON CONFLICT (pot_size) DO NOTHING;
    `;
    await pool.query(migrations);
    console.log('Database migrations completed successfully');
  } catch (err) {
    console.error('Migration error (non-fatal):', err.message);
  }
}

if (require.main === module) {
  runMigrations().then(() => {
    app.listen(PORT, () => {
  // Order webhooks = inventory deduction. Keep them registered automatically.
  ensureWebhooks().catch(e => console.error('Webhook auto-registration failed:', e.message));

  // Scheduled plant-stock pull from Shopify (staff edit counts there too).
  // PLANT_SYNC_INTERVAL_HOURS: default 24, set 0 to disable.
  const syncHours = process.env.PLANT_SYNC_INTERVAL_HOURS === undefined ? 24 : parseFloat(process.env.PLANT_SYNC_INTERVAL_HOURS);
  if (syncHours > 0) {
    const { syncPlantInventoryFromShopify } = require('./services/inventoryService');
    const { logActivity } = require('./services/activityService');
    setInterval(async () => {
      try {
        const r = await syncPlantInventoryFromShopify();
        await logActivity('PLANT_SYNC_SCHEDULED', `Scheduled plant sync: ${r.updatedCount} size(s) updated from Shopify`, { updated: r.updatedCount });
        console.log(`Scheduled plant sync done: ${r.updatedCount} updated`);
      } catch (e) {
        console.error('Scheduled plant sync failed:', e.message);
      }
    }, syncHours * 3600 * 1000);
    console.log(`Scheduled plant sync every ${syncHours}h`);
  }
      console.log(`Houseplant App running on port ${PORT}`);
    });
  });
}
