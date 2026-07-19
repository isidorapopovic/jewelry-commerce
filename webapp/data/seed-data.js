export const seedTransactions = [
    {
        id: "TX-10001",
        date: "2026-02-26",
        description: "Website project invoice",
        category: "Sales",
        type: "income",
        amount: 4200
    },
    {
        id: "TX-10002",
        date: "2026-02-24",
        description: "Office supplies",
        category: "Operations",
        type: "expense",
        amount: 180.5
    },
    {
        id: "TX-10003",
        date: "2026-02-22",
        description: "Workspace subscription",
        category: "Software",
        type: "expense",
        amount: 79.99
    },
    {
        id: "TX-10004",
        date: "2026-02-20",
        description: "Monthly consulting",
        category: "Services",
        type: "income",
        amount: 6150
    },
    {
        id: "TX-10005",
        date: "2026-02-18",
        description: "Payroll",
        category: "Staff",
        type: "expense",
        amount: 3200
    },
    {
        id: "TX-10006",
        date: "2026-02-15",
        description: "Office rent",
        category: "Operations",
        type: "expense",
        amount: 1250
    },
    {
        id: "TX-10007",
        date: "2026-02-12",
        description: "Branding work",
        category: "Sales",
        type: "income",
        amount: 2800
    },
    {
        id: "TX-10008",
        date: "2026-02-10",
        description: "VAT refund",
        category: "Tax",
        type: "income",
        amount: 540
    },
    {
        id: "TX-10009",
        date: "2026-04-01",
        description: "Office rent",
        category: "Rent",
        type: "expense",
        amount: 900,
        recurring: true,
        recurringFrequency: "monthly",
        recurringNextDate: "2026-05-01"
    },
    {
        id: "TX-10010",
        date: "2026-04-03",
        description: "Client retainer",
        category: "Sales",
        type: "income",
        amount: 2500,
        recurring: true,
        recurringFrequency: "monthly",
        recurringNextDate: "2026-05-03"
    }
];

export const seedAutomations = [
    {
        id: "AUTO-001",
        name: "Monthly invoice reminder",
        schedule: "Every 1st day at 10:00",
        enabled: true
    },
    {
        id: "AUTO-002",
        name: "Weekly KPI email",
        schedule: "Every Monday at 08:00",
        enabled: true
    },
    {
        id: "AUTO-003",
        name: "Overdue payment follow-up",
        schedule: "Every day at 09:00",
        enabled: false
    }
];