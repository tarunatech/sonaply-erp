const db = require('./db');

async function renameColumnIfExists(table, oldCol, newCol) {
  const check = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, oldCol]
  );
  if (check.rows.length > 0) {
    console.log(`Renaming ${table}.${oldCol} to ${newCol}...`);
    await db.query(`ALTER TABLE ${table} RENAME COLUMN "${oldCol}" TO "${newCol}"`);
  } else {
    console.log(`${table}.${oldCol} does not exist (already renamed or never existed).`);
  }
}

async function addColumnIfNotExist(table, colDef) {
  const colName = colDef.split(' ')[0].replace(/"/g, '');
  const check = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, colName]
  );
  if (check.rows.length === 0) {
    console.log(`Adding column ${colName} to ${table}...`);
    await db.query(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
  } else {
    console.log(`Column ${colName} already exists in ${table}.`);
  }
}

async function tableExists(table) {
  const check = await db.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return check.rows.length > 0;
}

async function columnExists(table, col) {
  const check = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, col]
  );
  return check.rows.length > 0;
}

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
    if (await tableExists('orders')) {
      await db.query(`
        ALTER TABLE orders 
        ADD COLUMN IF NOT EXISTS pending_qty INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS fulfilled_qty INTEGER DEFAULT 0
      `);
      await db.query('UPDATE orders SET pending_qty = 0 WHERE pending_qty IS NULL');
      await db.query('UPDATE orders SET fulfilled_qty = 0 WHERE fulfilled_qty IS NULL');
      await db.query('ALTER TABLE orders ALTER COLUMN pending_qty SET DEFAULT 0');
      await db.query('ALTER TABLE orders ALTER COLUMN fulfilled_qty SET DEFAULT 0');
    }

    // Only alter sales table if "quantity" still exists (otherwise it has been renamed/promoted)
    if (await columnExists('sales', 'quantity')) {
      await db.query(`
        ALTER TABLE sales 
        ADD COLUMN IF NOT EXISTS pending_qty INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS fulfilled_qty INTEGER DEFAULT 0
      `);
      await db.query('UPDATE sales SET pending_qty = 0 WHERE pending_qty IS NULL');
      await db.query('UPDATE sales SET fulfilled_qty = 0 WHERE fulfilled_qty IS NULL');
      await db.query('ALTER TABLE sales ALTER COLUMN pending_qty SET DEFAULT 0');
      await db.query('ALTER TABLE sales ALTER COLUMN fulfilled_qty SET DEFAULT 0');
      
      const updateSalesRes = await db.query(`
        UPDATE sales SET fulfilled_qty = quantity WHERE fulfilled_qty = 0 AND pending_qty = 0;
      `);
      console.log(`Updated ${updateSalesRes.rowCount} legacy sales rows with default fulfilled/pending quantities.`);
    } else {
      console.log('Skipping sales pending/fulfilled quantities update (already migrated).');
    }
    
    // Set initial values for existing orders
    if (await tableExists('orders')) {
      const updateOrdersRes = await db.query(`
        UPDATE orders SET fulfilled_qty = quantity WHERE fulfilled_qty = 0 AND pending_qty = 0;
      `);
      console.log(`Updated ${updateOrdersRes.rowCount} legacy order rows with default fulfilled/pending quantities.`);
    }

    // 4. Alterations from add_challan_flag_to_orders.cjs
    console.log('Step 4: Adding is_challan_generated to orders (add_challan_flag_to_orders.cjs)...');
    if (await tableExists('orders')) {
      await db.query(`
        ALTER TABLE orders 
        ADD COLUMN IF NOT EXISTS is_challan_generated BOOLEAN DEFAULT FALSE
      `);
      await db.query('UPDATE orders SET is_challan_generated = FALSE WHERE is_challan_generated IS NULL');
      await db.query('ALTER TABLE orders ALTER COLUMN is_challan_generated SET DEFAULT FALSE');
    } else {
      console.log('Skipping step 4: orders table does not exist.');
    }

    // 5. Alterations from add_narration.js
    console.log('Step 5: Adding narration to sales and orders (add_narration.js)...');
    if (!(await columnExists('sales', 'narration')) && !(await columnExists('sales', 'remarks'))) {
      await db.query('ALTER TABLE sales ADD COLUMN IF NOT EXISTS narration TEXT');
    }
    if (await tableExists('orders')) {
      await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS narration TEXT');
    }

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
    if (await tableExists('orders')) {
      await db.query('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_number_key');
    } else {
      console.log('Skipping step 7: orders table does not exist.');
    }

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
    if (await tableExists('orders')) {
      await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP');
    }
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
    if (await tableExists('orders')) {
      await db.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_category TEXT DEFAULT 'Available'");
    }
    await db.query("ALTER TABLE challans ADD COLUMN IF NOT EXISTS stock_category TEXT DEFAULT 'Available'");

    // 10. Clean up empty/NULL batch numbers
    console.log('Step 10: Cleaning up empty or NULL batch numbers in batches and purchases...');
    await db.query("UPDATE batches SET batch_number = '0' WHERE batch_number IS NULL OR batch_number = '' OR TRIM(batch_number) = ''");
    await db.query("UPDATE purchases SET batch_number = '0' WHERE batch_number IS NULL OR batch_number = '' OR TRIM(batch_number) = ''");

    // 11. Remove Orders module and promote Sales to master (migrate_remove_orders.js)
    console.log('Step 11: Removing Orders module and promoting Sales to master...');
    // 1. Alter Sales table columns
    await renameColumnIfExists('sales', 'client_name', 'customer');
    await renameColumnIfExists('sales', 'product_name', 'product');
    await renameColumnIfExists('sales', 'quantity', 'ordered_qty');
    await renameColumnIfExists('sales', 'fulfilled_qty', 'delivered_qty');
    await renameColumnIfExists('sales', 'narration', 'remarks');

    await addColumnIfNotExist('sales', 'order_no TEXT');
    await addColumnIfNotExist('sales', '"GST" NUMERIC DEFAULT 0');
    await addColumnIfNotExist('sales', 'status TEXT DEFAULT \'Pending\'');
    await addColumnIfNotExist('sales', 'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await addColumnIfNotExist('sales', 'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');

    // 2. Alter Challans table columns
    await renameColumnIfExists('challans', 'challan_number', 'challan_no');
    await renameColumnIfExists('challans', 'client_name', 'customer');
    await renameColumnIfExists('challans', 'product_name', 'product');
    await renameColumnIfExists('challans', 'date', 'created_at');

    await addColumnIfNotExist('challans', 'sales_id UUID REFERENCES sales(id)');
    await addColumnIfNotExist('challans', 'status TEXT DEFAULT \'Delivered\'');

    // Make sure status defaults are filled for existing challans
    await db.query(`UPDATE challans SET status = 'Cancelled' WHERE is_cancelled = TRUE AND (status IS NULL OR status = 'Delivered')`);
    await db.query(`UPDATE challans SET status = 'Delivered' WHERE status IS NULL`);

    // 3. Migrate Orders into Sales if Orders table exists
    const ordersTableCheck = await db.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders'`
    );

    if (ordersTableCheck.rows.length > 0) {
      console.log('Migrating orders table data into sales...');
      const orders = await db.query('SELECT * FROM orders');
      
      for (const order of orders.rows) {
        // Try to find a matching sale record
        const matchingSales = await db.query(
          `SELECT id FROM sales 
           WHERE customer = $1 AND product = $2 AND ordered_qty = $3 AND order_date = $4`,
          [order.client_name, order.product_name, order.quantity, order.order_date]
        );

        if (matchingSales.rows.length > 0) {
          const saleId = matchingSales.rows[0].id;
          console.log(`Matching order ${order.order_number} to existing sale ID ${saleId}`);
          await db.query(
            `UPDATE sales 
             SET order_no = $1, status = $2, remarks = COALESCE(remarks, $3), created_at = $4, updated_at = CURRENT_TIMESTAMP
             WHERE id = $5`,
            [order.order_number, order.status, order.narration, order.order_date, saleId]
          );
        } else {
          console.log(`No matching sale found for order ${order.order_number}. Inserting new sales record.`);
          const productRes = await db.query('SELECT category FROM products WHERE name = $1 LIMIT 1', [order.product_name]);
          const category = productRes.rows.length > 0 ? productRes.rows[0].category : 'Other';
          const rate = order.quantity > 0 ? (Number(order.total_amount || 0) / order.quantity) : 0;

          await db.query(
            `INSERT INTO sales 
             (id, order_no, customer, client_phone, product, category, ordered_qty, delivered_qty, pending_qty, rate, total_price, order_date, value_category, batch_no, remarks, status, stock_category, created_at, updated_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Standard', $13, $14, $15, $16, $17, CURRENT_TIMESTAMP)`,
            [
              order.id,
              order.order_number,
              order.client_name,
              order.client_phone,
              order.product_name,
              category,
              order.quantity,
              order.fulfilled_qty || 0,
              order.pending_qty || 0,
              rate,
              order.total_amount || 0,
              order.order_date,
              order.batch_no || '0',
              order.narration,
              order.status,
              order.stock_category || 'Available',
              order.order_date
            ]
          );
        }
      }
    } else {
      console.log('Orders table does not exist or has already been dropped.');
    }

    // 4. Generate order_no for any sales records that do not have one
    const salesWithoutOrderNo = await db.query('SELECT id, order_date FROM sales WHERE order_no IS NULL');
    if (salesWithoutOrderNo.rows.length > 0) {
      console.log(`Generating order numbers for ${salesWithoutOrderNo.rows.length} sales records...`);
      let count = 1;
      for (const sale of salesWithoutOrderNo.rows) {
        const orderDateStr = sale.order_date ? new Date(sale.order_date).getTime().toString(36).toUpperCase() : Date.now().toString(36).toUpperCase();
        const orderNo = `SLS-${orderDateStr}-${count++}`;
        await db.query('UPDATE sales SET order_no = $1 WHERE id = $2', [orderNo, sale.id]);
      }
    }

    // 5. Update status for existing sales based on delivered and ordered quantities
    await db.query(`
      UPDATE sales 
      SET status = CASE 
        WHEN delivered_qty = 0 THEN 'Pending'
        WHEN delivered_qty > 0 AND delivered_qty < ordered_qty THEN 'Partial'
        WHEN delivered_qty >= ordered_qty THEN 'Delivered'
        ELSE 'Pending'
      END
      WHERE status IS NULL OR status = 'Pending' AND delivered_qty > 0
    `);

    // 6. Map Challans to Sales records
    console.log('Mapping challans to sales records via sales_id...');
    const challansColCheck = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'challans' AND column_name = 'product'`
    );
    const productCol = challansColCheck.rows.length > 0 ? 'product' : 'product_name';
    
    const orderNoColCheck = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'challans' AND column_name = 'order_number'`
    );
    const orderNoCol = orderNoColCheck.rows.length > 0 ? 'order_number' : 'challan_no';

    if (orderNoColCheck.rows.length > 0) {
      const challansRes = await db.query(`SELECT id, "${orderNoCol}", "${productCol}" FROM challans WHERE sales_id IS NULL`);
      console.log(`Found ${challansRes.rows.length} challans to map.`);
      
      for (const chal of challansRes.rows) {
        const match = await db.query(
          `SELECT id FROM sales WHERE order_no = $1 AND product = $2 LIMIT 1`,
          [chal[orderNoCol], chal[productCol]]
        );
        if (match.rows.length > 0) {
          await db.query('UPDATE challans SET sales_id = $1 WHERE id = $2', [match.rows[0].id, chal.id]);
        } else {
          const fallbackMatch = await db.query(
            `SELECT id FROM sales WHERE order_no = $1 LIMIT 1`,
            [chal[orderNoCol]]
          );
          if (fallbackMatch.rows.length > 0) {
            await db.query('UPDATE challans SET sales_id = $1 WHERE id = $2', [fallbackMatch.rows[0].id, chal.id]);
          } else {
            console.warn(`Could not find matching sales record for challan ID: ${chal.id}, order_number: ${chal[orderNoCol]}`);
          }
        }
      }
    }

    // 7. Drop the redundant orders table
    if (ordersTableCheck.rows.length > 0) {
      console.log('Dropping orders table...');
      await db.query('DROP TABLE IF EXISTS orders');
    }

    // 8. Drop the redundant order_number column from challans table if it exists
    if (orderNoColCheck.rows.length > 0) {
      console.log('Dropping order_number column from challans...');
      await db.query('ALTER TABLE challans DROP COLUMN order_number');
    }

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
