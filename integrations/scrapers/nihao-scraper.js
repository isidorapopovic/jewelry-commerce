/*
 * Nihao Jewelry product scraper
 * ------------------------------
 * Scrapes ONE product page into the shape used by the firma `products` schema,
 * and classifies it against the fixed-vs-weight pricing model.
 *
 * Run it locally (retail hosts are blocked inside Claude's sandbox):
 *   cd integrations/scrapers
 *   npm i axios cheerio
 *   node nihao-scraper.js "https://www.nihaojewelry.com/....-nh10931044.html"
 *
 * Add --save to upsert into the shared DB (needs DATABASE_URL and the pricing
 * migration that adds pricing_mode / weight_grams / price_status columns):
 *   node nihao-scraper.js "<url>" --save
 *
 * Strategy: prefer structured data (JSON-LD Product, then Open Graph tags),
 * fall back to CSS selectors for the spec table. Structured data is far more
 * stable than scraping visible HTML, so we lean on it first.
 */

const axios = require("axios");
const cheerio = require("cheerio");

const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// "3.5 g", "3,5g", "3.5 grams", "0.012 kg" -> grams (Number) or null
function parseWeightGrams(text) {
    if (!text) return null;
    const t = String(text).toLowerCase().replace(",", ".");
    let m = t.match(/([\d.]+)\s*kg/);
    if (m) return Math.round(parseFloat(m[1]) * 1000 * 1000) / 1000;
    m = t.match(/([\d.]+)\s*g\b/);
    if (m) return parseFloat(m[1]);
    return null;
}

// "$1.99", "US $2,00", "2.50" -> 2.5 (Number) or null
function parseMoney(text) {
    if (text == null) return null;
    const m = String(text).replace(/,/g, "").match(/([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
}

// Decide how this product should be priced.
//   plated / stainless / alloy / brass  -> 'fixed'   (a set sticker price)
//   solid gold / sterling silver        -> 'by_weight' (price = grams * rate)
function classifyPricingMode(hay) {
    const s = (hay || "").toLowerCase();
    const platedOrBase = /(plated|stainless steel|alloy|brass|copper|zinc|titanium steel)/;
    const solidPrecious = /(solid\s+(gold|silver)|925\s*sterling|999\s*silver|\b(9|14|18|22|24)k\s*(solid\s*)?gold\b)/;
    if (platedOrBase.test(s)) return "fixed";
    if (solidPrecious.test(s)) return "by_weight";
    return "fixed";
}

async function scrape(url) {
    const { data: html } = await axios.get(url, {
        headers: {
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.nihaojewelry.com/",
            "Upgrade-Insecure-Requests": "1",
            "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1"
        },
        timeout: 25000,
        maxRedirects: 5
    });
    const $ = cheerio.load(html);

    // 1) JSON-LD Product structured data (most reliable) --------------------
    let ld = {};
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const json = JSON.parse($(el).contents().text());
            for (const node of Array.isArray(json) ? json : [json]) {
                if (node && node["@type"] === "Product") ld = node;
            }
        } catch (_) { /* ignore malformed blocks */ }
    });

    // 2) Open Graph fallbacks ----------------------------------------------
    const og = (p) => $(`meta[property="og:${p}"]`).attr("content");

    const name = ld.name || og("title") || $("h1").first().text().trim();
    const description =
        ld.description || og("description") ||
        $('meta[name="description"]').attr("content") || "";

    // Images: JSON-LD image (string|array), then OG, then gallery <img>
    let images = [];
    if (ld.image) images = Array.isArray(ld.image) ? ld.image : [ld.image];
    if (!images.length && og("image")) images.push(og("image"));
    if (!images.length) {
        $('.product-gallery img, .goods-gallery img, img[data-large], img[src*="product"]')
            .each((_, el) => {
                const src = $(el).attr("data-large") || $(el).attr("data-src") || $(el).attr("src");
                if (src) images.push(src);
            });
    }
    images = [...new Set(images.filter(Boolean))].slice(0, 6);

    // Price: JSON-LD offers, else first visible price node
    let price = null;
    let currency = "USD";
    const offers = ld.offers && (Array.isArray(ld.offers) ? ld.offers[0] : ld.offers);
    if (offers) {
        price = parseMoney(offers.price || offers.lowPrice);
        currency = offers.priceCurrency || currency;
    }
    if (price == null) price = parseMoney($('[class*="price"]').first().text());

    const sku = ld.sku || ld.mpn || ((url.match(/nh(\d+)/i) || [])[0] || null);

    // 3) Spec table: label -> value (Material, Weight, Size, Color...) -------
    const specs = {};
    $("table tr, .product-params li, .goods-attr li, .spec li, .params li").each((_, el) => {
        const row = $(el);
        let k = row.find("th, dt, .label, .name").first().text().trim();
        let v = row.find("td, dd, .value").first().text().trim();
        if (!k) {
            const parts = row.text().split(":");
            if (parts.length >= 2) { k = parts[0].trim(); v = parts.slice(1).join(":").trim(); }
        }
        if (k) specs[k.toLowerCase().replace(/\s+/g, "_")] = v;
    });

    const material = specs.material || specs.materials || null;
    const weightGrams = parseWeightGrams(specs.weight || specs.item_weight || specs.gross_weight);
    const size = specs.size || specs.length || specs.dimensions || null;
    const pricingMode = classifyPricingMode(`${material || ""} ${name || ""}`);

    return {
        source_url: url,
        sku_code: sku,
        name,
        description: description.trim(),
        category: "Rings",
        material,
        weight_grams: weightGrams,     // scraped, but only *drives* price when pricing_mode = by_weight
        size,
        color_options: specs.color || specs.colour || null,
        price,                         // wholesale unit price
        currency,
        pricing_mode: pricingMode,
        image_url: images[0] || null,
        image_url_2: images[1] || null,
        images,
        price_status: price && price > 0 ? "ok" : "needs_review",
        scraped_at: new Date().toISOString()
    };
}

async function main() {
    const url = process.argv[2];
    if (!url) {
        console.error('Usage: node nihao-scraper.js "<product-url>" [--save]');
        process.exit(1);
    }

    const product = await scrape(url);
    console.log(JSON.stringify(product, null, 2));

    if (process.argv.includes("--save")) {
        // Reuse the shop's pool so we share DATABASE_URL with the analytics app.
        const pool = require("../../webshop/database");
        await pool.query(
            `INSERT INTO products
                (name, sku, sku_code, description, price, currency, stock_quantity,
                 category, supplier, is_active, image_url, pricing_mode, weight_grams, price_status)
             VALUES ($1,$2,$2,$3,$4,$5,0,$6,'Nihao Jewelry',TRUE,$7,$8,$9,$10)
             ON CONFLICT (sku) DO UPDATE SET
                 price        = EXCLUDED.price,
                 image_url    = EXCLUDED.image_url,
                 description  = EXCLUDED.description,
                 weight_grams = EXCLUDED.weight_grams,
                 pricing_mode = EXCLUDED.pricing_mode,
                 price_status = EXCLUDED.price_status`,
            [product.name, product.sku_code, product.description, product.price,
            product.currency, product.category, product.image_url,
            product.pricing_mode, product.weight_grams, product.price_status]
        );
        console.log(`\nSaved "${product.name}" to products (sku ${product.sku_code}).`);
    }

    process.exit(0);
}

main().catch((err) => {
    const status = err.response && err.response.status;
    console.error("Scrape failed:", err.message);
    if (status === 403 || status === 503) {
        console.error(
            "\nThe site blocked this request (anti-bot protection). Plain HTTP scraping\n" +
            "won't get through — we'll need the headless-browser version that loads the\n" +
            "page like a real Chrome. Tell Claude \"give me the browser scraper\"."
        );
    }
    process.exit(1);
});
