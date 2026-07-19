// webapp/lib/import-schema.js

export const IMPORT_SCHEMAS = {
    customers: {
        entity: 'customers',
        label: 'Customers',
        table: 'customers',
        required: ['name'],
        optional: ['email', 'phone', 'address', 'city', 'country', 'credit_limit', 'notes'],
        aliases: {
            name: ['customer_name', 'full_name', 'cust_name', 'client_name'],
            email: ['email_address', 'mail', 'customer_email'],
            phone: ['telephone', 'mobile', 'phone_number'],
            address: ['street', 'street_address'],
            city: ['town'],
            country: ['nation'],
            credit_limit: ['limit', 'credit'],
            notes: ['comment', 'comments']
        }
    },

    products: {
        entity: 'products',
        label: 'Products',
        table: 'products',
        required: ['name'],
        optional: ['sku', 'description', 'category', 'unit_price', 'currency', 'stock_quantity', 'is_active'],
        aliases: {
            name: ['product_name', 'item_name'],
            sku: ['product_sku', 'code'],
            description: ['details'],
            category: ['type'],
            unit_price: ['price', 'price_per_unit', 'selling_price'],
            currency: ['curr'],
            stock_quantity: ['stock', 'qty', 'quantity', 'inventory'],
            is_active: ['active', 'enabled']
        }
    },

    recurring_transactions: {
        entity: 'recurring_transactions',
        label: 'Recurring Transactions',
        table: 'recurring_transactions',
        required: ['name', 'amount', 'type', 'frequency', 'start_date'],
        optional: ['description', 'currency', 'end_date', 'category', 'tags', 'is_active'],
        aliases: {
            name: ['transaction_name'],
            amount: ['value', 'total'],
            type: ['transaction_type'],
            frequency: ['repeat', 'interval'],
            start_date: ['starts_on', 'begin_date'],
            end_date: ['ends_on'],
            category: ['group'],
            tags: ['labels'],
            is_active: ['active']
        }
    },

    bills: {
        entity: 'bills',
        label: 'Bills',
        table: 'bills',
        required: ['name', 'amount', 'due_date'],
        optional: ['description', 'currency', 'status', 'category', 'vendor', 'notes'],
        aliases: {
            name: ['bill_name'],
            amount: ['value', 'total'],
            due_date: ['due', 'payment_due_date'],
            vendor: ['supplier'],
            status: ['bill_status']
        }
    },

    invoices: {
        entity: 'invoices',
        label: 'Invoices',
        table: 'invoices',
        required: ['client_name', 'amount', 'due_date'],
        optional: ['invoice_number', 'client_email', 'description', 'tax_amount', 'currency', 'issue_date', 'notes'],
        aliases: {
            invoice_number: ['invoice_no', 'invoice_num', 'number'],
            client_name: ['customer_name', 'customer', 'client'],
            client_email: ['customer_email', 'email'],
            description: ['details'],
            amount: ['total', 'subtotal'],
            tax_amount: ['tax', 'vat'],
            issue_date: ['invoice_date', 'created_date'],
            due_date: ['payment_due_date']
        }
    },

    orders: {
        entity: 'orders',
        label: 'Orders',
        table: 'orders',
        required: ['order_number', 'order_date', 'status'],
        optional: [
            'customer_id',
            'customer_email',
            'customer_name',
            'requested_delivery_date',
            'payment_status',
            'notes'
        ],
        aliases: {
            order_number: ['order_no', 'order_num', 'number'],
            order_date: ['date', 'created_at'],
            status: ['order_status'],
            customer_id: ['client_id'],
            customer_email: ['email', 'client_email', 'customer_mail'],
            customer_name: ['customer', 'client', 'client_name'],
            requested_delivery_date: ['delivery_date', 'requested_date'],
            payment_status: ['payment', 'payment_state'],
            notes: ['comment', 'comments']
        }
    },

    order_items: {
        entity: 'order_items',
        label: 'Order Items',
        table: 'order_items',
        required: ['order_id', 'product_id', 'quantity', 'unit_price'],
        optional: ['order_number', 'product_sku', 'product_name', 'discount', 'tax_rate', 'notes'],
        aliases: {
            order_id: ['parent_order_id'],
            order_number: ['order_no'],
            product_id: ['item_id'],
            product_sku: ['sku'],
            product_name: ['product', 'item_name'],
            quantity: ['qty'],
            unit_price: ['price'],
            discount: ['discount_amount'],
            tax_rate: ['tax', 'vat_rate'],
            notes: ['comment']
        }
    }
};

export function getSchema(entity) {
    return IMPORT_SCHEMAS[entity] || null;
}

export function listEntities() {
    return Object.keys(IMPORT_SCHEMAS);
}