// webapp/lib/import-utils.js

import { parse } from 'csv-parse/sync';
import XLSX from 'xlsx';
import { query } from '../db/index.js';
import { getSchema } from './import-schema.js';

function normaliseHeader(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\.(csv|xlsx|xls)$/i, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function truthy(value) {
    const v = String(value ?? '').trim().toLowerCase();
    return ['true', '1', 'yes', 'y', 'on'].includes(v);
}

function nullIfEmpty(value) {
    if (value === undefined || value === null) return null;
    const s = String(value).trim();
    return s === '' ? null : s;
}

function toNumber(value, fieldName) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(String(value).replace(/,/g, '.'));
    if (Number.isNaN(n)) {
        throw new Error(`${fieldName} must be a number`);
    }
    return n;
}

function toDate(value, fieldName) {
    if (value === null || value === undefined || value === '') return null;
    const s = String(value).trim();

    const asDate = new Date(s);
    if (!Number.isNaN(asDate.getTime())) {
        return asDate.toISOString().slice(0, 10);
    }

    // Excel serial number support
    const serial = Number(s);
    if (!Number.isNaN(serial) && serial > 20000) {
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        const date = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
        return date.toISOString().slice(0, 10);
    }

    throw new Error(`${fieldName} must be a valid date`);
}

export function parseUploadedFile(file) {
    if (!file) {
        throw new Error('No file uploaded');
    }

    const name = String(file.originalname || '').toLowerCase();

    if (name.endsWith('.csv')) {
        const records = parse(file.buffer, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            bom: true
        });
        return records;
    }

    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const workbook = XLSX.read(file.buffer, { type: 'buffer' });
        const firstSheet = workbook.SheetNames[0];
        if (!firstSheet) {
            throw new Error('Excel file has no sheets');
        }
        const sheet = workbook.Sheets[firstSheet];
        return XLSX.utils.sheet_to_json(sheet, {
            defval: '',
            raw: false
        });
    }

    throw new Error('Unsupported file type. Use CSV, XLSX, or XLS');
}

export function detectMapping(entity, uploadedHeaders) {
    const schema = getSchema(entity);
    if (!schema) {
        throw new Error(`Unknown entity: ${entity}`);
    }

    const fields = [...schema.required, ...schema.optional];
    const map = {};
    const headerIndex = new Map();

    for (const header of uploadedHeaders) {
        headerIndex.set(normaliseHeader(header), header);
    }

    for (const field of fields) {
        const candidates = [field, ...(schema.aliases[field] || [])].map(normaliseHeader);
        let matchedHeader = null;

        for (const candidate of candidates) {
            if (headerIndex.has(candidate)) {
                matchedHeader = headerIndex.get(candidate);
                break;
            }
        }

        if (!matchedHeader) {
            // loose match
            for (const header of uploadedHeaders) {
                const nh = normaliseHeader(header);
                if (nh.includes(normaliseHeader(field)) || normaliseHeader(field).includes(nh)) {
                    matchedHeader = header;
                    break;
                }
            }
        }

        if (matchedHeader) {
            map[field] = matchedHeader;
        }
    }

    return map;
}

export function applyMapping(row, mapping) {
    const out = {};
    for (const [field, sourceHeader] of Object.entries(mapping)) {
        out[field] = row[sourceHeader];
    }
    return out;
}

export function missingRequiredFields(entity, mappedRow) {
    const schema = getSchema(entity);
    return schema.required.filter((field) => {
        const value = mappedRow[field];
        return value === undefined || value === null || String(value).trim() === '';
    });
}

export async function resolveCustomerId(mappedRow) {
    if (mappedRow.customer_id) {
        return mappedRow.customer_id;
    }

    if (mappedRow.customer_email) {
        const result = await query(
            `SELECT id FROM customers WHERE lower(email) = lower($1) LIMIT 1`,
            [mappedRow.customer_email]
        );
        if (result.rows[0]) return result.rows[0].id;
    }

    if (mappedRow.customer_name) {
        const result = await query(
            `SELECT id FROM customers WHERE lower(name) = lower($1) LIMIT 1`,
            [mappedRow.customer_name]
        );
        if (result.rows[0]) return result.rows[0].id;
    }

    return null;
}

export async function resolveOrderId(mappedRow) {
    if (mappedRow.order_id) {
        return mappedRow.order_id;
    }

    if (mappedRow.order_number) {
        const result = await query(
            `SELECT id FROM orders WHERE order_number = $1 LIMIT 1`,
            [mappedRow.order_number]
        );
        if (result.rows[0]) return result.rows[0].id;
    }

    return null;
}

export async function resolveProductId(mappedRow) {
    if (mappedRow.product_id) {
        return mappedRow.product_id;
    }

    if (mappedRow.product_sku) {
        const result = await query(
            `SELECT id FROM products WHERE sku = $1 LIMIT 1`,
            [mappedRow.product_sku]
        );
        if (result.rows[0]) return result.rows[0].id;
    }

    if (mappedRow.product_name) {
        const result = await query(
            `SELECT id FROM products WHERE lower(name) = lower($1) LIMIT 1`,
            [mappedRow.product_name]
        );
        if (result.rows[0]) return result.rows[0].id;
    }

    return null;
}

async function nextInvoiceNumber(rowNum) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await query(
        `SELECT COUNT(*)::int AS count FROM invoices WHERE invoice_number LIKE $1`,
        [`INV-${date}-%`]
    );
    return `INV-${date}-${String((count.rows[0]?.count || 0) + rowNum + 1).padStart(4, '0')}`;
}

export async function validateAndNormalise(entity, mappedRow, rowNum = 0) {
    const out = {};

    switch (entity) {
        case 'customers': {
            out.name = nullIfEmpty(mappedRow.name);
            out.email = nullIfEmpty(mappedRow.email);
            out.phone = nullIfEmpty(mappedRow.phone);
            out.address = nullIfEmpty(mappedRow.address);
            out.city = nullIfEmpty(mappedRow.city);
            out.country = nullIfEmpty(mappedRow.country);
            out.credit_limit = toNumber(mappedRow.credit_limit, 'credit_limit');
            out.notes = nullIfEmpty(mappedRow.notes);

            if (!out.name) throw new Error('Missing required field: name');
            return out;
        }

        case 'products': {
            out.name = nullIfEmpty(mappedRow.name);
            out.sku = nullIfEmpty(mappedRow.sku);
            out.description = nullIfEmpty(mappedRow.description);
            out.category = nullIfEmpty(mappedRow.category);
            out.unit_price = toNumber(mappedRow.unit_price, 'unit_price');
            out.currency = nullIfEmpty(mappedRow.currency) || 'USD';
            out.stock_quantity = toNumber(mappedRow.stock_quantity, 'stock_quantity');
            out.is_active = mappedRow.is_active === undefined || mappedRow.is_active === ''
                ? true
                : truthy(mappedRow.is_active);

            if (!out.name) throw new Error('Missing required field: name');
            return out;
        }

        case 'recurring_transactions': {
            out.name = nullIfEmpty(mappedRow.name);
            out.description = nullIfEmpty(mappedRow.description);
            out.amount = toNumber(mappedRow.amount, 'amount');
            out.currency = nullIfEmpty(mappedRow.currency) || 'USD';
            out.type = nullIfEmpty(mappedRow.type);
            out.frequency = nullIfEmpty(mappedRow.frequency);
            out.start_date = toDate(mappedRow.start_date, 'start_date');
            out.end_date = toDate(mappedRow.end_date, 'end_date');
            out.category = nullIfEmpty(mappedRow.category);
            out.tags = nullIfEmpty(mappedRow.tags)
                ? String(mappedRow.tags).split('|').map((x) => x.trim()).filter(Boolean)
                : null;
            out.is_active = mappedRow.is_active === undefined || mappedRow.is_active === ''
                ? true
                : truthy(mappedRow.is_active);

            if (!out.name || out.amount === null || !out.type || !out.frequency || !out.start_date) {
                throw new Error('Missing required fields: name, amount, type, frequency, start_date');
            }
            return out;
        }

        case 'bills': {
            out.name = nullIfEmpty(mappedRow.name);
            out.description = nullIfEmpty(mappedRow.description);
            out.amount = toNumber(mappedRow.amount, 'amount');
            out.currency = nullIfEmpty(mappedRow.currency) || 'USD';
            out.due_date = toDate(mappedRow.due_date, 'due_date');
            out.status = nullIfEmpty(mappedRow.status) || 'pending';
            out.category = nullIfEmpty(mappedRow.category);
            out.vendor = nullIfEmpty(mappedRow.vendor);
            out.notes = nullIfEmpty(mappedRow.notes);

            if (!out.name || out.amount === null || !out.due_date) {
                throw new Error('Missing required fields: name, amount, due_date');
            }
            return out;
        }

        case 'invoices': {
            out.invoice_number = nullIfEmpty(mappedRow.invoice_number) || await nextInvoiceNumber(rowNum);
            out.client_name = nullIfEmpty(mappedRow.client_name);
            out.client_email = nullIfEmpty(mappedRow.client_email);
            out.description = nullIfEmpty(mappedRow.description);
            out.amount = toNumber(mappedRow.amount, 'amount');
            out.tax_amount = toNumber(mappedRow.tax_amount, 'tax_amount') ?? 0;
            out.currency = nullIfEmpty(mappedRow.currency) || 'USD';
            out.issue_date = mappedRow.issue_date ? toDate(mappedRow.issue_date, 'issue_date') : new Date().toISOString().slice(0, 10);
            out.due_date = toDate(mappedRow.due_date, 'due_date');
            out.notes = nullIfEmpty(mappedRow.notes);

            if (!out.client_name || out.amount === null || !out.due_date) {
                throw new Error('Missing required fields: client_name, amount, due_date');
            }
            return out;
        }

        case 'orders': {
            out.order_number = nullIfEmpty(mappedRow.order_number);
            out.order_date = toDate(mappedRow.order_date, 'order_date');
            out.status = nullIfEmpty(mappedRow.status);
            out.requested_delivery_date = toDate(mappedRow.requested_delivery_date, 'requested_delivery_date');
            out.payment_status = nullIfEmpty(mappedRow.payment_status);
            out.notes = nullIfEmpty(mappedRow.notes);
            out.customer_id = await resolveCustomerId(mappedRow);

            if (!out.order_number || !out.order_date || !out.status) {
                throw new Error('Missing required fields: order_number, order_date, status');
            }
            if (!out.customer_id) {
                throw new Error('Could not resolve customer_id from customer_id, customer_email, or customer_name');
            }
            return out;
        }

        case 'order_items': {
            out.quantity = toNumber(mappedRow.quantity, 'quantity');
            out.unit_price = toNumber(mappedRow.unit_price, 'unit_price');
            out.discount = toNumber(mappedRow.discount, 'discount') ?? 0;
            out.tax_rate = toNumber(mappedRow.tax_rate, 'tax_rate') ?? 0;
            out.notes = nullIfEmpty(mappedRow.notes);
            out.order_id = await resolveOrderId(mappedRow);
            out.product_id = await resolveProductId(mappedRow);

            if (out.quantity === null || out.unit_price === null) {
                throw new Error('Missing required fields: quantity, unit_price');
            }
            if (!out.order_id) {
                throw new Error('Could not resolve order_id from order_id or order_number');
            }
            if (!out.product_id) {
                throw new Error('Could not resolve product_id from product_id, product_sku, or product_name');
            }
            return out;
        }

        default:
            throw new Error(`Unknown entity: ${entity}`);
    }
}

export async function insertEntityRow(entity, data) {
    switch (entity) {
        case 'customers':
            return query(
                `INSERT INTO customers
          (name, email, phone, address, city, country, credit_limit, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [
                    data.name,
                    data.email,
                    data.phone,
                    data.address,
                    data.city,
                    data.country,
                    data.credit_limit,
                    data.notes
                ]
            );

        case 'products':
            return query(
                `INSERT INTO products
          (name, sku, description, category, unit_price, currency, stock_quantity, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [
                    data.name,
                    data.sku,
                    data.description,
                    data.category,
                    data.unit_price,
                    data.currency,
                    data.stock_quantity,
                    data.is_active
                ]
            );

        case 'recurring_transactions':
            return query(
                `INSERT INTO recurring_transactions
          (name, description, amount, currency, type, frequency, start_date, end_date, next_due_date, category, tags, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT DO NOTHING`,
                [
                    data.name,
                    data.description,
                    data.amount,
                    data.currency,
                    data.type,
                    data.frequency,
                    data.start_date,
                    data.end_date,
                    data.start_date,
                    data.category,
                    data.tags,
                    data.is_active
                ]
            );

        case 'bills':
            return query(
                `INSERT INTO bills
          (name, description, amount, currency, due_date, status, category, vendor, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [
                    data.name,
                    data.description,
                    data.amount,
                    data.currency,
                    data.due_date,
                    data.status,
                    data.category,
                    data.vendor,
                    data.notes
                ]
            );

        case 'invoices':
            return query(
                `INSERT INTO invoices
          (invoice_number, client_name, client_email, description, amount, tax_amount, currency, issue_date, due_date, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (invoice_number) DO NOTHING`,
                [
                    data.invoice_number,
                    data.client_name,
                    data.client_email,
                    data.description,
                    data.amount,
                    data.tax_amount,
                    data.currency,
                    data.issue_date,
                    data.due_date,
                    data.notes
                ]
            );

        case 'orders':
            return query(
                `INSERT INTO orders
          (order_number, customer_id, order_date, status, requested_delivery_date, payment_status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [
                    data.order_number,
                    data.customer_id,
                    data.order_date,
                    data.status,
                    data.requested_delivery_date,
                    data.payment_status,
                    data.notes
                ]
            );

        case 'order_items':
            return query(
                `INSERT INTO order_items
          (order_id, product_id, quantity, unit_price, discount, tax_rate, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [
                    data.order_id,
                    data.product_id,
                    data.quantity,
                    data.unit_price,
                    data.discount,
                    data.tax_rate,
                    data.notes
                ]
            );

        default:
            throw new Error(`Unknown entity: ${entity}`);
    }
}