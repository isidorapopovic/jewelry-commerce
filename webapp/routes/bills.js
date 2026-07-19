import express from 'express';
import { query } from '../db/index.js';
import { body, validationResult } from 'express-validator';

const router = express.Router();

function validate(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    next();
}

router.get('/', async (req, res) => {
    try {
        const conditions = [];
        const params = [];
        let i = 1;

        if (req.query.status) {
            conditions.push(`status = $${i++}`);
            params.push(req.query.status);
        }

        if (req.query.overdue === 'true') {
            conditions.push(`due_date < CURRENT_DATE AND status != 'paid'`);
        }

        if (req.query.upcoming_days) {
            const days = parseInt(req.query.upcoming_days, 10) || 30;
            conditions.push(`due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($${i++} * INTERVAL '1 day')`);
            params.push(days);
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const result = await query(
            `SELECT * FROM bills
       ${where}
       ORDER BY due_date ASC`,
            params
        );

        res.json({ data: result.rows, total: result.rowCount });
    } catch (err) {
        console.error('Bills route error:', err);
        res.status(500).json({ error: err.message || 'Internal server error' });
    }
});

router.get('/upcoming', async (req, res) => {
    try {
        const result = await query(
            `SELECT * FROM bills
       WHERE due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
       AND status != 'paid'
       ORDER BY due_date ASC`
        );
        res.json({ data: result.rows, total: result.rowCount });
    } catch (err) {
        console.error('Bills upcoming error:', err);
        res.status(500).json({ error: err.message || 'Internal server error' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const result = await query('SELECT * FROM bills WHERE id = $1', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
        res.json({ data: result.rows[0] });
    } catch (err) {
        console.error('Bills get by id error:', err);
        res.status(500).json({ error: err.message || 'Internal server error' });
    }
});

router.post(
    '/',
    [
        body('name').notEmpty().trim(),
        body('amount').isFloat({ gt: 0 }),
        body('due_date').isISO8601(),
    ],
    validate,
    async (req, res) => {
        const { name, description, amount, currency = 'USD', due_date, category, vendor, notes } = req.body;
        try {
            const result = await query(
                `INSERT INTO bills (name, description, amount, currency, due_date, category, vendor, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
                [name, description, amount, currency, due_date, category, vendor, notes]
            );
            res.status(201).json({ data: result.rows[0] });
        } catch (err) {
            console.error('Bills create error:', err);
            res.status(500).json({ error: err.message || 'Internal server error' });
        }
    }
);

router.patch('/:id/pay', async (req, res) => {
    const paid_date = req.body.paid_date || new Date().toISOString().slice(0, 10);
    try {
        const result = await query(
            `UPDATE bills
       SET status = 'paid', paid_date = $1
       WHERE id = $2
       RETURNING *`,
            [paid_date, req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
        res.json({ data: result.rows[0] });
    } catch (err) {
        console.error('Bills pay error:', err);
        res.status(500).json({ error: err.message || 'Internal server error' });
    }
});

router.put('/:id', async (req, res) => {
    const fields = ['name', 'description', 'amount', 'currency', 'due_date', 'paid_date', 'status', 'category', 'vendor', 'notes'];
    const updates = [];
    const params = [];
    let i = 1;

    fields.forEach((f) => {
        if (req.body[f] !== undefined) {
            updates.push(`${f} = $${i++}`);
            params.push(req.body[f]);
        }
    });

    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);

    try {
        const result = await query(
            `UPDATE bills SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
            params
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
        res.json({ data: result.rows[0] });
    } catch (err) {
        console.error('Bills update error:', err);
        res.status(500).json({ error: err.message || 'Internal server error' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const result = await query('DELETE FROM bills WHERE id = $1 RETURNING id', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
        res.json({ message: 'Deleted', id: req.params.id });
    } catch (err) {
        console.error('Bills delete error:', err);
        res.status(500).json({ error: err.message || 'Internal server error' });
    }
});

export default router;