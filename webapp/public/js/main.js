function money(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "-";
    return x.toLocaleString(undefined, { style: "currency", currency: "EUR" });
}

function $(sel) {
    return document.querySelector(sel);
}

function toast(msg) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    window.clearTimeout(window.__toastTimer);
    window.__toastTimer = window.setTimeout(() => el.classList.remove("show"), 2600);
}

async function api(url, opts) {
    const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = data?.error || `Request failed (${res.status})`;
        throw new Error(msg);
    }
    return data;
}


async function fetchJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.json();
}

// ---------- KPI page ----------
async function loadKpis() {
    const k = await fetchJSON("/api/kpis");

    // expects elements with these IDs (add them in kpi.html)
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    set("kpiRevenue", `€${k.revenue.toLocaleString()}`);
    set("kpiCost", `€${k.cost.toLocaleString()}`);
    set("kpiProfit", `€${k.profit.toLocaleString()}`);
    set("kpiMargin", `${k.marginPct}%`);
    set("kpiClients", k.activeClients);
    set("kpiOpenInv", k.openInvoices);
    set("kpiOverdue", k.overdueInvoices);
}

// ---------- Transactions page ----------
async function loadTransactions() {
    const rows = await fetchJSON("/api/transactions?n=80");

    // expects a <tbody id="txBody"></tbody> in transactions.html
    const tbody = document.getElementById("txBody");
    if (!tbody) return;

    tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.id}</td>
      <td>${r.date}</td>
      <td>${r.type}</td>
      <td>${r.counterparty}</td>
      <td style="text-align:right">${(r.amount).toFixed(2)} ${r.currency}</td>
      <td>${r.status}</td>
      <td>${r.note}</td>
    </tr>
  `).join("");
}

// Run the right loader depending on page
document.addEventListener("DOMContentLoaded", () => {
    const page = document.body.dataset.page; // set in html: <body data-page="kpi">
    if (page === "kpi") loadKpis().catch(console.error);
    if (page === "transactions") loadTransactions().catch(console.error);
});

function setActiveNav() {
    const page = document.body.dataset.page;
    const links = document.querySelectorAll("[data-nav]");
    links.forEach((a) => {
        if (a.dataset.nav === page) a.classList.add("active");
    });
}

// ------------------
// Overview page
// ------------------
async function loadProducts() {
    const tableBody = document.getElementById("products-table-body");
    if (!tableBody) return;

    try {
        const res = await fetch("/api/products");
        if (!res.ok) {
            throw new Error(`Failed to fetch products (${res.status})`);
        }

        const products = await res.json();

        if (!products.length) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8">No products found.</td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = products.map((product) => `
            <tr>
                <td>${product.product_id}</td>
                <td>${product.name}</td>
                <td>${product.category ?? ""}</td>
                <td>${Number(product.price).toFixed(2)}</td>
                <td>${product.stock_quantity ?? 0}</td>
                <td>${product.reorder_level ?? 0}</td>
                <td>${product.supplier ?? ""}</td>
                <td>${product.status}</td>
            </tr>
        `).join("");
    } catch (err) {
        console.error("Products load error:", err);
        tableBody.innerHTML = `
            <tr>
                <td colspan="8">Failed to load products.</td>
            </tr>
        `;
    }
}


async function initOverview() {
    const outStats = $("#overviewStats");
    const outLatest = $("#latestTransactions");

    try {
        const data = await api("/api/overview");
        const { stats, totals, latestTransactions } = data;

        outStats.innerHTML = `
            <div class="kpi-row">
                <div class="kpi"><div class="label">Total Income</div><div class="value">${money(totals.income)}</div></div>
                <div class="kpi"><div class="label">Total Expense</div><div class="value">${money(totals.expense)}</div></div>
                <div class="kpi"><div class="label">Net</div><div class="value">${money(totals.net)}</div></div>
            </div>
            <div style="height:12px"></div>
            <div class="inline">
                <span class="badge">Transactions: ${stats.transactionCount}</span>
                <span class="badge">Active automations: ${stats.activeAutomations}</span>
            </div>
        `;

        if (latestTransactions.length) {
            outLatest.innerHTML = latestTransactions.map((t) => `
                <tr>
                    <td>${t.date}</td>
                    <td>${t.description}</td>
                    <td>${t.category}</td>
                    <td>${t.type}</td>
                    <td>${money(t.amount)}</td>
                </tr>
            `).join("");
        } else {
            outLatest.innerHTML = `
                <tr>
                    <td colspan="5">No transactions found.</td>
                </tr>
            `;
        }
    } catch (err) {
        console.error("Overview load error:", err);
        if (outStats) outStats.textContent = "Failed to load overview data.";
        if (outLatest) {
            outLatest.innerHTML = `
                <tr>
                    <td colspan="5">Failed to load transactions.</td>
                </tr>
            `;
        }
    }

    await loadProducts();
}

// ------------------
// KPI page
// ------------------
async function initKpi() {
    const totalsEl = $("#kpiTotals");
    const tableBody = $("#kpiByCategory");

    const data = await api("/api/kpi");
    const { totals, byCategory } = data;

    totalsEl.innerHTML = `
        <div class="kpi-row">
            <div class="kpi"><div class="label">Income</div><div class="value">${money(totals.income)}</div></div>
            <div class="kpi"><div class="label">Expense</div><div class="value">${money(totals.expense)}</div></div>
            <div class="kpi"><div class="label">Net</div><div class="value">${money(totals.net)}</div></div>
        </div>
    `;

    tableBody.innerHTML = byCategory
        .map(
            (r) => `
            <tr>
                <td>${r.category}</td>
                <td>${money(r.income)}</td>
                <td>${money(r.expense)}</td>
                <td>${money(r.net)}</td>
            </tr>
        `
        )
        .join("");
}

// ------------------
// Transactions page
// ------------------
async function renderTransactions() {
    const tbody = $("#txTableBody");
    const data = await api("/api/transactions");

    tbody.innerHTML = data.items
        .map(
            (t) => `
            <tr>
                <td>${t.date}</td>
                <td>${t.description}</td>
                <td>${t.category}</td>
                <td>${t.type}</td>
                <td>${money(t.amount)}</td>
                <td>
                    <button class="btn danger" data-del-tx="${t.id}">Delete</button>
                </td>
            </tr>
        `
        )
        .join("");

    document.querySelectorAll("[data-del-tx]").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const id = btn.getAttribute("data-del-tx");
            try {
                await api(`/api/transactions/${id}`, { method: "DELETE" });
                toast("Transaction deleted");
                await renderTransactions();
            } catch (e) {
                toast(e.message);
            }
        });
    });
}

async function initTransactions() {
    const form = $("#txForm");
    await renderTransactions();

    form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const payload = {
            date: $("#txDate").value,
            description: $("#txDescription").value,
            amount: $("#txAmount").value,
            type: $("#txType").value,
            category: $("#txCategory").value,
        };

        try {
            await api("/api/transactions", {
                method: "POST",
                body: JSON.stringify(payload),
            });
            form.reset();
            toast("Transaction added");
            await renderTransactions();
        } catch (e) {
            toast(e.message);
        }
    });
}

// ------------------
// Automation page
// ------------------
async function renderAutomations() {
    const tbody = $("#autoTableBody");
    const data = await api("/api/automations");

    tbody.innerHTML = data.items
        .map(
            (a) => `
            <tr>
                <td>${a.name}</td>
                <td>${a.schedule}</td>
                <td>${a.enabled ? "Enabled" : "Disabled"}</td>
                <td class="inline">
                    <button class="btn" data-toggle-auto="${a.id}" data-enabled="${a.enabled}">
                        ${a.enabled ? "Disable" : "Enable"}
                    </button>
                    <button class="btn danger" data-del-auto="${a.id}">Delete</button>
                </td>
            </tr>
        `
        )
        .join("");

    document.querySelectorAll("[data-toggle-auto]").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const id = btn.getAttribute("data-toggle-auto");
            const current = btn.getAttribute("data-enabled") === "true";
            try {
                await api(`/api/automations/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ enabled: !current }),
                });
                toast("Automation updated");
                await renderAutomations();
            } catch (e) {
                toast(e.message);
            }
        });
    });

    document.querySelectorAll("[data-del-auto]").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const id = btn.getAttribute("data-del-auto");
            try {
                await api(`/api/automations/${id}`, { method: "DELETE" });
                toast("Automation deleted");
                await renderAutomations();
            } catch (e) {
                toast(e.message);
            }
        });
    });
}

async function initAutomation() {
    const form = $("#autoForm");
    await renderAutomations();

    form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const payload = {
            name: $("#autoName").value,
            schedule: $("#autoSchedule").value,
        };

        try {
            await api("/api/automations", {
                method: "POST",
                body: JSON.stringify(payload),
            });
            form.reset();
            toast("Automation added");
            await renderAutomations();
        } catch (e) {
            toast(e.message);
        }
    });
}

// ------------------
// Visualizations page
// ------------------
(() => {
    const page = document.body?.dataset?.page;
    if (page !== "visualizations") return;

    const fileInput = document.getElementById("dataFile") || document.getElementById("xlsFile");
    const sheetSelect = document.getElementById("sheetSelect");
    const xCol = document.getElementById("xCol");
    const yCol = document.getElementById("yCol");
    const chartType = document.getElementById("chartType");
    const drawBtn = document.getElementById("drawBtn");

    const previewHead = document.getElementById("previewHead");
    const previewBody = document.getElementById("previewBody");

    const rowCountEl = document.getElementById("rowCount");
    const chartHintEl = document.getElementById("chartHint");

    const canvas = document.getElementById("chartCanvas");

    let workbook = null;
    let currentRows = [];
    let chart = null;

    function setEnabled(enabled) {
        if (sheetSelect) sheetSelect.disabled = !enabled;
        if (xCol) xCol.disabled = !enabled;
        if (yCol) yCol.disabled = !enabled;
        if (chartType) chartType.disabled = !enabled;
        if (drawBtn) drawBtn.disabled = !enabled;
    }

    function fillSelect(select, options) {
        if (!select) return;
        select.innerHTML = "";
        for (const opt of options) {
            const o = document.createElement("option");
            o.value = opt;
            o.textContent = opt;
            select.appendChild(o);
        }
    }

    function renderPreview(rows, maxRows = 12) {
        if (!previewHead || !previewBody) return;

        previewHead.innerHTML = "";
        previewBody.innerHTML = "";

        if (!rows || rows.length === 0) return;

        const cols = Object.keys(rows[0] ?? {});
        const tr = document.createElement("tr");

        cols.forEach((c) => {
            const th = document.createElement("th");
            th.textContent = c;
            tr.appendChild(th);
        });
        previewHead.appendChild(tr);

        rows.slice(0, maxRows).forEach((r) => {
            const trb = document.createElement("tr");
            cols.forEach((c) => {
                const td = document.createElement("td");
                td.textContent = r[c] ?? "";
                trb.appendChild(td);
            });
            previewBody.appendChild(trb);
        });
    }

    function parseNumber(v) {
        if (typeof v === "number") return v;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        if (!s) return null;
        const n = Number(s.replace(",", "."));
        return Number.isFinite(n) ? n : null;
    }

    function getNumericColumns(rows) {
        if (!rows.length) return [];
        const cols = Object.keys(rows[0]);

        const isNumericCol = (col) => {
            let nonEmpty = 0;
            let numeric = 0;

            for (const r of rows) {
                const v = r[col];
                if (v === "" || v === null || v === undefined) continue;
                nonEmpty++;
                const num = parseNumber(v);
                if (num !== null) numeric++;
            }

            return nonEmpty > 0 && numeric / nonEmpty >= 0.7;
        };

        return cols.filter(isNumericCol);
    }

    function setMetaUI() {
        if (rowCountEl) {
            rowCountEl.textContent = currentRows.length ? `${currentRows.length} rows` : "";
        }

        if (chartHintEl && chartType) {
            const t = chartType.value;
            if (t === "scatter") chartHintEl.textContent = "Scatter: X and Y must be numeric";
            else if (t === "hist") chartHintEl.textContent = "Histogram: uses Y only (numeric)";
            else chartHintEl.textContent = "Bar/Line: Y numeric, X can be text";
        }
    }

    function getSheetRows(sheetName) {
        const sheet = workbook.Sheets[sheetName];
        return XLSX.utils.sheet_to_json(sheet, { defval: "" });
    }

    function refreshFromXlsxSheet(sheetName) {
        currentRows = getSheetRows(sheetName);
        renderPreview(currentRows);

        const cols = currentRows.length ? Object.keys(currentRows[0]) : [];
        fillSelect(xCol, cols);
        fillSelect(yCol, cols);

        const numeric = getNumericColumns(currentRows);
        if (numeric.length && yCol) yCol.value = numeric[0];

        if (xCol && yCol && xCol.value === yCol.value && cols.length > 1) {
            xCol.value = cols.find((c) => c !== yCol.value) || cols[0];
        }

        setEnabled(true);
        setMetaUI();
    }

    function refreshFromCsvRows(rows) {
        currentRows = rows || [];
        renderPreview(currentRows);

        const cols = currentRows.length ? Object.keys(currentRows[0]) : [];
        fillSelect(xCol, cols);
        fillSelect(yCol, cols);

        const numeric = getNumericColumns(currentRows);
        if (numeric.length && yCol) yCol.value = numeric[0];

        if (xCol && yCol && xCol.value === yCol.value && cols.length > 1) {
            xCol.value = cols.find((c) => c !== yCol.value) || cols[0];
        }

        if (sheetSelect) {
            sheetSelect.innerHTML = "";
            sheetSelect.disabled = true;
        }

        setEnabled(true);
        setMetaUI();
    }

    function drawChart(rows) {
        if (!rows.length || !chartType || !canvas || !xCol || !yCol) return;

        const xName = xCol.value;
        const yName = yCol.value;
        const type = chartType.value;

        if (chart) chart.destroy();

        if (type === "hist") {
            const values = [];
            for (const r of rows) {
                const yv = parseNumber(r[yName]);
                if (yv !== null) values.push(yv);
            }

            if (!values.length) {
                toast(`Column "${yName}" has no numeric values to plot.`);
                return;
            }

            const min = Math.min(...values);
            const max = Math.max(...values);
            const bins = 10;
            const step = (max - min) / bins || 1;

            const counts = new Array(bins).fill(0);
            values.forEach((v) => {
                const idx = Math.min(bins - 1, Math.floor((v - min) / step));
                counts[idx]++;
            });

            const labels = counts.map((_, i) => {
                const a = (min + i * step).toFixed(2);
                const b = (min + (i + 1) * step).toFixed(2);
                return `${a}–${b}`;
            });

            chart = new Chart(canvas, {
                type: "bar",
                data: {
                    labels,
                    datasets: [{ label: `Histogram of ${yName}`, data: counts }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
            return;
        }

        if (type === "scatter") {
            const pts = [];
            for (const r of rows) {
                const xv = parseNumber(r[xName]);
                const yv = parseNumber(r[yName]);
                if (xv === null || yv === null) continue;
                pts.push({ x: xv, y: yv });
            }

            if (!pts.length) {
                toast(`Scatter needs numeric values in BOTH "${xName}" and "${yName}".`);
                return;
            }

            chart = new Chart(canvas, {
                type: "scatter",
                data: {
                    datasets: [{ label: `${yName} vs ${xName}`, data: pts }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
            return;
        }

        const labels = [];
        const values = [];
        for (const r of rows) {
            const xv = r[xName];
            const yv = parseNumber(r[yName]);
            if (xv === "" || xv === null || xv === undefined) continue;
            if (yv === null) continue;
            labels.push(String(xv));
            values.push(yv);
        }

        if (!values.length) {
            toast(`Column "${yName}" has no numeric values to plot.`);
            return;
        }

        chart = new Chart(canvas, {
            type: type === "line" ? "line" : "bar",
            data: {
                labels,
                datasets: [{ label: `${yName} vs ${xName}`, data: values }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    if (!fileInput) {
        toast("File input not found. Check that visualizations.html has id='dataFile'.");
        return;
    }

    fileInput.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const name = file.name.toLowerCase();
        const isCsv = name.endsWith(".csv");
        const isXlsx = name.endsWith(".xlsx");

        try {
            if (isCsv) {
                const text = await file.text();

                Papa.parse(text, {
                    header: true,
                    skipEmptyLines: true,
                    complete: (results) => {
                        const rows = (results.data || []).map((r) => {
                            const out = {};
                            Object.keys(r).forEach((k) => {
                                out[k] = r[k] ?? "";
                            });
                            return out;
                        });

                        refreshFromCsvRows(rows);
                        toast("CSV loaded.");
                    },
                    error: (err) => {
                        console.error(err);
                        toast("Failed to parse CSV.");
                        setEnabled(false);
                    }
                });

                return;
            }

            if (isXlsx) {
                const buf = await file.arrayBuffer();
                workbook = XLSX.read(buf, { type: "array" });

                if (sheetSelect) {
                    fillSelect(sheetSelect, workbook.SheetNames);
                    sheetSelect.disabled = false;
                }

                refreshFromXlsxSheet(workbook.SheetNames[0]);
                toast("Excel loaded.");
                return;
            }

            toast("Unsupported file type. Please upload .xlsx or .csv");
            setEnabled(false);
        } catch (err) {
            console.error(err);
            toast("Failed to read file.");
            setEnabled(false);
        }
    });

    if (sheetSelect) {
        sheetSelect.addEventListener("change", () => {
            if (!workbook) return;
            refreshFromXlsxSheet(sheetSelect.value);
        });
    }

    if (chartType) {
        chartType.addEventListener("change", () => setMetaUI());
    }

    if (drawBtn) {
        drawBtn.addEventListener("click", (e) => {
            e.preventDefault();
            if (!currentRows.length) return;
            setMetaUI();
            drawChart(currentRows);
        });
    }

    setEnabled(false);
    setMetaUI();
})();

// ------------------
// Boot
// ------------------
(async function boot() {
    setActiveNav();

    const page = document.body.dataset.page;

    try {
        if (page === "overview") await initOverview();
        if (page === "kpi") await initKpi();
        if (page === "transactions") await initTransactions();
        if (page === "automation") await initAutomation();
    } catch (e) {
        toast(e.message || "Something went wrong");
        console.error(e);
    }
})();