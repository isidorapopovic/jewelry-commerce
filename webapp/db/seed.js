import { query } from "./index.js";

async function seed() {
    try {
        console.log("Seeding distributor demo data...");

        await query(`
            insert into customers (name, email, phone, credit_limit)
            values
                ('Delta Foods', 'ops@deltafoods.rs', '+38160000001', 5000),
                ('Nova Market', 'buying@novamarket.rs', '+38160000002', 3000),
                ('Fresh Trade', 'accounts@freshtrade.rs', '+38160000003', 7000)
            on conflict do nothing;
        `);

        await query(`
            insert into products (sku_code, name, category, supplier, reorder_point)
            values
                ('SKU-001', 'Mineral Water 1.5L', 'Beverages', 'Aqua Supply', 40),
                ('SKU-002', 'Sparkling Juice 330ml', 'Beverages', 'Fruit Co', 30),
                ('SKU-003', 'Paper Towels 6-pack', 'Household', 'Clean Goods', 20),
                ('SKU-004', 'Dish Soap 500ml', 'Cleaning', 'Clean Goods', 25),
                ('SKU-005', 'Olive Oil 1L', 'Food', 'Mediterranean Imports', 15)
            on conflict (sku_code) do nothing;
        `);

        await query(`
            insert into inventory (product_id, current_stock, allocated_stock, last_movement_at)
            select id, 50, 20, now() - interval '2 days'
            from products
            where sku_code = 'SKU-001'
            on conflict (product_id) do update
            set current_stock = excluded.current_stock,
                allocated_stock = excluded.allocated_stock,
                last_movement_at = excluded.last_movement_at;
        `);

        await query(`
            insert into inventory (product_id, current_stock, allocated_stock, last_movement_at)
            select id, 20, 25, now() - interval '35 days'
            from products
            where sku_code = 'SKU-002'
            on conflict (product_id) do update
            set current_stock = excluded.current_stock,
                allocated_stock = excluded.allocated_stock,
                last_movement_at = excluded.last_movement_at;
        `);

        await query(`
            insert into inventory (product_id, current_stock, allocated_stock, last_movement_at)
            select id, 0, 0, now() - interval '70 days'
            from products
            where sku_code = 'SKU-003'
            on conflict (product_id) do update
            set current_stock = excluded.current_stock,
                allocated_stock = excluded.allocated_stock,
                last_movement_at = excluded.last_movement_at;
        `);

        await query(`
            insert into inventory (product_id, current_stock, allocated_stock, last_movement_at)
            select id, 18, 5, now() - interval '10 days'
            from products
            where sku_code = 'SKU-004'
            on conflict (product_id) do update
            set current_stock = excluded.current_stock,
                allocated_stock = excluded.allocated_stock,
                last_movement_at = excluded.last_movement_at;
        `);

        await query(`
            insert into inventory (product_id, current_stock, allocated_stock, last_movement_at)
            select id, 12, 2, now() - interval '95 days'
            from products
            where sku_code = 'SKU-005'
            on conflict (product_id) do update
            set current_stock = excluded.current_stock,
                allocated_stock = excluded.allocated_stock,
                last_movement_at = excluded.last_movement_at;
        `);

        console.log("Distributor demo seed complete.");
    } catch (error) {
        console.error("Seed failed:", error);
        process.exit(1);
    }
}

seed();