const db = require('./db');

async function migrate() {
  console.log('🚀 Starting database migration...');

  try {
    // 1. Alterations from update_db.js
    console.log('Step 1: Updating challans, clients, and batches (update_db.js)...');
    await db.query('ALTER TABLE challans ADD COLUMN IF NOT EXISTS is_printed BOOLEAN DEFAULT FALSE');
    await db.query('UPDATE challans SET is_printed = FALSE WHERE is_printed IS NULL');
    await db.query('ALTER TABLE challans ALTER COLUMN is_printed SET DEFAULT FALSE');

    await db.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT UNIQUE NOT NULL,
        phone TEXT,
        price_category TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query('ALTER TABLE batches ADD COLUMN IF NOT EXISTS description TEXT');

    // 2. Alterations from update_db_holds.js
    console.log('Step 2: Adding holds table and hold_qty to batches (update_db_holds.js)...');
    await db.query('ALTER TABLE batches ADD COLUMN IF NOT EXISTS hold_qty INTEGER DEFAULT 0');
    // Crucial fix: update existing batches with null hold_qty to be 0
    await db.query('UPDATE batches SET hold_qty = 0 WHERE hold_qty IS NULL');
    await db.query('ALTER TABLE batches ALTER COLUMN hold_qty SET DEFAULT 0');

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

    // 3. Alterations from add_pending_qty.cjs
    console.log('Step 3: Adding pending/fulfilled quantities (add_pending_qty.cjs)...');
    await db.query(`
      ALTER TABLE orders 
      ADD COLUMN IF NOT EXISTS pending_qty INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS fulfilled_qty INTEGER DEFAULT 0
    `);
    await db.query('UPDATE orders SET pending_qty = 0 WHERE pending_qty IS NULL');
    await db.query('UPDATE orders SET fulfilled_qty = 0 WHERE fulfilled_qty IS NULL');
    await db.query('ALTER TABLE orders ALTER COLUMN pending_qty SET DEFAULT 0');
    await db.query('ALTER TABLE orders ALTER COLUMN fulfilled_qty SET DEFAULT 0');

    await db.query(`
      ALTER TABLE sales 
      ADD COLUMN IF NOT EXISTS pending_qty INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS fulfilled_qty INTEGER DEFAULT 0
    `);
    await db.query('UPDATE sales SET pending_qty = 0 WHERE pending_qty IS NULL');
    await db.query('UPDATE sales SET fulfilled_qty = 0 WHERE fulfilled_qty IS NULL');
    await db.query('ALTER TABLE sales ALTER COLUMN pending_qty SET DEFAULT 0');
    await db.query('ALTER TABLE sales ALTER COLUMN fulfilled_qty SET DEFAULT 0');
    
    // Set initial values for existing orders
    const updateOrdersRes = await db.query(`
      UPDATE orders SET fulfilled_qty = quantity WHERE fulfilled_qty = 0 AND pending_qty = 0;
    `);
    console.log(`Updated ${updateOrdersRes.rowCount} legacy order rows with default fulfilled/pending quantities.`);
    
    const updateSalesRes = await db.query(`
      UPDATE sales SET fulfilled_qty = quantity WHERE fulfilled_qty = 0 AND pending_qty = 0;
    `);
    console.log(`Updated ${updateSalesRes.rowCount} legacy sales rows with default fulfilled/pending quantities.`);

    // 4. Alterations from add_challan_flag_to_orders.cjs
    console.log('Step 4: Adding is_challan_generated to orders (add_challan_flag_to_orders.cjs)...');
    await db.query(`
      ALTER TABLE orders 
      ADD COLUMN IF NOT EXISTS is_challan_generated BOOLEAN DEFAULT FALSE
    `);
    await db.query('UPDATE orders SET is_challan_generated = FALSE WHERE is_challan_generated IS NULL');
    await db.query('ALTER TABLE orders ALTER COLUMN is_challan_generated SET DEFAULT FALSE');

    // 5. Alterations from add_narration.js
    console.log('Step 5: Adding narration to sales and orders (add_narration.js)...');
    await db.query('ALTER TABLE sales ADD COLUMN IF NOT EXISTS narration TEXT');
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS narration TEXT');

    // 6. Alterations from add_batch_status.js
    console.log('Step 6: Adding is_nil and is_cancelled to batches (add_batch_status.js)...');
    await db.query('ALTER TABLE batches ADD COLUMN IF NOT EXISTS is_nil BOOLEAN DEFAULT FALSE');
    await db.query('ALTER TABLE batches ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN DEFAULT FALSE');
    await db.query('UPDATE batches SET is_nil = FALSE WHERE is_nil IS NULL');
    await db.query('UPDATE batches SET is_cancelled = FALSE WHERE is_cancelled IS NULL');
    await db.query('ALTER TABLE batches ALTER COLUMN is_nil SET DEFAULT FALSE');
    await db.query('ALTER TABLE batches ALTER COLUMN is_cancelled SET DEFAULT FALSE');

    // 7. Alterations from migrate_orders.js
    console.log('Step 7: Dropping UNIQUE constraint from orders.order_number (migrate_orders.js)...');
    await db.query('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_number_key');

    // 8. Alterations from remove_challan_unique.cjs
    console.log('Step 8: Dropping UNIQUE constraints from challans (remove_challan_unique.cjs)...');
    const constraintsRes = await db.query(`
      SELECT constraint_name 
      FROM information_schema.table_constraints 
      WHERE table_name = 'challans' AND constraint_type = 'UNIQUE'
    `);
    for (const row of constraintsRes.rows) {
      console.log(`Dropping unique constraint: ${row.constraint_name} from challans`);
      await db.query(`ALTER TABLE challans DROP CONSTRAINT "${row.constraint_name}"`);
    }

    // 9. Alterations for recent schema additions (delivered_at, challan cancel, sales_returns, display_qty, stock_category)
    console.log('Step 9: Adding delivered_at, challan cancel fields, sales_returns, display_qty, and stock_category...');
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP');
    await db.query('ALTER TABLE challans ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN DEFAULT FALSE');
    await db.query('ALTER TABLE challans ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP');
    await db.query('ALTER TABLE challans ADD COLUMN IF NOT EXISTS is_built BOOLEAN DEFAULT FALSE');
    await db.query('ALTER TABLE challans ADD COLUMN IF NOT EXISTS restored_qty INTEGER');
    await db.query('ALTER TABLE sales ADD COLUMN IF NOT EXISTS damage_qty INTEGER DEFAULT 0');
    await db.query('ALTER TABLE holds ADD COLUMN IF NOT EXISTS held_qty INTEGER');
    await db.query(`
      CREATE TABLE IF NOT EXISTS sales_returns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_name TEXT NOT NULL,
        client_phone TEXT,
        price_category TEXT,
        receive_date DATE DEFAULT CURRENT_DATE,
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        batch_no TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query('ALTER TABLE batches ADD COLUMN IF NOT EXISTS display_qty INTEGER DEFAULT 0');
    await db.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS stock_category TEXT DEFAULT 'Available'");
    await db.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_category TEXT DEFAULT 'Available'");
    await db.query("ALTER TABLE challans ADD COLUMN IF NOT EXISTS stock_category TEXT DEFAULT 'Available'");

    console.log('✅ All migrations applied successfully!');
  } catch (err) {
    console.error('❌ Database migration failed:', err);
    process.exit(1);
  } finally {
    if (db.pool) {
      await db.pool.end();
      console.log('Disconnected from database.');
    }
    process.exit(0);
  }
}

migrate();
