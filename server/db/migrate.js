require('dotenv').config();
const pool = require('./pool');

const migrations = `
CREATE TABLE IF NOT EXISTS pot_colors (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(100),
  hex_code VARCHAR(7) NOT NULL,
  image_url TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pot_inventory (
  id SERIAL PRIMARY KEY,
  pot_color_id INTEGER REFERENCES pot_colors(id) ON DELETE CASCADE,
  size VARCHAR(50) NOT NULL,
  quantity INTEGER DEFAULT 0,
  low_stock_threshold INTEGER DEFAULT 10,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(pot_color_id, size)
);

CREATE TABLE IF NOT EXISTS product_pot_config (
  id SERIAL PRIMARY KEY,
  shopify_product_id BIGINT NOT NULL UNIQUE,
  product_title VARCHAR(255),
  is_enabled BOOLEAN DEFAULT true,
  no_pot_discount DECIMAL(10,2) DEFAULT 10.00,
  product_image_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS size_mappings (
  id SERIAL PRIMARY KEY,
  product_config_id INTEGER REFERENCES product_pot_config(id) ON DELETE CASCADE,
  shopify_variant_id BIGINT NOT NULL,
  variant_title VARCHAR(255),
  pot_size VARCHAR(50) NOT NULL,
  pots_enabled BOOLEAN,
  pot_price_adjust DECIMAL(10,2) DEFAULT 0,
  with_pot_price_override DECIMAL(10,2),
  base_price DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plant_inventory (
  id SERIAL PRIMARY KEY,
  product_config_id INTEGER REFERENCES product_pot_config(id) ON DELETE CASCADE,
  shopify_variant_id BIGINT NOT NULL UNIQUE,
  size VARCHAR(50),
  sku VARCHAR(100),
  barcode VARCHAR(100),
  quantity INTEGER DEFAULT 0,
  low_stock_threshold INTEGER DEFAULT 10,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS no_pot_discounts (
  id SERIAL PRIMARY KEY,
  plant_size VARCHAR(100) NOT NULL UNIQUE,
  amount DECIMAL(10,2) NOT NULL DEFAULT 10.00,
  pots_offered BOOLEAN DEFAULT true,
  bare_root_option BOOLEAN,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pot_prices (
  id SERIAL PRIMARY KEY,
  pot_size VARCHAR(50) NOT NULL UNIQUE,
  price DECIMAL(10,2) NOT NULL DEFAULT 10.00,
  no_pot_deduction DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS houseplant_sales (
  id SERIAL PRIMARY KEY,
  product_config_id INTEGER,
  shopify_product_id BIGINT,
  product_title VARCHAR(255),
  size VARCHAR(100),
  with_pot BOOLEAN DEFAULT false,
  pot_color VARCHAR(100),
  quantity INTEGER NOT NULL,
  revenue DECIMAL(12,2) DEFAULT 0,
  order_id BIGINT,
  order_number VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hp_sales_created ON houseplant_sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hp_sales_product ON houseplant_sales(shopify_product_id);

CREATE TABLE IF NOT EXISTS product_views_daily (
  id SERIAL PRIMARY KEY,
  shopify_product_id BIGINT NOT NULL,
  day DATE NOT NULL,
  views INTEGER DEFAULT 0,
  UNIQUE(shopify_product_id, day)
);

CREATE TABLE IF NOT EXISTS composite_images (
  id SERIAL PRIMARY KEY,
  product_config_id INTEGER REFERENCES product_pot_config(id) ON DELETE CASCADE,
  pot_color_id INTEGER REFERENCES pot_colors(id) ON DELETE CASCADE,
  size VARCHAR(50),
  image_url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS synced_collections (
  id SERIAL PRIMARY KEY,
  shopify_collection_id BIGINT NOT NULL UNIQUE,
  title VARCHAR(255),
  handle VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pot_inventory_color_size ON pot_inventory(pot_color_id, size);
CREATE INDEX IF NOT EXISTS idx_product_config_shopify_id ON product_pot_config(shopify_product_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);
`;

async function migrate() {
  try {
    await pool.query(migrations);
    console.log('Database migrations completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
