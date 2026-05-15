const db = require('./db');

async function migrate() {
  try {
    console.log('Attempting to drop UNIQUE constraint from orders.order_number');
    await db.query('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_number_key');
    console.log('Successfully dropped UNIQUE constraint from orders.order_number');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
