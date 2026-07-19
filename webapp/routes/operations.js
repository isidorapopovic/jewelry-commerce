import express from "express";
import { query } from "../db/index.js";

const router = express.Router();

router.get("/dashboard", async (req, res) => {
    try {
        const kpiQuery = `
            with order_stats as (
                select
                    count(*) filter (
                        where requested_delivery_date = current_date
                          and status not in ('Delivered', 'Cancelled')
                    ) as orders_due_today,

                    count(*) filter (
                        where requested_delivery_date < current_date
                          and status not in ('Delivered', 'Cancelled')
                    ) as orders_late,

                    coalesce(sum(total_value) filter (
                        where order_date = current_date
                          and status <> 'Cancelled'
                    ), 0) as todays_sales
                from orders
            ),
            inventory_stats as (
                select
                    count(*) filter (
                        where (i.current_stock - i.allocated_stock) <= p.reorder_point
                    ) as low_stock_skus
                from products p
                join inventory i on i.product_id = p.id
            ),
            delivery_stats as (
                select
                    count(*) filter (
                        where status in ('Scheduled', 'In Progress')
                    ) as deliveries_in_progress
                from deliveries
            ),
            invoice_stats as (
                select
                    count(*) filter (
                        where due_date < current_date
                          and status in ('unpaid', 'partial', 'overdue', 'sent')
                          and amount > amount_paid
                    ) as overdue_invoices
                from invoices
            ),
            collection_stats as (
                select
                    coalesce(sum(amount), 0) as this_week_collections
                from payments
                where paid_at::date >= date_trunc('week', current_date)::date
            ),
            fill_rate_stats as (
                select
                    case
                        when coalesce(sum(qty_ordered), 0) = 0 then 100
                        else round((sum(qty_shipped)::numeric / sum(qty_ordered)::numeric) * 100, 2)
                    end as fill_rate
                from order_items
            ),
            accuracy_stats as (
                select
                    case
                        when count(*) filter (where status in ('Delivered', 'Partially delivered')) = 0 then 100
                        else round(
                            (
                                count(*) filter (
                                    where status = 'Delivered' and coalesce(issue_count, 0) = 0
                                )::numeric
                                /
                                count(*) filter (where status in ('Delivered', 'Partially delivered'))::numeric
                            ) * 100,
                            2
                        )
                    end as order_accuracy
                from orders
            )
            select
                os.orders_due_today,
                os.orders_late,
                is2.low_stock_skus,
                ds.deliveries_in_progress,
                ivs.overdue_invoices,
                os.todays_sales,
                cs.this_week_collections,
                frs.fill_rate,
                acs.order_accuracy
            from order_stats os
            cross join inventory_stats is2
            cross join delivery_stats ds
            cross join invoice_stats ivs
            cross join collection_stats cs
            cross join fill_rate_stats frs
            cross join accuracy_stats acs;
        `;

        const attentionQuery = `
            select
                (
                    select json_agg(t)
                    from (
                        select
                            o.id,
                            o.order_number,
                            c.name as customer,
                            o.requested_delivery_date,
                            o.status,
                            o.total_value,
                            o.payment_status,
                            o.fulfilment_status,
                            o.assigned_driver_or_route,
                            o.notes
                        from orders o
                        join customers c on c.id = o.customer_id
                        where o.requested_delivery_date < current_date
                          and o.status not in ('Delivered', 'Cancelled')
                        order by o.requested_delivery_date asc
                        limit 10
                    ) t
                ) as late_orders,

                (
                    select json_agg(t)
                    from (
                        select
                            p.id,
                            coalesce(p.sku_code, p.sku) as sku_code,
                            p.name,
                            p.category,
                            p.supplier,
                            i.current_stock,
                            i.allocated_stock,
                            (i.current_stock - i.allocated_stock) as available_stock,
                            p.reorder_point,
                            i.last_movement_at,
                            case
                                when (i.current_stock - i.allocated_stock) < 0 then 'negative stock'
                                when (i.current_stock - i.allocated_stock) = 0 then 'stockout'
                                when (i.current_stock - i.allocated_stock) <= p.reorder_point then 'low stock'
                                when i.last_movement_at is null then 'no movement'
                                when i.last_movement_at < now() - interval '90 days' then 'no movement 90d'
                                when i.last_movement_at < now() - interval '60 days' then 'no movement 60d'
                                when i.last_movement_at < now() - interval '30 days' then 'no movement 30d'
                                else 'ok'
                            end as alert
                        from products p
                        join inventory i on i.product_id = p.id
                        where
                            (i.current_stock - i.allocated_stock) <= p.reorder_point
                            or (i.current_stock - i.allocated_stock) <= 0
                            or i.last_movement_at is null
                            or i.last_movement_at < now() - interval '30 days'
                        order by
                            (i.current_stock - i.allocated_stock) asc,
                            i.last_movement_at asc nulls first
                        limit 12
                    ) t
                ) as inventory_alerts,

                (
                    select json_agg(t)
                    from (
                        select
                            c.id,
                            c.name,
                            count(i.id) as overdue_invoice_count,
                            sum(i.amount - i.amount_paid) as overdue_amount
                        from invoices i
                        join customers c on c.id = i.customer_id
                        where i.due_date < current_date
                          and i.amount > i.amount_paid
                          and i.status in ('unpaid', 'partial', 'overdue', 'sent')
                        group by c.id, c.name
                        order by overdue_amount desc
                        limit 10
                    ) t
                ) as overdue_customers,

                (
                    select json_agg(t)
                    from (
                        select
                            d.id,
                            d.order_id,
                            o.order_number,
                            c.name as customer,
                            d.scheduled_date,
                            d.status,
                            coalesce(d.driver_name, d.route_name) as assigned
                        from deliveries d
                        join orders o on o.id = d.order_id
                        join customers c on c.id = o.customer_id
                        where d.status = 'Delayed'
                           or (d.scheduled_date < current_date and d.status not in ('Delivered', 'Failed'))
                        order by d.scheduled_date asc
                        limit 10
                    ) t
                ) as delayed_deliveries;
        `;

        const ordersQuery = `
            select
                o.id,
                o.order_number,
                c.name as customer,
                o.order_date,
                o.requested_delivery_date,
                o.status,
                o.total_value,
                o.payment_status,
                o.fulfilment_status,
                o.assigned_driver_or_route,
                o.notes,
                coalesce(sum(oi.qty_ordered), 0) as total_qty_ordered,
                coalesce(sum(oi.qty_shipped), 0) as total_qty_shipped
            from orders o
            join customers c on c.id = o.customer_id
            left join order_items oi on oi.order_id = o.id
            group by
                o.id, o.order_number, c.name, o.order_date, o.requested_delivery_date,
                o.status, o.total_value, o.payment_status, o.fulfilment_status,
                o.assigned_driver_or_route, o.notes
            order by
                case
                    when o.requested_delivery_date < current_date and o.status not in ('Delivered', 'Cancelled') then 0
                    when o.requested_delivery_date = current_date and o.status not in ('Delivered', 'Cancelled') then 1
                    else 2
                end,
                o.requested_delivery_date asc nulls last,
                o.created_at desc
            limit 20;
        `;

        const inventoryQuery = `
            select
                p.id,
                coalesce(p.sku_code, p.sku) as sku_code,
                p.name,
                p.category,
                p.supplier,
                i.current_stock,
                i.allocated_stock,
                (i.current_stock - i.allocated_stock) as available_stock,
                p.reorder_point,
                i.last_movement_at,
                case
                    when (i.current_stock - i.allocated_stock) < 0 then 'negative stock'
                    when (i.current_stock - i.allocated_stock) = 0 then 'stockout'
                    when (i.current_stock - i.allocated_stock) <= p.reorder_point then 'low stock'
                    when i.last_movement_at is null then 'no movement'
                    when i.last_movement_at < now() - interval '90 days' then 'no movement 90d'
                    when i.last_movement_at < now() - interval '60 days' then 'no movement 60d'
                    when i.last_movement_at < now() - interval '30 days' then 'no movement 30d'
                    else 'ok'
                end as alert
            from products p
            join inventory i on i.product_id = p.id
            order by
                case
                    when (i.current_stock - i.allocated_stock) < 0 then 0
                    when (i.current_stock - i.allocated_stock) = 0 then 1
                    when (i.current_stock - i.allocated_stock) <= p.reorder_point then 2
                    when i.last_movement_at is null then 3
                    when i.last_movement_at < now() - interval '30 days' then 4
                    else 5
                end,
                (i.current_stock - i.allocated_stock) asc,
                p.name asc
            limit 30;
        `;

        const [kpis, attention, orders, inventory] = await Promise.all([
            query(kpiQuery),
            query(attentionQuery),
            query(ordersQuery),
            query(inventoryQuery),
        ]);

        res.json({
            kpis: kpis.rows[0] || {},
            attention: attention.rows[0] || {},
            orders: orders.rows || [],
            inventory: inventory.rows || [],
        });
    } catch (error) {
        console.error("Operations dashboard error:", error);
        res.status(500).json({
            error: "Failed to load operations dashboard",
        });
    }
});

export default router;