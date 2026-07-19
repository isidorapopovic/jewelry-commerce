"use strict";

import { Router } from "express";
import { query } from "../db/index.js";

const router = Router();

// GET all products
router.get("/", async (req, res, next) => {
    try {
        const result = await query(`
            SELECT id, name, sku, description, price, currency, stock_quantity, category, is_active, created_at, updated_at
            FROM products
            ORDER BY created_at DESC
        `);

        res.json({ items: result.rows });
    } catch (err) {
        next(err);
    }
});

// GET single product
router.get("/:id", async (req, res, next) => {
    try {
        const result = await query(`
            SELECT id, name, sku, description, price, currency, stock_quantity, category, is_active, created_at, updated_at
            FROM products
            WHERE id = $1
        `, [req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Product not found" });
        }

        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// CREATE product
router.post("/", async (req, res, next) => {
    try {
        const {
            name,
            sku,
            description,
            price,
            currency,
            stock_quantity,
            category,
            is_active
        } = req.body;

        if (!name || price === undefined || price === null || price === "") {
            return res.status(400).json({
                error: "Name and price are required"
            });
        }

        const numericPrice = Number(price);
        const numericStock = Number(stock_quantity ?? 0);

        if (!Number.isFinite(numericPrice) || numericPrice < 0) {
            return res.status(400).json({
                error: "Price must be a valid non-negative number"
            });
        }

        if (!Number.isInteger(numericStock) || numericStock < 0) {
            return res.status(400).json({
                error: "stock_quantity must be a valid non-negative integer"
            });
        }

        const result = await query(`
            INSERT INTO products (
                name, sku, description, price, currency, stock_quantity, category, is_active
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id, name, sku, description, price, currency, stock_quantity, category, is_active, created_at, updated_at
        `, [
            name,
            sku || null,
            description || null,
            numericPrice,
            currency || "USD",
            numericStock,
            category || null,
            typeof is_active === "boolean" ? is_active : true
        ]);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// UPDATE product
router.put("/:id", async (req, res, next) => {
    try {
        const {
            name,
            sku,
            description,
            price,
            currency,
            stock_quantity,
            category,
            is_active
        } = req.body;

        if (!name || price === undefined || price === null || price === "") {
            return res.status(400).json({
                error: "Name and price are required"
            });
        }

        const numericPrice = Number(price);
        const numericStock = Number(stock_quantity ?? 0);

        if (!Number.isFinite(numericPrice) || numericPrice < 0) {
            return res.status(400).json({
                error: "Price must be a valid non-negative number"
            });
        }

        if (!Number.isInteger(numericStock) || numericStock < 0) {
            return res.status(400).json({
                error: "stock_quantity must be a valid non-negative integer"
            });
        }

        const result = await query(`
            UPDATE products
            SET
                name = $1,
                sku = $2,
                description = $3,
                price = $4,
                currency = $5,
                stock_quantity = $6,
                category = $7,
                is_active = $8
            WHERE id = $9
            RETURNING id, name, sku, description, price, currency, stock_quantity, category, is_active, created_at, updated_at
        `, [
            name,
            sku || null,
            description || null,
            numericPrice,
            currency || "USD",
            numericStock,
            category || null,
            typeof is_active === "boolean" ? is_active : true,
            req.params.id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Product not found" });
        }

        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// DELETE product
router.delete("/:id", async (req, res, next) => {
    try {
        const result = await query(`
            DELETE FROM products
            WHERE id = $1
            RETURNING id
        `, [req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Product not found" });
        }

        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

export default router;