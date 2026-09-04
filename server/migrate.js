const db = require('./db');

async function transliterateText(text) {
  if (!text || !text.trim()) return "";
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=gu&dt=t&q=${encodeURIComponent(text.trim())}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const translatedSegments = data[0]
          .map((seg) => (Array.isArray(seg) && seg[0] ? seg[0] : ""))
          .join("");
        if (translatedSegments && translatedSegments.trim()) {
          return translatedSegments.trim();
        }
      }
    }
  } catch (err) {
    // Ignore transliteration errors to keep migration resilient
  }
  return "";
}

async function renameColumnIfExists(table, oldCol, newCol) {
  const checkOld = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, oldCol]
  );
  const checkNew = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, newCol]
  );
  
  if (checkOld.rows.length > 0) {
    if (checkNew.rows.length > 0) {
      console.log(`${table}.${newCol} already exists, dropping duplicate/recreated ${table}.${oldCol}...`);
      await db.query(`ALTER TABLE ${table} DROP COLUMN "${oldCol}"`);
    } else {
      console.log(`Renaming ${table}.${oldCol} to ${newCol}...`);
      await db.query(`ALTER TABLE ${table} RENAME COLUMN "${oldCol}" TO "${newCol}"`);
    }
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
    // Step 0: Ensure essential base tables exist
    console.log('Step 0: Ensuring core tables exist...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('Admin', 'Staff')),
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        size TEXT,
        barcode TEXT
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS batches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(id),
        product_code TEXT,
        product_name TEXT NOT NULL,
        category TEXT NOT NULL,
        batch_number TEXT NOT NULL,
        supplier TEXT,
        quantity INTEGER DEFAULT 0,
        rate NUMERIC DEFAULT 0,
        date DATE DEFAULT CURRENT_DATE,
        available_qty INTEGER DEFAULT 0,
        damage_qty INTEGER DEFAULT 0,
        display_qty INTEGER DEFAULT 0,
        hold_qty INTEGER DEFAULT 0,
        stock_maintain INTEGER DEFAULT 0,
        is_nil BOOLEAN DEFAULT FALSE,
        is_cancelled BOOLEAN DEFAULT FALSE,
        is_dead_stock BOOLEAN DEFAULT FALSE,
        description TEXT
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS purchases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        supplier_name TEXT NOT NULL,
        supplier_phone TEXT,
        product_name TEXT NOT NULL,
        category TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        rate NUMERIC NOT NULL,
        total_amount NUMERIC NOT NULL,
        batch_number TEXT NOT NULL,
        date DATE DEFAULT CURRENT_DATE
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_no TEXT,
        customer TEXT NOT NULL,
        client_phone TEXT,
        product TEXT NOT NULL,
        category TEXT NOT NULL,
        ordered_qty INTEGER NOT NULL,
        delivered_qty INTEGER DEFAULT 0,
        pending_qty INTEGER DEFAULT 0,
        rate NUMERIC,
        "GST" NUMERIC DEFAULT 0,
        total_price NUMERIC,
        order_date DATE DEFAULT CURRENT_DATE,
        value_category TEXT,
        batch_no TEXT,
        stock_category TEXT DEFAULT 'Available',
        remarks TEXT,
        status TEXT DEFAULT 'Pending',
        damage_qty INTEGER DEFAULT 0,
        delivered_at TIMESTAMP,
        estimated_delivery_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS challans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        challan_no TEXT NOT NULL,
        sales_id UUID REFERENCES sales(id),
        customer TEXT NOT NULL,
        client_phone TEXT,
        product TEXT NOT NULL,
        batch_no TEXT,
        quantity INTEGER NOT NULL,
        created_at DATE DEFAULT CURRENT_DATE,
        notes TEXT,
        is_printed BOOLEAN DEFAULT FALSE,
        stock_category TEXT DEFAULT 'Available',
        is_cancelled BOOLEAN DEFAULT FALSE,
        cancelled_at TIMESTAMP,
        is_built BOOLEAN DEFAULT FALSE,
        bill_no TEXT,
        restored_qty INTEGER,
        is_challan_generated BOOLEAN DEFAULT FALSE,
        status TEXT DEFAULT 'Delivered',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT UNIQUE NOT NULL,
        name_gujarati TEXT,
        phone TEXT,
        price_category TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS holds (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_name TEXT NOT NULL,
        client_phone TEXT,
        product_name TEXT NOT NULL,
        category TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        held_qty INTEGER,
        batch_no TEXT,
        hold_date DATE DEFAULT CURRENT_DATE,
        status TEXT DEFAULT 'Active'
      )
    `);

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

    await db.query(`
      CREATE TABLE IF NOT EXISTS challan_notes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        note TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed')),
        created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed initial admin user if no users exist
    await db.query(`
      INSERT INTO users (name, role, email, password) 
      VALUES ('Admin', 'Admin', 'admin@erp.com', 'admin123')
      ON CONFLICT (email) DO NOTHING
    `);

    // 1. Alterations from update_db.js
    console.log('Step 1: Updating challans, clients, and batches (update_db.js)...');
    await db.query('ALTER TABLE challans ADD COLUMN IF NOT EXISTS is_printed BOOLEAN DEFAULT FALSE');
    await db.query('UPDATE challans SET is_printed = FALSE WHERE is_printed IS NULL');
    await db.query('ALTER TABLE challans ALTER COLUMN is_printed SET DEFAULT FALSE');
    await db.query('ALTER TABLE batches ADD COLUMN IF NOT EXISTS description TEXT');

    // 2. Alterations from update_db_holds.js
    console.log('Step 2: Adding holds table and hold_qty to batches (update_db_holds.js)...');
    await db.query('ALTER TABLE batches ADD COLUMN IF NOT EXISTS hold_qty INTEGER DEFAULT 0');
    await db.query('UPDATE batches SET hold_qty = 0 WHERE hold_qty IS NULL');
    await db.query('ALTER TABLE batches ALTER COLUMN hold_qty SET DEFAULT 0');

    // 3. Alterations from add_pending_qty.cjs
    console.log('Step 3: Adding pending/fulfilled quantities...');
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
    }

    // 4. Alterations from add_challan_flag_to_orders.cjs
    console.log('Step 4: Adding is_challan_generated to orders...');
    if (await tableExists('orders')) {
      await db.query(`
        ALTER TABLE orders 
        ADD COLUMN IF NOT EXISTS is_challan_generated BOOLEAN DEFAULT FALSE
      `);
      await db.query('UPDATE orders SET is_challan_generated = FALSE WHERE is_challan_generated IS NULL');
      await db.query('ALTER TABLE orders ALTER COLUMN is_challan_generated SET DEFAULT FALSE');
    }

    // 5. Alterations from add_narration.js
    console.log('Step 5: Adding narration to sales...');
    if (!(await columnExists('sales', 'narration')) && !(await columnExists('sales', 'remarks'))) {
      await db.query('ALTER TABLE sales ADD COLUMN IF NOT EXISTS narration TEXT');
    }

    // 6. Alterations from add_batch_status.js
    console.log('Step 6: Adding is_nil, is_cancelled, is_dead_stock to batches...');
    await db.query('ALTER TABLE batches ADD COLUMN IF NOT EXISTS is_nil BOOLEAN DEFAULT FALSE');
    await db.query('ALTER TABLE batches ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN DEFAULT FALSE');
    await db.query('ALTER TABLE batches ADD COLUMN IF NOT EXISTS is_dead_stock BOOLEAN DEFAULT FALSE');
    await db.query('UPDATE batches SET is_nil = FALSE WHERE is_nil IS NULL');
    await db.query('UPDATE batches SET is_cancelled = FALSE WHERE is_cancelled IS NULL');
    await db.query('UPDATE batches SET is_dead_stock = FALSE WHERE is_dead_stock IS NULL');
    await db.query('ALTER TABLE batches ALTER COLUMN is_nil SET DEFAULT FALSE');
    await db.query('ALTER TABLE batches ALTER COLUMN is_cancelled SET DEFAULT FALSE');
    await db.query('ALTER TABLE batches ALTER COLUMN is_dead_stock SET DEFAULT FALSE');

    // 7. Alterations from remove_challan_unique.cjs
    console.log('Step 7: Dropping UNIQUE constraints from challans...');
    const constraintsRes = await db.query(`
      SELECT constraint_name 
      FROM information_schema.table_constraints 
      WHERE table_name = 'challans' AND constraint_type = 'UNIQUE'
    `);
    for (const row of constraintsRes.rows) {
      console.log(`Dropping unique constraint: ${row.constraint_name} from challans`);
      await db.query(`ALTER TABLE challans DROP CONSTRAINT "${row.constraint_name}"`);
    }

    // 8. Alterations for recent schema additions
    console.log('Step 8: Adding delivered_at, challan cancel/built/bill_no fields, sales_returns, challan_notes, display_qty, stock_category, and estimated_delivery_date...');
    await db.query('ALTER TABLE sales ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP');
    await db.query('ALTER TABLE sales ADD COLUMN IF NOT EXISTS estimated_delivery_date DATE');
    await db.query('ALTER TABLE challans ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN DEFAULT FALSE');
    await db.query('ALTER TABLE challans ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP');
    await db.query('ALTER TABLE challans ADD COLUMN IF NOT EXISTS is_built BOOLEAN DEFAULT FALSE');
    await db.query('ALTER TABLE challans ADD COLUMN IF NOT EXISTS bill_no TEXT');
    await db.query('ALTER TABLE challans ADD COLUMN IF NOT EXISTS restored_qty INTEGER');
    await db.query('ALTER TABLE challans ADD COLUMN IF NOT EXISTS is_challan_generated BOOLEAN DEFAULT FALSE');
    await db.query('ALTER TABLE sales ADD COLUMN IF NOT EXISTS damage_qty INTEGER DEFAULT 0');
    await db.query('ALTER TABLE holds ADD COLUMN IF NOT EXISTS held_qty INTEGER');
    await db.query('ALTER TABLE batches ADD COLUMN IF NOT EXISTS display_qty INTEGER DEFAULT 0');
    await db.query('ALTER TABLE batches ADD COLUMN IF NOT EXISTS stock_maintain INTEGER DEFAULT 0');
    await db.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS stock_category TEXT DEFAULT 'Available'");
    await db.query("ALTER TABLE challans ADD COLUMN IF NOT EXISTS stock_category TEXT DEFAULT 'Available'");
    await db.query("ALTER TABLE challans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
    await db.query("UPDATE challans SET updated_at = created_at WHERE updated_at IS NULL");
    await db.query(`
      CREATE TABLE IF NOT EXISTS challan_notes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        note TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed')),
        created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ensure default integer / text values for consistency
    await db.query('UPDATE batches SET display_qty = 0 WHERE display_qty IS NULL');
    await db.query('UPDATE batches SET damage_qty = 0 WHERE damage_qty IS NULL');
    await db.query('UPDATE batches SET available_qty = 0 WHERE available_qty IS NULL');
    await db.query('UPDATE batches SET hold_qty = 0 WHERE hold_qty IS NULL');
    await db.query('UPDATE batches SET stock_maintain = 0 WHERE stock_maintain IS NULL');
    await db.query('UPDATE sales SET damage_qty = 0 WHERE damage_qty IS NULL');
    await db.query("UPDATE sales SET stock_category = 'Available' WHERE stock_category IS NULL OR TRIM(stock_category) = ''");
    await db.query("UPDATE challans SET stock_category = 'Available' WHERE stock_category IS NULL OR TRIM(stock_category) = ''");

    // Update sales status constraint to support 'Confirmed'
    try {
      await db.query('ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_status_check');
      await db.query("ALTER TABLE sales ADD CONSTRAINT sales_status_check CHECK (status IN ('Pending', 'Confirmed', 'Partial', 'Delivered', 'Cancelled'))");
    } catch (e) {
      console.log('Notice on sales status constraint:', e.message);
    }

    // 9. Clean up empty/NULL batch numbers
    console.log('Step 9: Cleaning up empty or NULL batch numbers in batches and purchases...');
    await db.query("UPDATE batches SET batch_number = '0' WHERE batch_number IS NULL OR batch_number = '' OR TRIM(batch_number) = ''");
    await db.query("UPDATE purchases SET batch_number = '0' WHERE batch_number IS NULL OR batch_number = '' OR TRIM(batch_number) = ''");

    // 10. Remove Orders module and promote Sales to master
    console.log('Step 10: Promoting Sales columns & migrating legacy Orders if present...');
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

    await renameColumnIfExists('challans', 'challan_number', 'challan_no');
    await renameColumnIfExists('challans', 'client_name', 'customer');
    await renameColumnIfExists('challans', 'product_name', 'product');
    await renameColumnIfExists('challans', 'date', 'created_at');

    await addColumnIfNotExist('challans', 'sales_id UUID REFERENCES sales(id)');
    await addColumnIfNotExist('challans', 'status TEXT DEFAULT \'Delivered\'');

    await db.query(`UPDATE challans SET status = 'Cancelled' WHERE is_cancelled = TRUE AND (status IS NULL OR status = 'Delivered')`);
    await db.query(`UPDATE challans SET status = 'Delivered' WHERE status IS NULL`);

    const ordersTableCheck = await db.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders'`
    );

    if (ordersTableCheck.rows.length > 0) {
      console.log('Migrating orders table data into sales...');
      const orders = await db.query('SELECT * FROM orders');
      
      for (const order of orders.rows) {
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
          console.log(`Inserting new sale from legacy order ${order.order_number}`);
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

      console.log('Dropping orders table...');
      await db.query('DROP TABLE IF EXISTS orders');
    }

    // Generate order_no for sales without one
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

    // Update status for existing sales based on delivered and ordered quantities
    await db.query(`
      UPDATE sales 
      SET status = CASE 
        WHEN delivered_qty = 0 THEN 'Pending'
        WHEN delivered_qty > 0 AND delivered_qty < ordered_qty THEN 'Partial'
        WHEN delivered_qty >= ordered_qty THEN 'Delivered'
        ELSE 'Pending'
      END
      WHERE status IS NULL OR (status = 'Pending' AND delivered_qty > 0)
    `);

    // Map Challans to Sales records
    console.log('Mapping challans to sales records via sales_id...');
    const orderNoColCheck = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'challans' AND column_name = 'order_number'`
    );

    if (orderNoColCheck.rows.length > 0) {
      const productColCheck = await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'challans' AND column_name = 'product'`
      );
      const productCol = productColCheck.rows.length > 0 ? 'product' : 'product_name';

      const challansRes = await db.query(`SELECT id, order_number, "${productCol}" FROM challans WHERE sales_id IS NULL`);
      console.log(`Found ${challansRes.rows.length} challans to map.`);
      
      for (const chal of challansRes.rows) {
        const match = await db.query(
          `SELECT id FROM sales WHERE order_no = $1 AND product = $2 LIMIT 1`,
          [chal.order_number, chal[productCol]]
        );
        if (match.rows.length > 0) {
          await db.query('UPDATE challans SET sales_id = $1 WHERE id = $2', [match.rows[0].id, chal.id]);
        } else {
          const fallbackMatch = await db.query(
            `SELECT id FROM sales WHERE order_no = $1 LIMIT 1`,
            [chal.order_number]
          );
          if (fallbackMatch.rows.length > 0) {
            await db.query('UPDATE challans SET sales_id = $1 WHERE id = $2', [fallbackMatch.rows[0].id, chal.id]);
          }
        }
      }

      console.log('Dropping order_number column from challans...');
      await db.query('ALTER TABLE challans DROP COLUMN IF EXISTS order_number');
    }

    // 11. Clients data normalization and column checks
    console.log('Step 11: Normalizing clients data and ensuring columns...');
    await addColumnIfNotExist('clients', 'phone TEXT');
    await addColumnIfNotExist('clients', 'price_category TEXT DEFAULT \'Regular\'');
    await addColumnIfNotExist('clients', 'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await addColumnIfNotExist('clients', 'name_gujarati TEXT');

    await db.query(`UPDATE clients SET price_category = 'Regular' WHERE price_category IS NULL OR TRIM(price_category) = ''`);
    // Fetch all clients to handle duplicates prior to trimming client names
    const allClientsRes = await db.query(`SELECT id, name, phone, price_category, created_at FROM clients WHERE name IS NOT NULL`);
    const clientGroups = new Map();
    for (const row of allClientsRes.rows) {
      const trimmedName = row.name.trim();
      if (!trimmedName) continue;
      const key = trimmedName.toLowerCase();
      if (!clientGroups.has(key)) {
        clientGroups.set(key, []);
      }
      clientGroups.get(key).push({ ...row, trimmedName });
    }

    for (const [key, group] of clientGroups.entries()) {
      if (group.length > 1) {
        console.log(`Found ${group.length} duplicate client records for "${group[0].trimmedName}". Merging...`);
        // Sort group to select primary keeper:
        // 1. Exact match (name === trimmedName)
        // 2. Has non-empty phone
        // 3. Earliest created_at / id
        group.sort((a, b) => {
          const aExact = a.name === a.trimmedName ? 1 : 0;
          const bExact = b.name === b.trimmedName ? 1 : 0;
          if (aExact !== bExact) return bExact - aExact;

          const aPhone = a.phone && a.phone.trim() ? 1 : 0;
          const bPhone = b.phone && b.phone.trim() ? 1 : 0;
          if (aPhone !== bPhone) return bPhone - aPhone;

          return (new Date(a.created_at || 0).getTime()) - (new Date(b.created_at || 0).getTime());
        });

        const keeper = group[0];
        const duplicates = group.slice(1);

        let mergedPhone = keeper.phone ? keeper.phone.trim() : null;
        let mergedPriceCategory = keeper.price_category && keeper.price_category.trim() ? keeper.price_category.trim() : 'Regular';

        for (const dup of duplicates) {
          if (!mergedPhone && dup.phone && dup.phone.trim()) {
            mergedPhone = dup.phone.trim();
          }
          if ((!mergedPriceCategory || mergedPriceCategory === 'Regular') && dup.price_category && dup.price_category.trim()) {
            mergedPriceCategory = dup.price_category.trim();
          }
        }

        await db.query(
          `UPDATE clients SET name = $1, phone = $2, price_category = $3 WHERE id = $4`,
          [keeper.trimmedName, mergedPhone, mergedPriceCategory, keeper.id]
        );

        const dupIds = duplicates.map(d => d.id);
        await db.query(`DELETE FROM clients WHERE id = ANY($1::uuid[])`, [dupIds]);
      } else {
        const client = group[0];
        const newPhone = client.phone ? client.phone.trim() || null : null;
        if (client.name !== client.trimmedName || client.phone !== newPhone) {
          await db.query(
            `UPDATE clients SET name = $1, phone = $2 WHERE id = $3`,
            [client.trimmedName, newPhone, client.id]
          );
        }
      }
    }

    await db.query(`UPDATE clients SET phone = TRIM(phone) WHERE phone IS NOT NULL AND phone != TRIM(phone)`);
    await db.query(`UPDATE clients SET phone = NULL WHERE phone IS NOT NULL AND TRIM(phone) = ''`);

    // Transliterate and populate Gujarati names for clients missing it
    console.log('Step 11b: Transliterating missing Gujarati client names...');
    try {
      const clientsMissingGujarati = await db.query(
        "SELECT id, name FROM clients WHERE name_gujarati IS NULL OR TRIM(name_gujarati) = '' ORDER BY created_at ASC"
      );
      if (clientsMissingGujarati.rows.length > 0) {
        console.log(`Found ${clientsMissingGujarati.rows.length} client(s) needing Gujarati transliteration.`);
        for (const client of clientsMissingGujarati.rows) {
          const gujaratiName = await transliterateText(client.name);
          if (gujaratiName) {
            await db.query("UPDATE clients SET name_gujarati = $1 WHERE id = $2", [
              gujaratiName,
              client.id,
            ]);
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        console.log(`Populated Gujarati names for ${clientsMissingGujarati.rows.length} client(s).`);
      } else {
        console.log('All clients already have Gujarati names.');
      }
    } catch (transErr) {
      console.log('Note: Gujarati transliteration skipped (network or api unavailable):', transErr.message);
    }

    // 12. Migrate nil_qty to display_qty if legacy column exists
    console.log('Step 12: Checking legacy nil_qty column on batches...');
    if (await columnExists('batches', 'nil_qty')) {
      await db.query(`UPDATE batches SET display_qty = nil_qty WHERE display_qty = 0 AND nil_qty > 0`);
    }

    // 13. Ensuring indexes exist for query performance
    console.log('Step 13: Creating database indexes...');
    await db.query(`CREATE INDEX IF NOT EXISTS idx_sales_order_no ON sales(order_no)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_sales_estimated_delivery ON sales(estimated_delivery_date)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_sales_order_date ON sales(order_date)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_challans_sales_id ON challans(sales_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_challans_customer ON challans(customer)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_challans_product ON challans(product)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_challans_cancelled ON challans(is_cancelled)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_challans_challan_no ON challans(challan_no)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_challans_created_at ON challans(created_at DESC)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_batches_product_name ON batches(product_name)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_batches_category_lower ON batches(LOWER(category))`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_batches_date_desc ON batches(date DESC)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_batches_prod_batch ON batches(LOWER(product_name), LOWER(batch_number))`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_products_name_lower ON products(LOWER(TRIM(name)))`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_sales_returns_product_name ON sales_returns(LOWER(TRIM(product_name)))`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_sales_returns_client_name ON sales_returns(LOWER(TRIM(client_name)))`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_clients_name_lower ON clients(LOWER(TRIM(name)))`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(TRIM(phone)) WHERE phone IS NOT NULL`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_holds_client_name ON holds(LOWER(TRIM(client_name)))`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_holds_status ON holds(status)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_purchases_prod_batch ON purchases(LOWER(TRIM(product_name)), LOWER(TRIM(batch_number)))`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date DESC)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_challan_notes_status ON challan_notes(status)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_challan_notes_created_at ON challan_notes(created_at DESC)`);

    // 14. Sync products table from existing batches, purchases, and sales
    console.log('Step 14: Syncing products table from batches, purchases, and sales...');
    await db.query(`
      INSERT INTO products (name, category)
      SELECT DISTINCT TRIM(b.product_name), COALESCE(MAX(b.category), 'Standard')
      FROM batches b
      WHERE b.product_name IS NOT NULL 
        AND TRIM(b.product_name) != ''
        AND NOT EXISTS (
          SELECT 1 FROM products p WHERE LOWER(TRIM(p.name)) = LOWER(TRIM(b.product_name))
        )
      GROUP BY TRIM(b.product_name)
    `);

    await db.query(`
      INSERT INTO products (name, category)
      SELECT DISTINCT TRIM(p.product_name), COALESCE(MAX(p.category), 'Standard')
      FROM purchases p
      WHERE p.product_name IS NOT NULL 
        AND TRIM(p.product_name) != ''
        AND NOT EXISTS (
          SELECT 1 FROM products prod WHERE LOWER(TRIM(prod.name)) = LOWER(TRIM(p.product_name))
        )
      GROUP BY TRIM(p.product_name)
    `);

    await db.query(`
      INSERT INTO products (name, category)
      SELECT DISTINCT TRIM(s.product), COALESCE(MAX(s.category), 'Standard')
      FROM sales s
      WHERE s.product IS NOT NULL 
        AND TRIM(s.product) != ''
        AND NOT EXISTS (
          SELECT 1 FROM products prod WHERE LOWER(TRIM(prod.name)) = LOWER(TRIM(s.product))
        )
      GROUP BY TRIM(s.product)
    `);

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

