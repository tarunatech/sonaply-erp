const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'plywood_erp',
  password: process.env.DB_PASSWORD || 'password',
  port: process.env.DB_PORT || 5432,
});

async function check() {
  try {
    const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    console.log("Tables in DB:", res.rows.map(r => r.table_name));
    
    const challansCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'challans'");
    console.log("Columns in challans:", challansCols.rows.map(r => r.column_name));
    
    await pool.end();
  } catch (err) {
    console.error("Check failed:", err);
  }
}

check();
