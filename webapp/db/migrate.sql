-- ============================================================
-- FIRMA - Idempotent migrations
-- Runs on EVERY startup, layered on top of schema.sql.
-- Must be safe to run repeatedly and must NEVER drop data.
-- ============================================================

-- ------------------------------------------------------------
-- Product images (needed by the web shop storefront)
-- ------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;

-- ------------------------------------------------------------
-- Retire the original grocery demo products from the storefront.
-- We deactivate rather than delete so their existing order history
-- stays intact for the analytics dashboards; the shop only lists
-- active products, so these simply disappear from the shop.
-- ------------------------------------------------------------
UPDATE products
   SET is_active = FALSE
 WHERE sku IN ('SKU-001','SKU-002','SKU-003','SKU-004','SKU-005')
   AND is_active = TRUE;

-- ------------------------------------------------------------
-- Jewelry catalog — the single source of truth shared by the
-- web shop and the analytics app. Prices/stock are only set on
-- first insert; re-runs refresh presentational fields only, so
-- stock changes made by real orders are preserved.
-- ------------------------------------------------------------
INSERT INTO products
    (name, sku, sku_code, description, price, currency, stock_quantity, category, supplier, reorder_point, is_active, image_url)
VALUES
    ('Sterling Silver CZ Flower Stud Earrings','JWL-001','JWL-001','Delicate cubic zirconia flower studs set in 925 sterling silver.',29.00,'USD',40,'Earrings','Tomade',10,TRUE,'https://picsum.photos/seed/jwl001/500/500'),
    ('Gold Vermeil Chunky Hoop Earrings','JWL-002','JWL-002','14k gold vermeil hoops with a bold, everyday finish.',59.00,'USD',25,'Earrings','Tomade',8,TRUE,'https://picsum.photos/seed/jwl002/500/500'),
    ('Diamond Solitaire Pendant Necklace','JWL-003','JWL-003','Classic solitaire pendant on an 18-inch chain.',249.00,'USD',12,'Necklaces','Aurelia',5,TRUE,'https://picsum.photos/seed/jwl003/500/500'),
    ('Rose Gold Infinity Ring','JWL-004','JWL-004','Interlocking infinity band in rose gold plating.',89.00,'USD',30,'Rings','Aurelia',10,TRUE,'https://picsum.photos/seed/jwl004/500/500'),
    ('Freshwater Pearl Drop Earrings','JWL-005','JWL-005','Natural freshwater pearls on sterling silver hooks.',45.00,'USD',20,'Earrings','Marisol',8,TRUE,'https://picsum.photos/seed/jwl005/500/500'),
    ('Cubic Zirconia Tennis Bracelet','JWL-006','JWL-006','Sparkling cubic zirconia tennis bracelet with a secure clasp.',129.00,'USD',15,'Bracelets','Marisol',6,TRUE,'https://picsum.photos/seed/jwl006/500/500')
ON CONFLICT (sku) DO UPDATE
    SET image_url   = EXCLUDED.image_url,
        description = EXCLUDED.description,
        category    = EXCLUDED.category,
        name        = EXCLUDED.name;

-- ------------------------------------------------------------
-- Mirror initial stock into the inventory table that the
-- operations dashboards read. Only creates rows if missing;
-- never overwrites live stock levels.
-- ------------------------------------------------------------
INSERT INTO inventory (product_id, current_stock, allocated_stock, last_movement_at)
SELECT id, stock_quantity, 0, NOW()
FROM products
WHERE sku IN ('JWL-001','JWL-002','JWL-003','JWL-004','JWL-005','JWL-006')
ON CONFLICT (product_id) DO NOTHING;
