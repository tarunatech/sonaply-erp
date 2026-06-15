const db = require('./db');

async function update() {
  try {
    console.log('Adding hold_qty to batches...');
    await db.query('ALTER TABLE batches ADD COLUMN IF NOT EXISTS hold_qty INTEGER DEFAULT 0');

    console.log('Creating holds table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS holds (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_name TEXT NOT NULL,
        client_phone TEXT,
        product_name TEXT NOT NULL,
        category TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        batch_no TEXT,
        hold_date DATE DEFAULT CURRENT_DATE,
        status TEXT DEFAULT 'Active'
      )
    `);

    console.log('✅ Database updated with holds feature successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Database update failed:', err.message);
    process.exit(1);
  }
}

update();
