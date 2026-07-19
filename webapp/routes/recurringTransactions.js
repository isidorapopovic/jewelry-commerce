// src/routes/recurringTransactions.js
import express from 'express';

import { body, validationResult } from 'express-validator';

const router = express.Router();

import { query } from '../db/index.js';

// ── helpers ────────────────────────────────────────────────────────────────

function calcNextDueDate(currentDate, frequency) {
    const d = new Date(currentDate);
    switch (frequency) {
        case 'daily': d.setDate(d.getDate() + 1); break;
        case 'weekly': d.setDate(d.getDate() + 7); break;
        case 'biweekly': d.setDate(d.getDate() + 14); break;
        case 'monthly': d.setMonth(d.getMonth() + 1); break;
        case 'quarterly': d.setMonth(d.getMonth() + 3); break;
        case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
        default: throw new Error(`Unknown frequency: ${frequency}`);
    }
    return d.toISOString().slice(0, 10);
}

function validate(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    next();
}

// ── GET /api/recurring-transactions ────────────────────────────────────────
// Query params: ?active=true|false  ?type=income|expense  ?upcoming_days=N
router.get('/', async (req, res) => {
    try {
        const conditions = [];
        const params = [];
        let i = 1;

        if (req.query.active !== undefined) {
            conditions.push(`is_active = $${i++}`);
            params.push(req.query.active === 'true');
        }
        if (req.query.type) {
            conditions.push(`type = $${i++}`);
            params.push(req.query.type);
        }
        if (req.query.upcoming_days) {
            conditions.push(`next_due_date <= CURRENT_DATE + ($${i++} || ' days')::INTERVAL`);
            params.push(parseInt(req.query.upcoming_days, 10));
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const result = await query(
            `SELECT * FROM recurring_transactions ${where} ORDER BY next_due_date ASC`,
            params
        );
        res.json({ data: result.rows, total: result.rowCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/recurring-transactions/:id ─────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const result = await query(
            'SELECT * FROM recurring_transactions WHERE id = $1',
            [req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
        res.json({ data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/recurring-transactions ────────────────────────────────────────
router.post(
    '/',
    [
        body('name').notEmpty().trim(),
        body('amount').isFloat({ gt: 0 }),
        body('type').isIn(['income', 'expense']),
        body('frequency').isIn(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']),
        body('start_date').isISO8601(),
    ],
    validate,
    async (req, res) => {
        const {
            name, description, amount, currency = 'USD', type,
            frequency, start_date, end_date, category, tags
        } = req.body;

        const next_due_date = start_date;

        try {
            const result = await query(
                `INSERT INTO recurring_transactions
          (name, description, amount, currency, type, frequency,
           start_date, end_date, next_due_date, category, tags)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
                [
                    name,
                    description,
                    amount,
                    currency,
                    type,
                    frequency,
                    start_date,
                    end_date || null,
                    next_due_date,
                    category || null,
                    tags || null
                ]
            );
            res.status(201).json({ data: result.rows[0] });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
);

// ── PUT /api/recurring-transactions/:id ─────────────────────────────────────
router.put(
    '/:id',
    [
        body('name').optional().notEmpty().trim(),
        body('amount').optional().isFloat({ gt: 0 }),
        body('type').optional().isIn(['income', 'expense']),
        body('frequency').optional().isIn(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']),
    ],
    validate,
    async (req, res) => {
        const fields = [
            'name', 'description', 'amount', 'currency', 'type', 'frequency',
            'start_date', 'end_date', 'next_due_date', 'is_active', 'category', 'tags'
        ];
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
                `UPDATE recurring_transactions SET ${updates.join(', ')}
         WHERE id = $${i} RETURNING *`,
                params
            );
            if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
            res.json({ data: result.rows[0] });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
);

// ── POST /api/recurring-transactions/:id/process ────────────────────────────
router.post('/:id/process', async (req, res) => {
    try {
        const rtResult = await query(
            'SELECT * FROM recurring_transactions WHERE id = $1 AND is_active = TRUE',
            [req.params.id]
        );
        if (!rtResult.rows.length) return res.status(404).json({ error: 'Not found or inactive' });

        const rt = rtResult.rows[0];
        const newNextDue = calcNextDueDate(rt.next_due_date, rt.frequency);

        await query(
            `UPDATE recurring_transactions
       SET last_processed_date = $1, next_due_date = $2
       WHERE id = $3`,
            [rt.next_due_date, newNextDue, rt.id]
        );

        const billResult = await query(
            `INSERT INTO bills (name, amount, currency, due_date, status, category, recurring_transaction_id)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6)
       RETURNING *`,
            [rt.name, rt.amount, rt.currency, newNextDue, rt.category, rt.id]
        );

        res.json({
            message: 'Processed successfully',
            new_next_due_date: newNextDue,
            bill_created: billResult.rows[0]
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── DELETE /api/recurring-transactions/:id ───────────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        const result = await query(
            'DELETE FROM recurring_transactions WHERE id = $1 RETURNING id',
            [req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
        res.json({ message: 'Deleted', id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;