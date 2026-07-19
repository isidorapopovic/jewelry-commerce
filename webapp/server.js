"use strict";

import path from "path";
import fs from "fs/promises";
import express from "express";
import { fileURLToPath } from "url";

import { seedTransactions, seedAutomations } from "./data/seed-data.js";
import { query } from "./db/index.js";

import pagesRoutes from "./routes/pages.js";
import recurringRoutes from "./routes/recurringTransactions.js";
import billsRoutes from "./routes/bills.js";
import invoicesRoutes from "./routes/invoices.js";
import csvRoutes from "./routes/csv.js";
import productsRoutes from "./routes/products.js";
import operationsRoutes from "./routes/operations.js";
import importsRoutes from "./routes/imports.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

// View engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static assets
app.use(express.static(path.join(__dirname, "public")));

// Temporary in-memory seed data
let transactions = [...seedTransactions];
let automations = [...seedAutomations];

function sortTransactionsNewestFirst(rows) {
    return [...rows].sort((a, b) => {
        if (a.date < b.date) return 1;
        if (a.date > b.date) return -1;
        return 0;
    });
}

function computeTotals(rows) {
    let income = 0;
    let expense = 0;

    for (const row of rows) {
        const amount = Number(row.amount) || 0;

        if (row.type === "income") income += amount;
        if (row.type === "expense") expense += amount;
    }

    return {
        income,
        expense,
        net: income - expense
    };
}

function computeByCategory(rows) {
    const map = new Map();

    for (const row of rows) {
        const category = row.category || "Uncategorised";

        if (!map.has(category)) {
            map.set(category, {
                category,
                income: 0,
                expense: 0,
                net: 0
            });
        }

        const entry = map.get(category);
        const amount = Number(row.amount) || 0;

        if (row.type === "income") entry.income += amount;
        if (row.type === "expense") entry.expense += amount;

        entry.net = entry.income - entry.expense;
    }

    return [...map.values()].sort((a, b) => a.category.localeCompare(b.category));
}

async function initDatabase() {
    try {
        const schemaPath = path.join(__dirname, "db", "schema.sql");
        const schemaSql = await fs.readFile(schemaPath, "utf8");

        await query(schemaSql);
        console.log("✅ Database schema initialised");

        await query("SELECT refresh_overdue_statuses();");
        console.log("✅ Overdue statuses refreshed");
    } catch (err) {
        console.error("❌ Database initialisation failed:", err);
        throw err;
    }
}

// Page routes
app.use("/", pagesRoutes);
app.use("/api/operations", operationsRoutes);
app.use("/imports", importsRoutes);
// Operations page

app.get("/operations", async (req, res, next) => {
    try {
        const kpiSql = `
            WITH order_stats AS (
                SELECT
                    COUNT(*) FILTER (
                        WHERE requested_delivery_date = CURRENT_DATE
                          AND status NOT IN ('Delivered', 'Cancelled')
                    ) AS orders_due_today,
                    COUNT(*) FILTER (
                        WHERE requested_delivery_date < CURRENT_DATE
                          AND status NOT IN ('Delivered', 'Cancelled')
                    ) AS orders_late,
                    COALESCE(SUM(total_value) FILTER (
                        WHERE order_date = CURRENT_DATE
                          AND status <> 'Cancelled'
                    ), 0) AS todays_sales
                FROM orders
            ),
            inventory_stats AS (
                SELECT
                    COUNT(*) FILTER (
                        WHERE (i.current_stock - i.allocated_stock) <= p.reorder_point
                    ) AS low_stock_skus
                FROM products p
                JOIN inventory i ON i.product_id = p.id
            ),
            delivery_stats AS (
                SELECT
                    COUNT(*) FILTER (
                        WHERE status IN ('Scheduled', 'In Progress')
                    ) AS deliveries_in_progress
                FROM deliveries
            ),
            invoice_stats AS (
                SELECT
                    COUNT(*) FILTER (
                        WHERE due_date < CURRENT_DATE
                          AND status IN ('unpaid', 'partial', 'overdue', 'sent')
                          AND amount > amount_paid
                    ) AS overdue_invoices
                FROM invoices
            ),
            collection_stats AS (
                SELECT
                    COALESCE(SUM(amount), 0) AS this_week_collections
                FROM payments
                WHERE paid_at::date >= date_trunc('week', CURRENT_DATE)::date
            ),
            fill_rate_stats AS (
                SELECT
                    CASE
                        WHEN COALESCE(SUM(qty_ordered), 0) = 0 THEN 100
                        ELSE ROUND((SUM(qty_shipped)::numeric / SUM(qty_ordered)::numeric) * 100, 2)
                    END AS fill_rate
                FROM order_items
            ),
            accuracy_stats AS (
                SELECT
                    CASE
                        WHEN COUNT(*) FILTER (
                            WHERE status IN ('Delivered', 'Partially delivered')
                        ) = 0 THEN 100
                        ELSE ROUND(
                            (
                                COUNT(*) FILTER (
                                    WHERE status = 'Delivered' AND COALESCE(issue_count, 0) = 0
                                )::numeric
                                /
                                COUNT(*) FILTER (
                                    WHERE status IN ('Delivered', 'Partially delivered')
                                )::numeric
                            ) * 100,
                            2
                        )
                    END AS order_accuracy
                FROM orders
            )
            SELECT
                os.orders_due_today,
                os.orders_late,
                is2.low_stock_skus,
                ds.deliveries_in_progress,
                ivs.overdue_invoices,
                os.todays_sales,
                cs.this_week_collections,
                frs.fill_rate,
                acs.order_accuracy
            FROM order_stats os
            CROSS JOIN inventory_stats is2
            CROSS JOIN delivery_stats ds
            CROSS JOIN invoice_stats ivs
            CROSS JOIN collection_stats cs
            CROSS JOIN fill_rate_stats frs
            CROSS JOIN accuracy_stats acs;
        `;

        const lateOrdersSql = `
            SELECT
                o.id,
                o.order_number,
                c.name AS customer,
                o.order_date,
                o.requested_delivery_date,
                o.status,
                o.total_value,
                o.payment_status,
                o.fulfilment_status,
                o.assigned_driver_or_route,
                o.notes
            FROM orders o
            JOIN customers c ON c.id = o.customer_id
            WHERE o.requested_delivery_date < CURRENT_DATE
              AND o.status NOT IN ('Delivered', 'Cancelled')
            ORDER BY o.requested_delivery_date ASC
            LIMIT 10;
        `;

        const overdueCustomersSql = `
            SELECT
                c.id,
                c.name,
                COUNT(i.id) AS overdue_invoice_count,
                SUM(i.amount - i.amount_paid) AS overdue_amount
            FROM invoices i
            JOIN customers c ON c.id = i.customer_id
            WHERE i.due_date < CURRENT_DATE
              AND i.amount > i.amount_paid
              AND i.status IN ('unpaid', 'partial', 'overdue', 'sent')
            GROUP BY c.id, c.name
            ORDER BY overdue_amount DESC
            LIMIT 10;
        `;

        const delayedDeliveriesSql = `
            SELECT
                d.id,
                o.order_number,
                c.name AS customer,
                d.scheduled_date,
                d.status,
                COALESCE(d.driver_name, d.route_name, 'Unassigned') AS assigned
            FROM deliveries d
            JOIN orders o ON o.id = d.order_id
            JOIN customers c ON c.id = o.customer_id
            WHERE d.status = 'Delayed'
               OR (d.scheduled_date < CURRENT_DATE AND d.status NOT IN ('Delivered', 'Failed'))
            ORDER BY d.scheduled_date ASC
            LIMIT 10;
        `;

        const ordersSql = `
            SELECT
                o.id,
                o.order_number,
                c.name AS customer,
                o.order_date,
                o.requested_delivery_date,
                o.status,
                o.total_value,
                o.payment_status,
                o.fulfilment_status,
                o.assigned_driver_or_route,
                o.notes
            FROM orders o
            JOIN customers c ON c.id = o.customer_id
            ORDER BY
                CASE
                    WHEN o.requested_delivery_date < CURRENT_DATE
                     AND o.status NOT IN ('Delivered', 'Cancelled') THEN 0
                    WHEN o.requested_delivery_date = CURRENT_DATE
                     AND o.status NOT IN ('Delivered', 'Cancelled') THEN 1
                    ELSE 2
                END,
                o.requested_delivery_date ASC NULLS LAST,
                o.created_at DESC
            LIMIT 20;
        `;

        const inventorySql = `
            SELECT
                p.id,
                COALESCE(p.sku_code, p.sku) AS sku_code,
                p.name,
                p.category,
                p.supplier,
                i.current_stock,
                i.allocated_stock,
                (i.current_stock - i.allocated_stock) AS available_stock,
                p.reorder_point,
                i.last_movement_at,
                CASE
                    WHEN (i.current_stock - i.allocated_stock) < 0 THEN 'negative stock'
                    WHEN (i.current_stock - i.allocated_stock) = 0 THEN 'stockout'
                    WHEN (i.current_stock - i.allocated_stock) <= p.reorder_point THEN 'low stock'
                    WHEN i.last_movement_at IS NULL THEN 'no movement'
                    WHEN i.last_movement_at < NOW() - INTERVAL '90 days' THEN 'no movement 90d'
                    WHEN i.last_movement_at < NOW() - INTERVAL '60 days' THEN 'no movement 60d'
                    WHEN i.last_movement_at < NOW() - INTERVAL '30 days' THEN 'no movement 30d'
                    ELSE 'ok'
                END AS alert
            FROM products p
            JOIN inventory i ON i.product_id = p.id
            ORDER BY
                CASE
                    WHEN (i.current_stock - i.allocated_stock) < 0 THEN 0
                    WHEN (i.current_stock - i.allocated_stock) = 0 THEN 1
                    WHEN (i.current_stock - i.allocated_stock) <= p.reorder_point THEN 2
                    WHEN i.last_movement_at IS NULL THEN 3
                    WHEN i.last_movement_at < NOW() - INTERVAL '30 days' THEN 4
                    ELSE 5
                END,
                (i.current_stock - i.allocated_stock) ASC,
                p.name ASC
            LIMIT 30;
        `;

        const [
            kpiResult,
            lateOrdersResult,
            overdueCustomersResult,
            delayedDeliveriesResult,
            ordersResult,
            inventoryResult
        ] = await Promise.all([
            query(kpiSql),
            query(lateOrdersSql),
            query(overdueCustomersSql),
            query(delayedDeliveriesSql),
            query(ordersSql),
            query(inventorySql)
        ]);

        res.render("operations", {
            pageTitle: "Operations Control Tower",
            kpis: kpiResult.rows[0] || {},
            lateOrders: lateOrdersResult.rows || [],
            overdueCustomers: overdueCustomersResult.rows || [],
            delayedDeliveries: delayedDeliveriesResult.rows || [],
            orders: ordersResult.rows || [],
            inventory: inventoryResult.rows || []
        });
    } catch (err) {
        next(err);
    }
});



// Health
app.get("/health", (req, res) => {
    res.status(200).json({ ok: true });
});

// New API routes
app.use("/api/recurring-transactions", recurringRoutes);
app.use("/api/bills", billsRoutes);
app.use("/api/invoices", invoicesRoutes);
app.use("/api/csv", csvRoutes);
app.use("/api/products", productsRoutes);

// Overview API
app.get("/api/overview", (req, res) => {
    const rows = sortTransactionsNewestFirst(transactions);
    const totals = computeTotals(rows);

    res.json({
        stats: {
            transactionCount: rows.length,
            activeAutomations: automations.filter((a) => a.enabled).length
        },
        totals,
        latestTransactions: rows.slice(0, 5)
    });
});

// KPI API
app.get("/api/kpi", (req, res) => {
    const rows = sortTransactionsNewestFirst(transactions);
    const totals = computeTotals(rows);
    const byCategory = computeByCategory(rows);

    res.json({
        totals,
        byCategory
    });
});

// Transactions API
app.get("/api/transactions", (req, res) => {
    const rows = sortTransactionsNewestFirst(transactions);
    res.json({ items: rows });
});

app.post("/api/transactions", (req, res) => {
    const { date, description, category, type, amount } = req.body;

    if (!date || !description || !type || amount === undefined || amount === null || amount === "") {
        return res.status(400).json({
            error: "Date, description, type, and amount are required"
        });
    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount)) {
        return res.status(400).json({
            error: "Amount must be a valid number"
        });
    }

    const row = {
        id: `TX-${10000 + transactions.length + 1}`,
        date,
        description,
        category: category || "Uncategorised",
        type: type === "expense" ? "expense" : "income",
        amount: Math.abs(numericAmount)
    };

    transactions.unshift(row);
    res.status(201).json(row);
});

app.delete("/api/transactions/:id", (req, res) => {
    const before = transactions.length;
    transactions = transactions.filter((t) => t.id !== req.params.id);

    if (transactions.length === before) {
        return res.status(404).json({
            error: "Transaction not found"
        });
    }

    res.json({ ok: true });
});

// Automations API
app.get("/api/automations", (req, res) => {
    res.json({ items: automations });
});

app.post("/api/automations", (req, res) => {
    const { name, schedule } = req.body;

    if (!name || !schedule) {
        return res.status(400).json({
            error: "Name and schedule are required"
        });
    }

    const row = {
        id: `AUTO-${String(automations.length + 1).padStart(3, "0")}`,
        name,
        schedule,
        enabled: true
    };

    automations.unshift(row);
    res.status(201).json(row);
});

app.patch("/api/automations/:id", (req, res) => {
    const item = automations.find((a) => a.id === req.params.id);

    if (!item) {
        return res.status(404).json({
            error: "Automation not found"
        });
    }

    if (typeof req.body.enabled !== "boolean") {
        return res.status(400).json({
            error: "enabled must be true or false"
        });
    }

    item.enabled = req.body.enabled;
    res.json(item);
});

app.delete("/api/automations/:id", (req, res) => {
    const before = automations.length;
    automations = automations.filter((a) => a.id !== req.params.id);

    if (automations.length === before) {
        return res.status(404).json({
            error: "Automation not found"
        });
    }

    res.json({ ok: true });
});

// 404
app.use((req, res) => {
    res.status(404).send(`Not Found: ${req.originalUrl}`);
});

// Error handler
app.use((err, req, res, next) => {
    console.error("Server error:", err);
    res.status(500).send("Internal Server Error");
});

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        await initDatabase();

        app.listen(PORT, "0.0.0.0", () => {
            console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
        });
    } catch (err) {
        console.error("❌ Server startup aborted");
        process.exit(1);
    }
}

startServer();