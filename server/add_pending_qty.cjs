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

async function migrate() {
  try {
    console.log('Adding pending_qty and fulfilled_qty columns to orders and sales tables...');
    
    await pool.query(`
      ALTER TABLE orders 
      ADD COLUMN IF NOT EXISTS pending_qty INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS fulfilled_qty INTEGER DEFAULT 0
    `);

    await pool.query(`
      ALTER TABLE sales 
      ADD COLUMN IF NOT EXISTS pending_qty INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS fulfilled_qty INTEGER DEFAULT 0
    `);
    
    // Set initial values for existing orders
    await pool.query(`
      UPDATE orders SET fulfilled_qty = quantity WHERE fulfilled_qty = 0 AND pending_qty = 0;
      UPDATE sales SET fulfilled_qty = quantity WHERE fulfilled_qty = 0 AND pending_qty = 0;
    `);

    console.log('Migration complete');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
