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
    // Find unique constraint name
    const res = await pool.query(`
      SELECT constraint_name 
      FROM information_schema.table_constraints 
      WHERE table_name = 'challans' AND constraint_type = 'UNIQUE'
    `);
    
    for (const row of res.rows) {
      console.log(`Dropping constraint: ${row.constraint_name}`);
      await pool.query(`ALTER TABLE challans DROP CONSTRAINT "${row.constraint_name}"`);
    }
    
    console.log('Migration complete: Unique constraint removed from challan_number');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
