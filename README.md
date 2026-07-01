# Houseplant App

Shopify app for selling houseplants with pots as bundled products, with separate plant and pot inventory tracking.

## Features
- Dual Inventory Tracking: Deducts both plant AND pot inventory independently on every order
- Per-Plant Inventory: Each plant size has its own stock count, SKU and barcode (Plant Inventory page)
- Global Pot Inventory: Pots are a single shared pool across all plant products (Pot Inventory page)
- Collection Picker: Choose which Shopify collections to sync (Collections page) - avoids importing the whole catalog
- "No Pot" Option: Customers can opt out for a discount (plant still deducts, pot does not)
- Admin Dashboard: Manage pot colors, plant stock, pot stock, product configurations
- Theme Extension: Pot color selector widget for product pages
- Composite Images: Plant+pot combination images
- Webhook Integration: Automatic inventory updates on orders

## Tech Stack
- Backend: Node.js + Express
- Frontend: React + Shopify Polaris
- Database: PostgreSQL
- Deployment: Railway (recommended)

## Quick Start

```bash
# 1. Install dependencies
npm install
cd client && npm install && cd ..

# 2. Configure environment
cp .env.example .env
# Edit .env with your Shopify credentials

# 3. Setup database
npm run db:migrate
npm run db:seed

# 4. Run development server
npm run dev
```

## Webhook Setup
Register in Shopify Admin > Settings > Notifications:
- orders/create -> https://your-app.railway.app/webhooks/orders/create
- orders/cancelled -> https://your-app.railway.app/webhooks/orders/cancelled
- orders/refunded -> https://your-app.railway.app/webhooks/orders/refunded

## Database Schema
- pot_colors: id, name, hex_code, display_order, is_active
- pot_inventory: id, pot_color_id, size, quantity, low_stock_threshold (single shared pool)
- plant_inventory: id, product_config_id, shopify_variant_id, size, sku, barcode, quantity, low_stock_threshold (per plant size)
- product_pot_config: id, shopify_product_id, product_title, is_enabled, no_pot_discount
- size_mappings: id, product_config_id, shopify_variant_id, variant_title, pot_size
- synced_collections: id, shopify_collection_id, title, handle (which collections to sync)
- composite_images: id, product_config_id, pot_color_id, size, image_url
- activity_log: id, event_type, description, metadata

## License
MIT
