const path = require("path");

// Load the shared .env from the repo root (one level up from webshop/), so the
// shop and the analytics app can use the same DATABASE_URL. A local webshop/.env
// (loaded second) can still add vars, but never overrides ones already set.
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
require("dotenv").config();

const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
    throw new Error(
        "DATABASE_URL is not set. Add it to the repo-root .env (shared with the analytics app)."
    );
}

const pool = new Pool({

    connectionString: process.env.DATABASE_URL,

    ssl: {
        rejectUnauthorized: false
    }

});


module.exports = pool;
