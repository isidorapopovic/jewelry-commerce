// src/routes/csv.js
import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import { query } from '../db/index.js';

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});
// ── Column definitions per entity ─────────────────────────────────────────

const COLUMNS = {
  recurring_transactions: [
    'name','description','amount','currency','type','frequency',
    'start_date','end_date','category','tags','is_active'
  ],
  bills: [
    'name','description','amount','currency','due_date',
    'status','category','vendor','notes'
  ],
  invoices: [
    'invoice_number','client_name','client_email','description',
    'amount','tax_amount','currency','issue_date','due_date','notes'
  ]
};

// ── EXPORT ────────────────────────────────────────────────────────────────
// GET /api/csv/export/:entity?status=...&from=...&to=...
router.get('/export/:entity', async (req, res) => {
  const { entity } = req.params;
  if (!COLUMNS[entity]) {
    return res.status(400).json({ error: `Unknown entity. Use: ${Object.keys(COLUMNS).join(', ')}` });
  }

  try {
    const conditions = [];
    const params = [];
    let i = 1;

    if (req.query.status) {
      conditions.push(`status = $${i++}`);
      params.push(req.query.status);
    }
    if (req.query.from) {
      const dateCol = entity === 'invoices' ? 'issue_date' : 'created_at';
      conditions.push(`${dateCol} >= $${i++}`);
      params.push(req.query.from);
    }
    if (req.query.to) {
      const dateCol = entity === 'invoices' ? 'issue_date' : 'created_at';
      conditions.push(`${dateCol} <= $${i++}`);
      params.push(req.query.to);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const cols = COLUMNS[entity].join(', ');
    const result = await query(`SELECT ${cols} FROM ${entity} ${where} ORDER BY created_at DESC`, params);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${entity}-${Date.now()}.csv"`);

    stringify(result.rows, { header: true, columns: COLUMNS[entity] }, (err, output) => {
      if (err) return res.status(500).json({ error: err.message });
      res.send(output);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── IMPORT ────────────────────────────────────────────────────────────────
// POST /api/csv/import/:entity  (multipart/form-data, field: "file")
router.post('/import/:entity', upload.single('file'), async (req, res) => {
  const { entity } = req.params;
  if (!COLUMNS[entity]) {
    return res.status(400).json({ error: `Unknown entity. Use: ${Object.keys(COLUMNS).join(', ')}` });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Use field name "file"' });
  }

  const results = { total: 0, imported: 0, failed: 0, errors: [] };
  const rows = [];

  // Parse CSV
  await new Promise((resolve, reject) => {
    parse(req.file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }, (err, records) => {
      if (err) return reject(err);
      rows.push(...records);
      resolve();
    });
  }).catch(err => {
    return res.status(400).json({ error: `CSV parse error: ${err.message}` });
  });

  results.total = rows.length;

  // ── INSERT helpers per entity ──────────────────────────────────────────
  async function insertRow(row, rowNum) {
    try {
      if (entity === 'recurring_transactions') {
        const { name, description, amount, currency = 'USD', type, frequency,
                start_date, end_date, category, tags, is_active = 'true' } = row;

        if (!name || !amount || !type || !frequency || !start_date) {
          throw new Error('Missing required fields: name, amount, type, frequency, start_date');
        }
        await query(
          `INSERT INTO recurring_transactions
            (name, description, amount, currency, type, frequency, start_date, end_date,
             next_due_date, category, tags, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT DO NOTHING`,
          [name, description || null, parseFloat(amount), currency, type, frequency,
           start_date, end_date || null, start_date,
           category || null,
           tags ? tags.split('|') : null,
           is_active === 'true' || is_active === '1']
        );

      } else if (entity === 'bills') {
        const { name, description, amount, currency = 'USD', due_date,
                status = 'pending', category, vendor, notes } = row;

        if (!name || !amount || !due_date) {
          throw new Error('Missing required fields: name, amount, due_date');
        }
        await query(
          `INSERT INTO bills (name, description, amount, currency, due_date, status, category, vendor, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [name, description || null, parseFloat(amount), currency, due_date,
           status, category || null, vendor || null, notes || null]
        );

      } else if (entity === 'invoices') {
        const { invoice_number, client_name, client_email, description,
                amount, tax_amount = 0, currency = 'USD',
                issue_date, due_date, notes } = row;

        if (!client_name || !amount || !due_date) {
          throw new Error('Missing required fields: client_name, amount, due_date');
        }

        // Auto-generate invoice_number if not provided
        let invNum = invoice_number;
        if (!invNum) {
          const date = new Date().toISOString().slice(0,10).replace(/-/g,'');
          const count = await query(`SELECT COUNT(*) FROM invoices WHERE invoice_number LIKE $1`, [`INV-${date}-%`]);
          invNum = `INV-${date}-${String(parseInt(count.rows[0].count) + rowNum).padStart(4,'0')}`;
        }

        await query(
          `INSERT INTO invoices
            (invoice_number, client_name, client_email, description, amount,
             tax_amount, currency, issue_date, due_date, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (invoice_number) DO NOTHING`,
          [invNum, client_name, client_email || null, description || null,
           parseFloat(amount), parseFloat(tax_amount), currency,
           issue_date || new Date().toISOString().slice(0,10), due_date, notes || null]
        );
      }

      results.imported++;
    } catch (err) {
      results.failed++;
      results.errors.push({ row: rowNum + 1, error: err.message, data: row });
    }
  }

  // Process rows
  for (let i = 0; i < rows.length; i++) {
    await insertRow(rows[i], i);
  }

  // Log import
  await query(
    `INSERT INTO csv_imports (filename, entity_type, rows_total, rows_imported, rows_failed, errors)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [req.file.originalname, entity, results.total, results.imported, results.failed,
     results.errors.length ? JSON.stringify(results.errors) : null]
  );

  const status = results.failed === 0 ? 200 : results.imported === 0 ? 422 : 207;
  res.status(status).json(results);
});

// ── GET /api/csv/template/:entity ─────────────────────────────────────────
// Download a blank CSV template with headers only
router.get('/template/:entity', (req, res) => {
  const { entity } = req.params;
  if (!COLUMNS[entity]) {
    return res.status(400).json({ error: `Unknown entity. Use: ${Object.keys(COLUMNS).join(', ')}` });
  }

  const examples = {
    recurring_transactions: [[
      'Monthly Rent','Office rent','2500','USD','expense','monthly',
      '2024-01-01','','Housing','rent|office','true'
    ]],
    bills: [['Internet Bill','Monthly ISP','89.99','USD','2024-02-15','pending','Utilities','ISP Provider','']],
    invoices: [['','Acme Corp','billing@acme.com','Web Development','5000','500','USD','2024-01-01','2024-02-01','']]
  };

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${entity}-template.csv"`);

  stringify([COLUMNS[entity], ...examples[entity]], (err, output) => {
    if (err) return res.status(500).json({ error: err.message });
    res.send(output);
  });
});

// ── GET /api/csv/import-history ────────────────────────────────────────────
router.get('/import-history', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM csv_imports ORDER BY imported_at DESC LIMIT 50'
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
