const db = require('./db');

async function run() {
  try {
    await db.query('ALTER TABLE sales ADD COLUMN narration TEXT');
    console.log('Added narration to sales');
  } catch (e) { console.error('sales:', e.message) }

  try {
    await db.query('ALTER TABLE orders ADD COLUMN narration TEXT');
    console.log('Added narration to orders');
  } catch (e) { console.error('orders:', e.message) }
  
  process.exit();
}

run();
