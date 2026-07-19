-- ============================================================
-- FIRMA - Full Database Schema
-- Neon / PostgreSQL
-- UUID-safe version
-- Updated for unified Data Import page
-- ============================================================

DROP VIEW IF EXISTS overdue_invoices;
DROP VIEW IF EXISTS upcoming_bills_view;

DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS deliveries CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS inventory CASCADE;
DROP TABLE IF EXISTS customers CASCADE;

DROP TABLE IF EXISTS bills CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS recurring_transactions CASCADE;
DROP TABLE IF EXISTS csv_imports CASCADE;
DROP TABLE IF EXISTS products CASCADE;

DROP FUNCTION IF EXISTS refresh_overdue_statuses();
DROP FUNCTION IF EXISTS update_updated_at() CASCADE;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Shared trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RECURRING TRANSACTIONS
-- ============================================================
CREATE TABLE recurring_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
    frequency VARCHAR(20) NOT NULL CHECK (
        frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')
    ),
    start_date DATE NOT NULL,
    end_date DATE,
    next_due_date DATE NOT NULL,
    last_processed_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    category VARCHAR(100),
    tags TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_recurring_transactions_updated_at ON recurring_transactions;
CREATE TRIGGER trg_recurring_transactions_updated_at
BEFORE UPDATE ON recurring_transactions
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_recurring_next_due
    ON recurring_transactions(next_due_date, is_active);

CREATE UNIQUE INDEX uq_recurring_seed
    ON recurring_transactions(name, amount, type, frequency, start_date);

-- ============================================================
-- BILLS
-- ============================================================
CREATE TABLE bills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    due_date DATE NOT NULL,
    paid_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'unpaid', 'cancelled', 'overdue')),
    category VARCHAR(100),
    vendor VARCHAR(255),
    recurring_transaction_id UUID REFERENCES recurring_transactions(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_bills_updated_at ON bills;
CREATE TRIGGER trg_bills_updated_at
BEFORE UPDATE ON bills
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_bills_due_date
    ON bills(due_date, status);

CREATE INDEX idx_bills_status
    ON bills(status);

CREATE INDEX idx_bills_recurring_transaction_id
    ON bills(recurring_transaction_id);

CREATE UNIQUE INDEX uq_bills_seed
    ON bills(name, amount, due_date, vendor);

-- ============================================================
-- PRODUCTS
-- ============================================================
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(100) UNIQUE,
    sku_code VARCHAR(100) UNIQUE,
    description TEXT,
    price NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    category VARCHAR(100),
    supplier VARCHAR(255),
    reorder_point INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_products_name
    ON products(name);

CREATE INDEX idx_products_category
    ON products(category);

CREATE INDEX idx_products_sku
    ON products(sku);

CREATE INDEX idx_products_sku_code
    ON products(sku_code);

-- ============================================================
-- CUSTOMERS
-- ============================================================
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    city TEXT,
    country TEXT,
    credit_limit NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers;
CREATE TRIGGER trg_customers_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_customers_name
    ON customers(name);

CREATE INDEX idx_customers_email
    ON customers(email);

-- ============================================================
-- ORDERS
-- ============================================================
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number TEXT NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    order_date DATE NOT NULL,
    requested_delivery_date DATE,
    status TEXT NOT NULL CHECK (
        status IN (
            'New',
            'Approved',
            'Picking',
            'Packed',
            'Out for delivery',
            'Delivered',
            'Partially delivered',
            'Blocked',
            'Cancelled'
        )
    ),
    payment_status TEXT NOT NULL DEFAULT 'Unpaid' CHECK (
        payment_status IN ('Unpaid', 'Partially Paid', 'Paid', 'Overdue')
    ),
    fulfilment_status TEXT NOT NULL DEFAULT 'Unallocated' CHECK (
        fulfilment_status IN ('Unallocated', 'Allocated', 'Partially Fulfilled', 'Fulfilled', 'Issue')
    ),
    assigned_driver_or_route TEXT,
    notes TEXT,
    total_value NUMERIC(12,2) NOT NULL DEFAULT 0,
    issue_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_order_number
    ON orders(order_number);

CREATE INDEX idx_orders_requested_delivery_date
    ON orders(requested_delivery_date);

CREATE INDEX idx_orders_status
    ON orders(status);

CREATE INDEX idx_orders_customer_id
    ON orders(customer_id);

-- ============================================================
-- INVENTORY
-- ============================================================
CREATE TABLE inventory (
    product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
    current_stock INTEGER NOT NULL DEFAULT 0,
    allocated_stock INTEGER NOT NULL DEFAULT 0,
    last_movement_at TIMESTAMPTZ
);

-- ============================================================
-- ORDER ITEMS
-- ============================================================
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    qty_ordered INTEGER NOT NULL CHECK (qty_ordered >= 0),
    qty_shipped INTEGER NOT NULL DEFAULT 0 CHECK (qty_shipped >= 0),
    unit_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
    notes TEXT
);

CREATE INDEX idx_order_items_order_id
    ON order_items(order_id);

CREATE INDEX idx_order_items_product_id
    ON order_items(product_id);

-- ============================================================
-- DELIVERIES
-- ============================================================
CREATE TABLE deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    scheduled_date DATE NOT NULL,
    delivered_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (
        status IN ('Scheduled', 'In Progress', 'Delivered', 'Delayed', 'Failed')
    ),
    driver_name TEXT,
    route_name TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deliveries_status
    ON deliveries(status);

CREATE INDEX idx_deliveries_order_id
    ON deliveries(order_id);

-- ============================================================
-- INVOICES
-- ============================================================
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_number VARCHAR(100) UNIQUE NOT NULL,
    client_name VARCHAR(255) NOT NULL,
    client_email VARCHAR(255),
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    description TEXT,
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    tax_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    total_amount NUMERIC(15, 2) GENERATED ALWAYS AS (amount + tax_amount) STORED,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE NOT NULL,
    paid_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'unpaid'
        CHECK (status IN ('draft', 'unpaid', 'partial', 'paid', 'overdue', 'cancelled', 'disputed', 'sent')),
    amount_paid NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at
BEFORE UPDATE ON invoices
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_invoices_status
    ON invoices(status);

CREATE INDEX idx_invoices_due_date
    ON invoices(due_date, status);

CREATE INDEX idx_invoices_client
    ON invoices(client_name);

CREATE INDEX idx_invoices_customer_id
    ON invoices(customer_id);

CREATE INDEX idx_invoices_order_id
    ON invoices(order_id);

CREATE INDEX idx_invoices_invoice_number
    ON invoices(invoice_number);

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    method TEXT
);

CREATE INDEX idx_payments_paid_at
    ON payments(paid_at);

CREATE INDEX idx_payments_customer_id
    ON payments(customer_id);

CREATE INDEX idx_payments_invoice_id
    ON payments(invoice_id);

-- ============================================================
-- CSV / FILE IMPORT LOG
-- ============================================================
CREATE TABLE csv_imports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filename VARCHAR(255) NOT NULL,
    entity_type VARCHAR(50) NOT NULL CHECK (
        entity_type IN (
            'recurring_transactions',
            'bills',
            'invoices',
            'customers',
            'products',
            'orders',
            'order_items'
        )
    ),
    rows_total INTEGER NOT NULL DEFAULT 0,
    rows_imported INTEGER NOT NULL DEFAULT 0,
    rows_failed INTEGER NOT NULL DEFAULT 0,
    errors JSONB,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_csv_imports_entity_type
    ON csv_imports(entity_type);

CREATE INDEX idx_csv_imports_imported_at
    ON csv_imports(imported_at DESC);

-- ============================================================
-- Views
-- ============================================================
CREATE OR REPLACE VIEW overdue_invoices AS
SELECT *
FROM invoices
WHERE status NOT IN ('paid', 'cancelled')
  AND due_date < CURRENT_DATE
ORDER BY due_date ASC;

CREATE OR REPLACE VIEW upcoming_bills_view AS
SELECT *
FROM bills
WHERE status IN ('pending', 'unpaid', 'overdue')
  AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
ORDER BY due_date ASC;

-- ============================================================
-- Function: refresh overdue statuses
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_overdue_statuses()
RETURNS void AS $$
BEGIN
    UPDATE bills
    SET status = 'overdue'
    WHERE status IN ('pending', 'unpaid')
      AND due_date < CURRENT_DATE;

    UPDATE invoices
    SET status = 'overdue'
    WHERE status IN ('unpaid', 'partial', 'sent')
      AND due_date < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Seed data
-- ============================================================

INSERT INTO recurring_transactions
(name, description, amount, currency, type, frequency, start_date, end_date, next_due_date, category, tags)
VALUES
('Office Rent', 'Monthly office lease payment', 1200.00, 'USD', 'expense', 'monthly', '2026-01-01', NULL, '2026-01-01', 'Rent', ARRAY['office','lease']),
('Software Subscriptions', 'Team software licences and SaaS subscriptions', 245.00, 'USD', 'expense', 'monthly', '2026-01-05', NULL, '2026-01-05', 'Software', ARRAY['saas','tools']),
('Client Maintenance Contract', 'Recurring maintenance income from retained client', 1800.00, 'USD', 'income', 'monthly', '2026-01-15', NULL, '2026-01-15', 'Revenue', ARRAY['client','retainer'])
ON CONFLICT DO NOTHING;

INSERT INTO bills
(name, description, amount, currency, due_date, paid_date, status, category, vendor, notes)
VALUES
('Electricity Bill', 'March electricity bill', 210.00, 'USD', '2026-04-15', NULL, 'unpaid', 'Utilities', 'Electricity Board', 'Office power usage'),
('Adobe Creative Cloud', 'Creative Cloud team plan', 96.00, 'USD', '2026-04-20', NULL, 'unpaid', 'Software', 'Adobe', 'Monthly design subscription')
ON CONFLICT DO NOTHING;

INSERT INTO customers (name, email, phone, address, city, country, credit_limit, notes)
VALUES
('Delta Foods', 'ops@deltafoods.rs', '+38160000001', 'Industrial Zone 1', 'Belgrade', 'Serbia', 5000, NULL),
('Nova Market', 'buying@novamarket.rs', '+38160000002', 'Market Street 12', 'Novi Sad', 'Serbia', 3000, NULL),
('Fresh Trade', 'accounts@freshtrade.rs', '+38160000003', 'Warehouse Road 7', 'Niš', 'Serbia', 7000, NULL)
ON CONFLICT DO NOTHING;

INSERT INTO products (name, sku, sku_code, description, price, currency, stock_quantity, category, supplier, reorder_point, is_active)
VALUES
('Mineral Water 1.5L', 'SKU-001', 'SKU-001', 'Distributor demo product', 6.00, 'USD', 50, 'Beverages', 'Aqua Supply', 40, TRUE),
('Sparkling Juice 330ml', 'SKU-002', 'SKU-002', 'Distributor demo product', 22.00, 'USD', 20, 'Beverages', 'Fruit Co', 30, TRUE),
('Paper Towels 6-pack', 'SKU-003', 'SKU-003', 'Distributor demo product', 25.00, 'USD', 0, 'Household', 'Clean Goods', 20, TRUE),
('Dish Soap 500ml', 'SKU-004', 'SKU-004', 'Distributor demo product', 15.00, 'USD', 18, 'Cleaning', 'Clean Goods', 25, TRUE),
('Olive Oil 1L', 'SKU-005', 'SKU-005', 'Distributor demo product', 50.00, 'USD', 12, 'Food', 'Mediterranean Imports', 15, TRUE)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO inventory (product_id, current_stock, allocated_stock, last_movement_at)
SELECT id,
       CASE sku
         WHEN 'SKU-001' THEN 50
         WHEN 'SKU-002' THEN 20
         WHEN 'SKU-003' THEN 0
         WHEN 'SKU-004' THEN 18
         WHEN 'SKU-005' THEN 12
       END,
       CASE sku
         WHEN 'SKU-001' THEN 20
         WHEN 'SKU-002' THEN 25
         WHEN 'SKU-003' THEN 0
         WHEN 'SKU-004' THEN 5
         WHEN 'SKU-005' THEN 2
       END,
       CASE sku
         WHEN 'SKU-001' THEN NOW() - INTERVAL '2 days'
         WHEN 'SKU-002' THEN NOW() - INTERVAL '35 days'
         WHEN 'SKU-003' THEN NOW() - INTERVAL '70 days'
         WHEN 'SKU-004' THEN NOW() - INTERVAL '10 days'
         WHEN 'SKU-005' THEN NOW() - INTERVAL '95 days'
       END
FROM products
WHERE sku IN ('SKU-001', 'SKU-002', 'SKU-003', 'SKU-004', 'SKU-005')
ON CONFLICT (product_id) DO NOTHING;

INSERT INTO orders (
    order_number,
    customer_id,
    order_date,
    requested_delivery_date,
    status,
    payment_status,
    fulfilment_status,
    assigned_driver_or_route,
    notes,
    total_value,
    issue_count
)
SELECT
    seed.order_number,
    c.id,
    seed.order_date,
    seed.requested_delivery_date,
    seed.status,
    seed.payment_status,
    seed.fulfilment_status,
    seed.assigned_driver_or_route,
    seed.notes,
    seed.total_value,
    seed.issue_count
FROM (
    VALUES
    ('ORD-1001', 'Delta Foods', CURRENT_DATE, CURRENT_DATE, 'Approved', 'Unpaid', 'Allocated', 'Route A / Driver Marko', 'Due today and ready for picking', 480.00, 0),
    ('ORD-1002', 'Nova Market', CURRENT_DATE - INTERVAL '2 days', CURRENT_DATE - INTERVAL '1 day', 'Picking', 'Overdue', 'Partially Fulfilled', 'Route B / Driver Ivan', 'Missing part of stock for one SKU', 920.00, 1),
    ('ORD-1003', 'Fresh Trade', CURRENT_DATE - INTERVAL '3 days', CURRENT_DATE + INTERVAL '1 day', 'Out for delivery', 'Partially Paid', 'Fulfilled', 'Route C / Driver Ana', 'Customer requested call before arrival', 300.00, 0),
    ('ORD-1004', 'Delta Foods', CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE - INTERVAL '3 days', 'Blocked', 'Overdue', 'Issue', 'Unassigned', 'Blocked due to overdue balance', 1250.00, 2),
    ('ORD-1005', 'Nova Market', CURRENT_DATE, CURRENT_DATE + INTERVAL '2 days', 'New', 'Unpaid', 'Unallocated', NULL, 'New order waiting approval', 210.00, 0)
) AS seed(
    order_number,
    customer_name,
    order_date,
    requested_delivery_date,
    status,
    payment_status,
    fulfilment_status,
    assigned_driver_or_route,
    notes,
    total_value,
    issue_count
)
JOIN customers c ON c.name = seed.customer_name
ON CONFLICT (order_number) DO NOTHING;

INSERT INTO order_items (order_id, product_id, qty_ordered, qty_shipped, unit_price, notes)
SELECT o.id, p.id, seed.qty_ordered, seed.qty_shipped, seed.unit_price, seed.notes
FROM (
    VALUES
    ('ORD-1001', 'SKU-001', 20, 20, 6.00, NULL),
    ('ORD-1001', 'SKU-002', 10, 10, 36.00, NULL),
    ('ORD-1002', 'SKU-001', 30, 20, 6.00, 'Partial shipment'),
    ('ORD-1002', 'SKU-003', 15, 5, 22.00, 'Stock shortage'),
    ('ORD-1003', 'SKU-004', 12, 12, 25.00, NULL),
    ('ORD-1004', 'SKU-002', 25, 0, 50.00, 'Blocked order'),
    ('ORD-1005', 'SKU-005', 14, 0, 15.00, 'Awaiting allocation')
) AS seed(order_number, sku, qty_ordered, qty_shipped, unit_price, notes)
JOIN orders o ON o.order_number = seed.order_number
JOIN products p ON p.sku = seed.sku
ON CONFLICT DO NOTHING;

INSERT INTO deliveries (
    order_id,
    scheduled_date,
    delivered_at,
    status,
    driver_name,
    route_name,
    notes
)
SELECT o.id, seed.scheduled_date, seed.delivered_at, seed.status, seed.driver_name, seed.route_name, seed.notes
FROM (
    VALUES
    ('ORD-1001', CURRENT_DATE, NULL::timestamptz, 'Scheduled', 'Marko', 'Route A', 'Morning route'),
    ('ORD-1002', CURRENT_DATE - INTERVAL '1 day', NULL::timestamptz, 'Delayed', 'Ivan', 'Route B', 'Vehicle issue caused delay'),
    ('ORD-1003', CURRENT_DATE, NULL::timestamptz, 'In Progress', 'Ana', 'Route C', 'On route')
) AS seed(order_number, scheduled_date, delivered_at, status, driver_name, route_name, notes)
JOIN orders o ON o.order_number = seed.order_number
ON CONFLICT DO NOTHING;

INSERT INTO invoices (
    invoice_number,
    client_name,
    client_email,
    customer_id,
    order_id,
    description,
    amount,
    tax_amount,
    currency,
    issue_date,
    due_date,
    paid_date,
    status,
    amount_paid,
    notes
)
SELECT
    seed.invoice_number,
    seed.client_name,
    seed.client_email,
    c.id,
    o.id,
    seed.description,
    seed.amount,
    seed.tax_amount,
    seed.currency,
    seed.issue_date,
    seed.due_date,
    seed.paid_date,
    seed.status,
    seed.amount_paid,
    seed.notes
FROM (
    VALUES
    ('INV-2026-001', 'Nova Retail', 'billing@novaretail.com', 'Delta Foods', 'ORD-1001', 'Website support and monthly maintenance', 2400.00, 0.00, 'USD', DATE '2026-04-01', DATE '2026-04-14', NULL::date, 'unpaid', 0.00, 'Net 14 invoice'),
    ('INV-2026-002', 'BluePeak Studio', 'accounts@bluepeakstudio.com', 'Nova Market', 'ORD-1002', 'Brand asset production and revisions', 1350.00, 0.00, 'USD', DATE '2026-03-28', DATE '2026-04-11', NULL::date, 'overdue', 0.00, 'Follow-up reminder required'),
    ('INV-1001', 'Delta Foods', 'ops@deltafoods.rs', 'Delta Foods', 'ORD-1001', 'Order invoice', 480.00, 0.00, 'USD', CURRENT_DATE, CURRENT_DATE + INTERVAL '7 days', NULL::date, 'unpaid', 0.00, 'Distributor order invoice'),
    ('INV-1002', 'Nova Market', 'buying@novamarket.rs', 'Nova Market', 'ORD-1002', 'Order invoice', 920.00, 0.00, 'USD', CURRENT_DATE - INTERVAL '2 days', CURRENT_DATE - INTERVAL '2 days', NULL::date, 'partial', 200.00, 'Partially paid overdue invoice'),
    ('INV-1003', 'Fresh Trade', 'accounts@freshtrade.rs', 'Fresh Trade', 'ORD-1003', 'Order invoice', 300.00, 0.00, 'USD', CURRENT_DATE - INTERVAL '3 days', CURRENT_DATE + INTERVAL '5 days', NULL::date, 'partial', 150.00, 'Partially paid invoice'),
    ('INV-1004', 'Delta Foods', 'ops@deltafoods.rs', 'Delta Foods', 'ORD-1004', 'Order invoice', 1250.00, 0.00, 'USD', CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE - INTERVAL '10 days', NULL::date, 'overdue', 0.00, 'Blocked due to overdue balance')
) AS seed(
    invoice_number,
    client_name,
    client_email,
    customer_name,
    order_number,
    description,
    amount,
    tax_amount,
    currency,
    issue_date,
    due_date,
    paid_date,
    status,
    amount_paid,
    notes
)
LEFT JOIN customers c ON c.name = seed.customer_name
LEFT JOIN orders o ON o.order_number = seed.order_number
ON CONFLICT (invoice_number) DO NOTHING;

INSERT INTO payments (
    customer_id,
    invoice_id,
    amount,
    paid_at,
    method
)
SELECT c.id, i.id, seed.amount, seed.paid_at, seed.method
FROM (
    VALUES
    ('Nova Market', 'INV-1002', 200.00, NOW() - INTERVAL '3 days', 'Bank transfer'),
    ('Fresh Trade', 'INV-1003', 150.00, NOW() - INTERVAL '1 day', 'Cash')
) AS seed(customer_name, invoice_number, amount, paid_at, method)
JOIN customers c ON c.name = seed.customer_name
JOIN invoices i ON i.invoice_number = seed.invoice_number
ON CONFLICT DO NOTHING;

SELECT refresh_overdue_statuses();