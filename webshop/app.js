const express = require("express");
const session = require("express-session");
const pool = require("./database");

const app = express();

app.set("view engine", "ejs");

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(
    session({
        secret: "shop-secret",
        resave: false,
        saveUninitialized: true
    })
);

// Initialise basket
app.use((req, res, next) => {

    if (!req.session.basket) {
        req.session.basket = [];
    }

    next();

});

// ==========================
// HELPERS
// ==========================

function basketCount(req) {
    return req.session.basket.reduce(
        (sum, item) => sum + item.quantity,
        0
    );
}

// Shape a products row the way the EJS templates expect
// (numeric price, `image` field, etc.)
function mapProduct(row) {
    return {
        id: row.id,
        name: row.name,
        price: Number(row.price),
        image: row.image_url,
        description: row.description,
        stock: row.stock_quantity
    };
}

async function getProducts() {
    const { rows } = await pool.query(
        `SELECT id, name, price, image_url, description, stock_quantity
           FROM products
          WHERE is_active = TRUE
          ORDER BY category, name`
    );
    return rows.map(mapProduct);
}

async function getProduct(id) {
    try {
        const { rows } = await pool.query(
            `SELECT id, name, price, image_url, description, stock_quantity
               FROM products
              WHERE id = $1`,
            [id]
        );
        return rows[0] ? mapProduct(rows[0]) : null;
    } catch (err) {
        // Invalid UUID text -> treat as "not found" rather than a 500
        if (err.code === "22P02") return null;
        throw err;
    }
}

function summarise(basket) {
    let subtotal = 0;
    basket.forEach(item => {
        subtotal += item.product.price * item.quantity;
    });
    const shipping = subtotal > 200 ? 0 : 10;
    const vat = subtotal * 0.20;
    const total = subtotal + shipping + vat;
    return { subtotal, shipping, vat, total };
}

// ==========================
// HOME
// ==========================

app.get("/", async (req, res, next) => {
    try {
        const products = await getProducts();
        res.render("index", {
            products,
            basketSize: basketCount(req)
        });
    } catch (err) {
        next(err);
    }
});

// ==========================
// PRODUCT PAGE
// ==========================

app.get("/product/:id", async (req, res, next) => {
    try {
        const product = await getProduct(req.params.id);

        if (!product) {
            return res.status(404).send("Product not found");
        }

        res.render("product", {
            product,
            basketSize: basketCount(req)
        });
    } catch (err) {
        next(err);
    }
});

// ==========================
// ADD TO BASKET
// ==========================

app.post("/basket/add/:id", async (req, res, next) => {
    try {
        const product = await getProduct(req.params.id);

        if (!product) {
            return res.redirect("/");
        }

        const existingItem = req.session.basket.find(
            item => item.product.id === product.id
        );

        if (existingItem) {
            existingItem.quantity++;
        } else {
            req.session.basket.push({
                product,
                quantity: 1
            });
        }

        res.redirect("/basket");
    } catch (err) {
        next(err);
    }
});

// ==========================
// INCREASE QUANTITY
// ==========================

app.post("/basket/increase/:id", (req, res) => {

    const item = req.session.basket.find(
        item => item.product.id == req.params.id
    );

    if (item) {
        item.quantity++;
    }

    res.redirect("/basket");

});

// ==========================
// DECREASE QUANTITY
// ==========================

app.post("/basket/decrease/:id", (req, res) => {

    const item = req.session.basket.find(
        item => item.product.id == req.params.id
    );

    if (!item) {
        return res.redirect("/basket");
    }

    item.quantity--;

    if (item.quantity <= 0) {

        req.session.basket = req.session.basket.filter(
            basketItem => basketItem.product.id != req.params.id
        );

    }

    res.redirect("/basket");

});

// ==========================
// REMOVE ITEM
// ==========================

app.post("/basket/remove/:id", (req, res) => {

    req.session.basket = req.session.basket.filter(
        item => item.product.id != req.params.id
    );

    res.redirect("/basket");

});

// ==========================
// VIEW BASKET
// ==========================

app.get("/basket", (req, res) => {

    const { subtotal, shipping, vat, total } = summarise(req.session.basket);

    res.render("basket", {
        basket: req.session.basket,
        subtotal,
        shipping,
        vat,
        total,
        basketSize: basketCount(req)
    });

});

// ==========================
// CHECKOUT (form)
// ==========================

app.get("/checkout", (req, res) => {

    if (req.session.basket.length === 0) {
        return res.redirect("/basket");
    }

    const { subtotal, shipping, vat, total } = summarise(req.session.basket);

    res.render("checkout", {
        basket: req.session.basket,
        subtotal,
        shipping,
        vat,
        total,
        basketSize: basketCount(req),
        error: null
    });

});

// ==========================
// PLACE ORDER
// Writes customer + order + order_items into the shared analytics
// database and decrements stock, all in one transaction.
// ==========================

app.post("/checkout", async (req, res, next) => {

    const basket = req.session.basket || [];

    if (basket.length === 0) {
        return res.redirect("/basket");
    }

    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim();

    const renderError = (message, status = 400) => {
        const { subtotal, shipping, vat, total } = summarise(basket);
        return res.status(status).render("checkout", {
            basket,
            subtotal,
            shipping,
            vat,
            total,
            basketSize: basketCount(req),
            error: message
        });
    };

    if (!name) {
        return renderError("Please enter your name.");
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // Re-read products from the DB (authoritative prices + stock lock)
        const ids = basket.map(item => item.product.id);
        const { rows: dbProducts } = await client.query(
            `SELECT id, name, price, stock_quantity
               FROM products
              WHERE id = ANY($1::uuid[])
              FOR UPDATE`,
            [ids]
        );
        const byId = new Map(dbProducts.map(p => [p.id, p]));

        // Validate availability and build order lines from DB prices
        let goodsTotal = 0;
        const lines = [];

        for (const item of basket) {
            const p = byId.get(item.product.id);

            if (!p) {
                throw new Error("A product in your basket is no longer available.");
            }

            if (item.quantity > p.stock_quantity) {
                throw new Error(
                    `Only ${p.stock_quantity} of "${p.name}" left in stock.`
                );
            }

            const unitPrice = Number(p.price);
            goodsTotal += unitPrice * item.quantity;

            lines.push({
                productId: p.id,
                qty: item.quantity,
                unitPrice
            });
        }

        // Find an existing customer by email, otherwise create one
        let customerId = null;

        if (email) {
            const found = await client.query(
                `SELECT id FROM customers WHERE email = $1 LIMIT 1`,
                [email]
            );
            if (found.rows[0]) {
                customerId = found.rows[0].id;
            }
        }

        if (!customerId) {
            const inserted = await client.query(
                `INSERT INTO customers (name, email, notes)
                 VALUES ($1, $2, 'Created from web shop checkout')
                 RETURNING id`,
                [name, email || null]
            );
            customerId = inserted.rows[0].id;
        }

        // Create the order
        const orderNumber = "WEB-" + Date.now();
        const orderRes = await client.query(
            `INSERT INTO orders
                (order_number, customer_id, order_date, status,
                 payment_status, fulfilment_status, total_value, notes)
             VALUES ($1, $2, CURRENT_DATE, 'New',
                     'Unpaid', 'Unallocated', $3, 'Web shop order')
             RETURNING id, order_number`,
            [orderNumber, customerId, goodsTotal]
        );
        const orderId = orderRes.rows[0].id;

        // Order items + stock movements
        for (const line of lines) {
            await client.query(
                `INSERT INTO order_items
                    (order_id, product_id, qty_ordered, unit_price)
                 VALUES ($1, $2, $3, $4)`,
                [orderId, line.productId, line.qty, line.unitPrice]
            );

            await client.query(
                `UPDATE products
                    SET stock_quantity = GREATEST(stock_quantity - $1, 0)
                  WHERE id = $2`,
                [line.qty, line.productId]
            );

            await client.query(
                `INSERT INTO inventory
                    (product_id, current_stock, allocated_stock, last_movement_at)
                 VALUES ($1,
                         GREATEST((SELECT stock_quantity FROM products WHERE id = $1), 0),
                         0, NOW())
                 ON CONFLICT (product_id) DO UPDATE
                    SET current_stock    = GREATEST(inventory.current_stock - $2, 0),
                        last_movement_at = NOW()`,
                [line.productId, line.qty]
            );
        }

        await client.query("COMMIT");

        req.session.basket = [];

        res.render("confirmation", {
            orderNumber: orderRes.rows[0].order_number,
            total: goodsTotal,
            name,
            basketSize: 0
        });

    } catch (err) {

        await client.query("ROLLBACK");

        // Stock / availability problems are shown to the shopper;
        // anything unexpected bubbles up to the error handler.
        if (err.code) {
            return next(err);
        }
        return renderError(err.message);

    } finally {
        client.release();
    }
});

// ==========================
// ERROR HANDLER
// ==========================

app.use((err, req, res, next) => {
    console.error("Shop error:", err);
    res.status(500).send("Something went wrong. Please try again.");
});

// ==========================
// START SERVER
// ==========================

const PORT = process.env.SHOP_PORT || 4000;

app.listen(PORT, () => {

    console.log("====================================");
    console.log(" Webshop running");
    console.log(` http://localhost:${PORT}`);
    console.log("====================================");

});
