// webapp/routes/imports.js

import express from 'express';
import multer from 'multer';
import { stringify } from 'csv-stringify';
import { query } from '../db/index.js';
import { IMPORT_SCHEMAS, getSchema, listEntities } from '../lib/import-schema.js';
import {
    parseUploadedFile,
    detectMapping,
    applyMapping,
    missingRequiredFields,
    validateAndNormalise,
    insertEntityRow
} from '../lib/import-utils.js';

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }
});

function buildTemplateExample(entity) {
    const examples = {
        customers: [{
            name: 'Acme Ltd',
            email: 'accounts@acme.com',
            phone: '+44 20 7000 0000',
            address: '1 King Street',
            city: 'London',
            country: 'UK',
            credit_limit: '10000',
            notes: 'Priority customer'
        }],
        products: [{
            name: 'Office Chair',
            sku: 'CHAIR-001',
            description: 'Ergonomic chair',
            category: 'Furniture',
            unit_price: '199.99',
            currency: 'USD',
            stock_quantity: '25',
            is_active: 'true'
        }],
        recurring_transactions: [{
            name: 'Monthly Rent',
            description: 'Office rent',
            amount: '2500',
            currency: 'USD',
            type: 'expense',
            frequency: 'monthly',
            start_date: '2026-01-01',
            end_date: '',
            category: 'Housing',
            tags: 'rent|office',
            is_active: 'true'
        }],
        bills: [{
            name: 'Internet Bill',
            description: 'Monthly ISP',
            amount: '89.99',
            currency: 'USD',
            due_date: '2026-05-15',
            status: 'pending',
            category: 'Utilities',
            vendor: 'ISP Provider',
            notes: ''
        }],
        invoices: [{
            invoice_number: '',
            client_name: 'Acme Ltd',
            client_email: 'billing@acme.com',
            description: 'Web development',
            amount: '5000',
            tax_amount: '500',
            currency: 'USD',
            issue_date: '2026-04-01',
            due_date: '2026-05-01',
            notes: ''
        }],
        orders: [{
            order_number: 'ORD-1001',
            customer_email: 'accounts@acme.com',
            customer_name: 'Acme Ltd',
            order_date: '2026-04-10',
            status: 'pending',
            requested_delivery_date: '2026-04-20',
            payment_status: 'unpaid',
            notes: ''
        }],
        order_items: [{
            order_number: 'ORD-1001',
            product_sku: 'CHAIR-001',
            product_name: 'Office Chair',
            quantity: '2',
            unit_price: '199.99',
            discount: '0',
            tax_rate: '20',
            notes: ''
        }]
    };

    return examples[entity] || [{}];
}

function serialiseErrors(errors) {
    return errors.length ? JSON.stringify(errors) : null;
}

async function logImport({ filename, entity, total, imported, failed, errors }) {
    await query(
        `INSERT INTO csv_imports
      (filename, entity_type, rows_total, rows_imported, rows_failed, errors)
     VALUES ($1,$2,$3,$4,$5,$6)`,
        [filename, entity, total, imported, failed, serialiseErrors(errors)]
    );
}

router.get("/", async (req, res) => {
    res.render("data-import", {
        title: "Data Import",
        entities: Object.values(IMPORT_SCHEMAS),
        selectedEntity: req.query.entity || "customers"
    });
});


router.get('/schema/:entity', async (req, res) => {
    const schema = getSchema(req.params.entity);
    if (!schema) {
        return res.status(400).json({ error: 'Unknown entity' });
    }
    res.json({ schema });
});

router.get('/template/:entity', async (req, res) => {
    const schema = getSchema(req.params.entity);
    if (!schema) {
        return res.status(400).json({ error: `Unknown entity. Use: ${listEntities().join(', ')}` });
    }

    const fields = [...schema.required, ...schema.optional];
    const example = buildTemplateExample(req.params.entity);

    stringify(example, { header: true, columns: fields }, (err, output) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${req.params.entity}-template.csv"`);
        res.send(output);
    });
});

router.post('/preview/:entity', upload.single('file'), async (req, res) => {
    const entity = req.params.entity;
    const schema = getSchema(entity);

    if (!schema) {
        return res.status(400).json({ error: `Unknown entity. Use: ${listEntities().join(', ')}` });
    }

    try {
        const rows = parseUploadedFile(req.file);
        const uploadedHeaders = rows[0] ? Object.keys(rows[0]) : [];
        const mapping = detectMapping(entity, uploadedHeaders);

        const preview = [];
        let validRows = 0;
        let invalidRows = 0;

        for (let i = 0; i < rows.length; i++) {
            const raw = rows[i];
            const mapped = applyMapping(raw, mapping);
            const missing = missingRequiredFields(entity, mapped);

            try {
                if (missing.length) {
                    throw new Error(`Missing required columns or values: ${missing.join(', ')}`);
                }

                const normalised = await validateAndNormalise(entity, mapped, i);
                preview.push({
                    row: i + 1,
                    status: 'valid',
                    mapped,
                    normalised
                });
                validRows++;
            } catch (err) {
                preview.push({
                    row: i + 1,
                    status: 'invalid',
                    mapped,
                    error: err.message
                });
                invalidRows++;
            }
        }

        res.json({
            entity,
            totalRows: rows.length,
            validRows,
            invalidRows,
            uploadedHeaders,
            detectedMapping: mapping,
            preview: preview.slice(0, 50)
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/import/:entity', upload.single('file'), async (req, res) => {
    const entity = req.params.entity;
    const schema = getSchema(entity);

    if (!schema) {
        return res.status(400).json({ error: `Unknown entity. Use: ${listEntities().join(', ')}` });
    }

    try {
        const rows = parseUploadedFile(req.file);
        const uploadedHeaders = rows[0] ? Object.keys(rows[0]) : [];
        const mapping = detectMapping(entity, uploadedHeaders);

        const results = {
            total: rows.length,
            imported: 0,
            failed: 0,
            errors: [],
            mapping
        };

        for (let i = 0; i < rows.length; i++) {
            try {
                const mapped = applyMapping(rows[i], mapping);
                const normalised = await validateAndNormalise(entity, mapped, i);
                await insertEntityRow(entity, normalised);
                results.imported++;
            } catch (err) {
                results.failed++;
                results.errors.push({
                    row: i + 1,
                    error: err.message,
                    data: rows[i]
                });
            }
        }

        await logImport({
            filename: req.file?.originalname || 'manual-upload',
            entity,
            total: results.total,
            imported: results.imported,
            failed: results.failed,
            errors: results.errors
        });

        const status = results.failed === 0 ? 200 : results.imported === 0 ? 422 : 207;
        res.status(status).json(results);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/manual/:entity', async (req, res) => {
    const entity = req.params.entity;
    const schema = getSchema(entity);

    if (!schema) {
        return res.status(400).json({ error: `Unknown entity. Use: ${listEntities().join(', ')}` });
    }

    try {
        const normalised = await validateAndNormalise(entity, req.body, 0);
        await insertEntityRow(entity, normalised);

        await logImport({
            filename: 'manual-entry',
            entity,
            total: 1,
            imported: 1,
            failed: 0,
            errors: []
        });

        res.json({
            success: true,
            message: `${entity} record created successfully`
        });
    } catch (err) {
        await logImport({
            filename: 'manual-entry',
            entity,
            total: 1,
            imported: 0,
            failed: 1,
            errors: [{ row: 1, error: err.message, data: req.body }]
        });

        res.status(422).json({
            success: false,
            error: err.message
        });
    }
});

router.get('/history', async (req, res) => {
    try {
        const result = await query(
            `SELECT *
       FROM csv_imports
       ORDER BY imported_at DESC
       LIMIT 100`
        );
        res.json({ data: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;