/*
 * Nihao Jewelry product scraper — headless browser version
 * --------------------------------------------------------
 * Nihao blocks plain HTTP requests (403 / anti-bot), so this loads the page in
 * a real Chromium via Playwright, scrolls to trigger lazy-loaded images, then
 * parses the fully rendered HTML into the firma `products` shape.
 *
 * One-time setup (on your machine):
 *   cd integrations/scrapers
 *   npm i playwright cheerio
 *   npx playwright install chromium
 *
 * Run:
 *   node nihao-scraper-browser.js "<product-url>"
 *   node nihao-scraper-browser.js "<url>" --show    # visible browser (beats stricter anti-bot)
 *   node nihao-scraper-browser.js "<url>" --html     # also dump rendered HTML to nihao-page.html
 *   node nihao-scraper-browser.js "<url>" --save      # upsert into the shared DB (needs pricing migration)
 */

const { chromium } = require("playwright");
const cheerio = require("cheerio");
const fs = require("fs");

const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function parseWeightGrams(text) {
    if (!text) return null;
    const t = String(text).toLowerCase().replace(",", ".");
    let m = t.match(/([\d.]+)\s*kg/);
    if (m) return Math.round(parseFloat(m[1]) * 1000 * 1000) / 1000;
    m = t.match(/([\d.]+)\s*g\b/);
    if (m) return parseFloat(m[1]);
    return null;
}

function parseMoney(text) {
    if (text == null) return null;
    const m = String(text).replace(/,/g, "").match(/([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
}

function classifyPricingMode(hay) {
    const s = (hay || "").toLowerCase();
    const platedOrBase = /(plated|stainless steel|alloy|brass|copper|zinc|titanium steel)/;
    const solidPrecious = /(solid\s+(gold|silver)|925\s*sterling|999\s*silver|\b(9|14|18|22|24)k\s*(solid\s*)?gold\b)/;
    if (platedOrBase.test(s)) return "fixed";
    if (solidPrecious.test(s)) return "by_weight";
    return "fixed";
}

// Pull material / stone keywords out of free text (name + description).
function detectMaterials(text) {
    const s = (text || "").toLowerCase();
    const map = [
        ["316 stainless steel", "316 Stainless Steel"],
        ["304 stainless steel", "304 Stainless Steel"],
        ["stainless steel", "Stainless Steel"],
        ["sterling silver", "Sterling Silver"],
        ["925", "925 Silver"],
        ["titanium steel", "Titanium Steel"],
        ["pearl", "Pearl"],
        ["tiger eye", "Tiger Eye"],
        ["zircon", "Zircon"],
        ["rhinestone", "Rhinestone"],
        ["copper", "Copper"],
        ["brass", "Brass"],
        ["alloy", "Alloy"],
        ["resin", "Resin"]
    ];
    const found = [];
    for (const [needle, label] of map) {
        if (s.includes(needle)) found.push(label);
    }
    return [...new Set(found)];
}

// Is this a real product photo (vs the site logo / placeholder)?
function isRealProductImage(src) {
    if (!src) return false;
    if (!/img\.nihaojewelry\.com|\/media\//.test(src)) return false;
    return !/nihaojewelry\.png|logo|placeholder|default|blank|loading/i.test(src);
}

function parseProduct(html, url) {
    const $ = cheerio.load(html);

    let ld = {};
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const json = JSON.parse($(el).contents().text());
            for (const node of Array.isArray(json) ? json : [json]) {
                if (node && node["@type"] === "Product") ld = node;
            }
        } catch (_) { /* ignore */ }
    });

    const og = (p) => $(`meta[property="og:${p}"]`).attr("content");

    let name = ld.name || og("title") || $("h1").first().text().trim();
    // Nihao appends "- Nihaojewelry" to titles; strip it.
    name = name.replace(/\s*[-–|]\s*Nihaojewelry\s*$/i, "").trim();

    const description =
        ld.description || og("description") ||
        $('meta[name="description"]').attr("content") || "";

    // ---- Images ----------------------------------------------------------
    // Collect every candidate, then keep only real product photos: on the
    // Nihao CDN, drop the logo AND promo badges (Local Warehouse, Ready to
    // Ship, etc.), and prefer .jpg/.webp over .png (badges/logos are png).
    let candidates = [];
    if (ld.image) candidates = candidates.concat(Array.isArray(ld.image) ? ld.image : [ld.image]);
    $("img").each((_, el) => {
        const src =
            $(el).attr("data-large") || $(el).attr("data-original") ||
            $(el).attr("data-src") || $(el).attr("src");
        if (src) candidates.push(src);
    });
    candidates = [...new Set(candidates.map((s) => (s ? s.split("?")[0] : s)).filter(Boolean))];

    const BADGE = /nihaojewelry\.png|logo|placeholder|default|blank|loading|label|badge|warehouse|ready.?to.?ship|readyship|icon|sprite|tag|promotion|activity|market|coupon|flag/i;
    let images = candidates
        .filter((s) => /img\.nihaojewelry\.com|\/media\//.test(s) && !BADGE.test(s))
        // upgrade the thumbnail rendition to a larger one when present
        .map((s) => s.replace(/fit-in\/\d+x\d+/, "fit-in/800x800"))
        // photos (jpg/webp/jpeg) first, png last
        .sort((a, b) => (/\.png$/i.test(a) ? 1 : 0) - (/\.png$/i.test(b) ? 1 : 0));
    images = [...new Set(images)];
    if (!images.length && og("image")) images.push(og("image").split("?")[0]);
    images = images.slice(0, 8);

    // Keep the full candidate list so we can debug if the wrong image is picked
    const imageCandidates = candidates;

    // ---- Price: JSON-LD offers, else the "US$x–US$y" range in the copy ----
    let price = null;
    let priceMax = null;
    let currency = "USD";
    const offers = ld.offers && (Array.isArray(ld.offers) ? ld.offers[0] : ld.offers);
    if (offers) {
        price = parseMoney(offers.price || offers.lowPrice);
        priceMax = parseMoney(offers.highPrice);
        currency = offers.priceCurrency || currency;
    }
    if (price == null) {
        const nums = (String(description).match(/\$\s?([\d.]+)/g) || [])
            .map(parseMoney).filter((n) => n != null);
        if (nums.length) {
            price = Math.min(...nums);
            priceMax = Math.max(...nums);
        }
    }

    const sku = ld.sku || ld.mpn || ((url.match(/nh(\d+)/i) || [])[0] || null);

    // ---- Spec table (best effort) + keyword fallback from the name/desc ----
    const specs = {};
    $("table tr, .product-params li, .goods-attr li, .spec li, .params li, .attr-item, .product-attr li")
        .each((_, el) => {
            const row = $(el);
            let k = row.find("th, dt, .label, .name, .attr-name").first().text().trim();
            let v = row.find("td, dd, .value, .attr-value").first().text().trim();
            if (!k) {
                const parts = row.text().split(":");
                if (parts.length >= 2) { k = parts[0].trim(); v = parts.slice(1).join(":").trim(); }
            }
            if (k) specs[k.toLowerCase().replace(/\s+/g, "_")] = v;
        });

    const materials = detectMaterials(`${name} ${description}`);
    const material = specs.material || specs.materials || (materials.length ? materials.join(", ") : null);
    const weightGrams = parseWeightGrams(specs.weight || specs.item_weight || specs.gross_weight);
    const size = specs.size || specs.length || specs.dimensions || null;
    const pricingMode = classifyPricingMode(`${material || ""} ${name || ""}`);

    return {
        source_url: url,
        sku_code: sku,
        name,
        description: String(description).trim(),
        category: "Rings",
        material,
        weight_grams: weightGrams,           // still null if not in a spec table — see --html
        size,
        color_options: specs.color || specs.colour || null,
        price,                               // low end of the wholesale range
        price_max: priceMax,                 // high end (tiered / variant pricing)
        currency,
        pricing_mode: pricingMode,           // 'fixed' for plated steel; weight doesn't drive price here
        image_url: images[0] || null,
        image_url_2: images[1] || null,
        images,
        image_candidates: imageCandidates,   // debug: every image URL found on the page
        price_status: price && price > 0 ? "ok" : "needs_review",
        scraped_at: new Date().toISOString()
    };
}

async function fetchRendered(url, show) {
    const browser = await chromium.launch({
        headless: !show,
        args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"]
    });
    const context = await browser.newContext({
        userAgent: UA,
        viewport: { width: 1366, height: 900 },
        locale: "en-US"
    });
    await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    try {
        await page.waitForSelector('script[type="application/ld+json"], h1', { timeout: 20000 });
    } catch (_) { /* parse whatever we got */ }

    // Scroll the whole page to trigger lazy-loaded gallery images.
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let y = 0;
            const step = 600;
            const timer = setInterval(() => {
                window.scrollBy(0, step);
                y += step;
                if (y >= document.body.scrollHeight) { clearInterval(timer); resolve(); }
            }, 200);
        });
        window.scrollTo(0, 0);
    });

    // Wait until at least one real product image (not the logo) has loaded.
    try {
        await page.waitForFunction(() => {
            return [...document.images].some(
                (i) => /\/media\//.test(i.currentSrc || i.src) && !/nihaojewelry\.png/.test(i.currentSrc || i.src)
            );
        }, { timeout: 10000 });
    } catch (_) { /* keep going */ }

    await page.waitForTimeout(1500);
    const html = await page.content();
    await browser.close();
    return html;
}

async function main() {
    const args = process.argv.slice(2);
    const url = args.find((a) => a.startsWith("http"));
    if (!url) {
        console.error('Usage: node nihao-scraper-browser.js "<product-url>" [--show] [--html] [--save]');
        process.exit(1);
    }

    console.error("Loading page in headless Chromium…");
    const html = await fetchRendered(url, args.includes("--show"));

    if (args.includes("--html")) {
        fs.writeFileSync("nihao-page.html", html);
        console.error("Saved rendered HTML to nihao-page.html");
    }

    const product = parseProduct(html, url);
    console.log(JSON.stringify(product, null, 2));

    if (!product.image_url || !product.price) {
        console.error(
            "\nSome fields are still empty. Re-run with --html and send nihao-page.html\n" +
            "to Claude so the image/price/spec selectors can be tuned to the exact page."
        );
    }

    if (args.includes("--save")) {
        // Retail price + stock can be overridden: --price=12.99 --stock=50
        const priceArg = args.find((a) => a.startsWith("--price="));
        const stockArg = args.find((a) => a.startsWith("--stock="));
        const retailPrice = priceArg ? parseFloat(priceArg.split("=")[1]) : product.price;
        const stock = stockArg ? parseInt(stockArg.split("=")[1], 10) : 100;

        if (!product.name || !(retailPrice > 0) || !product.sku_code) {
            console.error("\nNot saved: missing name / price / sku. Set a price with --price=12.99.");
            process.exit(1);
        }

        // Saves into the CURRENT products schema (no pricing-migration columns needed).
        const pool = require("../../webshop/database");
        await pool.query(
            `INSERT INTO products
                (name, sku, sku_code, description, price, currency,
                 stock_quantity, category, supplier, is_active, image_url)
             VALUES ($1,$2,$2,$3,$4,$5,$6,$7,'Nihao Jewelry',TRUE,$8)
             ON CONFLICT (sku) DO UPDATE SET
                 name        = EXCLUDED.name,
                 price       = EXCLUDED.price,
                 image_url   = EXCLUDED.image_url,
                 description = EXCLUDED.description,
                 is_active   = TRUE`,
            [product.name, product.sku_code, product.description, retailPrice,
            product.currency, stock, product.category, product.image_url]
        );
        console.error(
            `\nSaved "${product.name}" to products ` +
            `(sku ${product.sku_code}, price ${retailPrice} ${product.currency}, stock ${stock}).\n` +
            "It will appear in the web shop after you refresh it."
        );
    }

    process.exit(0);
}

main().catch((err) => {
    console.error("Scrape failed:", err.message);
    process.exit(1);
});
