# jewelry-commerce

A monorepo combining the customer-facing web shop and the back-office
analytics/finance app for a jewelry business. Both apps live here so they can
eventually share data — the shop's sales feeding the analytics dashboards.

> Status: the two apps are now co-located in this repo. Wiring the shop's
> orders/products into the analytics database is a follow-up step (not done yet).

## Layout

| Path                    | Origin repo   | What it is                                                                 |
| ----------------------- | ------------- | -------------------------------------------------------------------------- |
| `webshop/`              | `web_frima`   | Customer-facing storefront: product listing, product pages, session basket |
| `webapp/`               | `firma`       | Back-office analytics/finance: products, orders, customers, inventory, invoices, KPIs, dashboards |
| `integrations/scrapers/`| `firma`       | Product scraper that pulls jewelry listings from external sites            |

## webshop (storefront)

Express 4 + EJS, session-based basket.

```bash
cd webshop
npm install
npm start          # http://localhost:4000  (override with SHOP_PORT)
```

Currently serves an in-memory product list (`data/products.js`). Uses a
Postgres pool (`database.js`) via `DATABASE_URL` for future DB-backed products.

## webapp (analytics / firma)

Express 5 + EJS + Postgres (Neon).

```bash
cd webapp
npm install
npm start          # http://localhost:3000  (override with PORT)
```

Requires `DATABASE_URL` (Neon/Postgres connection string). Schema lives in
`webapp/db/schema.sql`; seed with `npm run seed:db`.

## Running both together

The apps default to different ports (shop `4000`, analytics `3000`), so they
can run side by side. Start each in its own terminal from its own directory.

## Next step: connecting shop → analytics

The shop and analytics apps are not yet connected. The intended integration is
to have shop activity (orders, customers, products) land in the analytics
Postgres database (`webapp/db/schema.sql` already models `products`,
`customers`, `orders`, `order_items`, `inventory`), so sales appear live in the
back-office dashboards. Note the shop's current product shape
(`id/name/price/image/description`) differs from the analytics `products` table
(`name/sku/stock_quantity/currency/...`); bridging that mapping is part of the
connection work.
