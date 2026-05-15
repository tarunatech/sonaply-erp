const db = require('./db');

async function update() {
  try {
    console.log('Adding is_printed to challans...');
    await db.query('ALTER TABLE challans ADD COLUMN IF NOT EXISTS is_printed BOOLEAN DEFAULT FALSE');
    
    console.log('Creating clients table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT UNIQUE NOT NULL,
        phone TEXT,
        price_category TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ Database updated successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Database update failed:', err.message);
    process.exit(1);
  }
}

update();
