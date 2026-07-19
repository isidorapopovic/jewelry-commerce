const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/products", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                product_id,
                name,
                category,
                price,
                stock_quantity,
                reorder_level,
                supplier,
                CASE
                    WHEN stock_quantity <= reorder_level THEN 'Low stock'
                    ELSE 'OK'
                END AS status
            FROM products
            ORDER BY product_id
        `);

        res.json(result.rows);
    } catch (err) {
        console.error("Products fetch error:", err);
        res.status(500).json({ error: "Failed to fetch products" });
    }
});

module.exports = router;