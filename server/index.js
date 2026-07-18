const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const db = require('./db');


const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

async function ensureDeliveredAtColumn() {
  await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP');
}

ensureDeliveredAtColumn().catch((err) => {
  console.error('❌ Database initialization failed:', err.message);
});

async function ensureChallanCancelColumns() {
  await db.query('ALTER TABLE challans ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN DEFAULT FALSE');
  await db.query('ALTER TABLE challans ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP');
  await db.query('ALTER TABLE challans ADD COLUMN IF NOT EXISTS is_built BOOLEAN DEFAULT FALSE');
  await db.query('ALTER TABLE challans ADD COLUMN IF NOT EXISTS restored_qty INTEGER');
}

ensureChallanCancelColumns().catch((err) => {
  console.error('❌ Challan column initialization failed:', err.message);
});

async function ensureSaleDamageColumns() {
  await db.query('ALTER TABLE sales ADD COLUMN IF NOT EXISTS damage_qty INTEGER DEFAULT 0');
}

ensureSaleDamageColumns().catch((err) => {
  console.error('Sales damage column initialization failed:', err.message);
});

async function ensureSalesReturnTable() {
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
}

ensureSalesReturnTable().catch((err) => {
  console.error('Sales return table initialization failed:', err.message);
});

async function ensureDisplayQtyAndStockCategory() {
  await db.query('ALTER TABLE batches ADD COLUMN IF NOT EXISTS display_qty INTEGER DEFAULT 0');
  try {
    await db.query('UPDATE batches SET display_qty = nil_qty WHERE display_qty = 0 AND nil_qty > 0');
  } catch (e) {
    // If nil_qty column doesn't exist/already removed, ignore
  }
  await db.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS stock_category TEXT DEFAULT 'Available'");
  await db.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_category TEXT DEFAULT 'Available'");
  await db.query("ALTER TABLE challans ADD COLUMN IF NOT EXISTS stock_category TEXT DEFAULT 'Available'");
}

ensureDisplayQtyAndStockCategory().catch((err) => {
  console.error('Database migration for display_qty / stock_category failed:', err.message);
});

// Helper for UUID generation if needed in JS, but DB handles it
const uid = () => require('crypto').randomUUID();
const deliveryTimestampSql = "CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'";

// --- Auth Routes ---
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await db.query('SELECT * FROM users WHERE email = $1 AND password = $2', [email, password]);
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Products ---
app.get('/api/products', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM products');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', async (req, res) => {
  const { name, category, size, barcode } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO products (name, category, size, barcode) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, category, size, barcode]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Batches ---
app.get('/api/batches', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM batches');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/batches', async (req, res) => {
  const { product_id, product_code, product_name, category, batch_number, supplier, quantity, rate, date, available_qty, damage_qty, display_qty, nil_qty, description } = req.body;
  const productId = product_id === '' ? null : product_id;
  const displayQty = display_qty !== undefined ? display_qty : (nil_qty !== undefined ? nil_qty : 0);
  try {
    const result = await db.query(
      `INSERT INTO batches 
      (product_id, product_code, product_name, category, batch_number, supplier, quantity, rate, date, available_qty, damage_qty, display_qty, description) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [productId, product_code, product_name, category, batch_number, supplier, quantity, rate, date, available_qty, damage_qty, displayQty, description]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/batches/:id', async (req, res) => {
  const { id } = req.params;
  const fields = { ...req.body };
  if (fields.nil_qty !== undefined) {
    fields.display_qty = fields.nil_qty;
    delete fields.nil_qty;
  }
  const setClause = Object.keys(fields).map((key, i) => `${key} = $${i + 1}`).join(', ');
  const values = Object.values(fields);
  try {
    const result = await db.query(`UPDATE batches SET ${setClause} WHERE id = $${values.length + 1} RETURNING *`, [...values, id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/batches/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM batches WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Purchases ---
app.get('/api/purchases', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM purchases');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/purchases', async (req, res) => {
  const { supplier_name, supplier_phone, product_name, category, quantity, rate, total_amount, batch_number, date } = req.body;
  try {
    await db.query('BEGIN');
    
    const result = await db.query(
      `INSERT INTO purchases (supplier_name, supplier_phone, product_name, category, quantity, rate, total_amount, batch_number, date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [supplier_name, supplier_phone, product_name, category, quantity, rate, total_amount, batch_number, date]
    );

    // Upsert stock in batches
    if (batch_number) {
      const updateResult = await db.query(
        'UPDATE batches SET available_qty = available_qty + $1, quantity = quantity + $1 WHERE batch_number = $2 AND product_name = $3',
        [quantity, batch_number, product_name]
      );
      
      if (updateResult.rowCount === 0) {
        // Create new batch if it doesn't exist
        await db.query(
          `INSERT INTO batches 
          (product_name, category, batch_number, supplier, quantity, available_qty, date) 
          VALUES ($1, $2, $3, $4, $5, $5, $6)`,
          [product_name, category, batch_number, supplier_name, quantity, date]
        );
      }
    }

    await db.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/purchases/:id', async (req, res) => {
  const { id } = req.params;
  const fields = req.body;
  const setClause = Object.keys(fields).map((key, i) => `${key} = $${i + 1}`).join(', ');
  const values = Object.values(fields);
  try {
    const result = await db.query(`UPDATE purchases SET ${setClause} WHERE id = $${values.length + 1} RETURNING *`, [...values, id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/purchases/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM purchases WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Sales ---

app.get('/api/sales', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM sales');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales', async (req, res) => {
  const { client_name, client_phone, product_name, category, quantity, rate, total_price, order_date, value_category, batch_no, narration, damage_qty = 0, stock_category = 'Available' } = req.body;
  try {
    // Start transaction
    await db.query('BEGIN');

    const result = await db.query(
      `INSERT INTO sales 
      (client_name, client_phone, product_name, category, quantity, rate, total_price, order_date, value_category, batch_no, narration, damage_qty, stock_category) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [client_name, client_phone, product_name, category, quantity, rate, total_price, order_date, value_category, batch_no, narration, damage_qty, stock_category]
    );
 
    // Automatically update or create client profile
    await db.query(
      'INSERT INTO clients (name, phone, price_category) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET phone = EXCLUDED.phone, price_category = EXCLUDED.price_category',
      [client_name, client_phone, category]
    );

    let bQuery = 'SELECT id, batch_number, available_qty, display_qty, damage_qty FROM batches WHERE product_name = $1';
    let bParams = [product_name];
    if (batch_no) {
      bQuery += ' AND batch_number = $2';
      bParams.push(batch_no);
    }
    bQuery += ' ORDER BY date ASC';
    
    const batchesResult = await db.query(bQuery, bParams);
    let remainingToSell = Number(quantity || 0);
    let totalDeducted = 0;
    let lastBatchNo = batch_no;

    let updateCol = 'available_qty';
    if (stock_category === 'Damage') {
      updateCol = 'damage_qty';
    } else if (stock_category === 'Display') {
      updateCol = 'display_qty';
    }

    for (const b of batchesResult.rows) {
      if (remainingToSell <= 0) break;

      const availableInBatch = Number(b[updateCol] || 0);
      const canDeduct = Math.min(remainingToSell, availableInBatch);
      if (canDeduct > 0) {
        await db.query(`UPDATE batches SET ${updateCol} = ${updateCol} - $1 WHERE id = $2`, [canDeduct, b.id]);
        remainingToSell -= canDeduct;
        totalDeducted += canDeduct;
      }
      lastBatchNo = b.batch_number;
    }

    const pending_qty = Number(quantity || 0) - totalDeducted;
    const fulfilled_qty = totalDeducted;

    // Update the sale record with pending/fulfilled quantities and the batch number used
    const updatedSale = await db.query(
      'UPDATE sales SET pending_qty = $1, fulfilled_qty = $2, batch_no = $3 WHERE id = $4 RETURNING *',
      [pending_qty, fulfilled_qty, lastBatchNo || batch_no, result.rows[0].id]
    );

    await db.query('COMMIT');
    res.json(updatedSale.rows[0]);
  } catch (err) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/sales/:id', async (req, res) => {
  const { id } = req.params;
  const fields = req.body;
  const setClause = Object.keys(fields).map((key, i) => `${key} = $${i + 1}`).join(', ');
  const values = Object.values(fields);
  try {
    const result = await db.query(`UPDATE sales SET ${setClause} WHERE id = $${values.length + 1} RETURNING *`, [...values, id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sales/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM sales WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Sales Returns ---
app.get('/api/sales-returns', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM sales_returns ORDER BY receive_date DESC, created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales-returns', async (req, res) => {
  const { client_name, client_phone, price_category, receive_date, product_name, quantity, batch_no, notes } = req.body;
  const qty = Number(quantity || 0);
  try {
    await db.query('BEGIN');

    const result = await db.query(
      `INSERT INTO sales_returns
       (client_name, client_phone, price_category, receive_date, product_name, quantity, batch_no, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [client_name, client_phone, price_category, receive_date, product_name, qty, batch_no || null, notes || null]
    );

    let updated = false;
    if (batch_no) {
      const updateResult = await db.query(
        'UPDATE batches SET available_qty = CASE WHEN quantity > 0 THEN LEAST(quantity, available_qty + $1) ELSE available_qty + $1 END WHERE product_name = $2 AND batch_number = $3',
        [qty, product_name, batch_no]
      );
      updated = updateResult.rowCount > 0;
    }

    if (!updated) {
      const batchLookup = await db.query(
        'SELECT id FROM batches WHERE product_name = $1 ORDER BY date ASC LIMIT 1',
        [product_name]
      );
      if (batchLookup.rows.length > 0) {
        await db.query(
          'UPDATE batches SET available_qty = CASE WHEN quantity > 0 THEN LEAST(quantity, available_qty + $1) ELSE available_qty + $1 END WHERE id = $2',
          [qty, batchLookup.rows[0].id]
        );
        updated = true;
      }
    }

    if (!updated) {
      const productLookup = await db.query('SELECT category FROM products WHERE name = $1 LIMIT 1', [product_name]);
      const category = productLookup.rows.length > 0 ? productLookup.rows[0].category : 'Other';
      await db.query(
        'INSERT INTO batches (product_name, category, batch_number, quantity, available_qty, date) VALUES ($1, $2, $3, 0, $4, CURRENT_DATE)',
        [product_name, category, batch_no || `RET-${Date.now().toString(36).toUpperCase()}`, qty]
      );
    }

    await db.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// --- Orders ---
app.get('/api/orders', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM orders');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  const { order_number, client_name, client_phone, product_name, quantity, total_amount, order_date, status, batch_no, pending_qty, fulfilled_qty, narration, stock_category = 'Available' } = req.body;
  try {
    const deliveredAtSql = status === 'Delivered' ? deliveryTimestampSql : 'NULL';
    const result = await db.query(
      `INSERT INTO orders 
      (order_number, client_name, client_phone, product_name, quantity, total_amount, order_date, status, batch_no, pending_qty, fulfilled_qty, narration, delivered_at, stock_category) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, ${deliveredAtSql}, $13) RETURNING *`,
      [
        order_number,
        client_name,
        client_phone,
        product_name,
        quantity,
        total_amount,
        order_date,
        status,
        batch_no,
        (pending_qty !== undefined && pending_qty !== null) ? pending_qty : (status === 'Delivered' ? 0 : quantity),
        (fulfilled_qty !== undefined && fulfilled_qty !== null) ? fulfilled_qty : (status === 'Delivered' ? quantity : 0),
        narration,
        stock_category
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const fields = req.body;
  const skipStockUpdate = fields.skip_stock_update === true;
  delete fields.delivered_at;
  
  try {
    await db.query('BEGIN');

    // Get old order to calculate stock adjustment
    const orderRes = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (orderRes.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }
    const oldOrder = orderRes.rows[0];

    // Determine new values
    const newStatus = fields.status || oldOrder.status;
    const newProduct = fields.product_name || oldOrder.product_name;
    const newBatch = fields.batch_no || oldOrder.batch_no;
    let newFulfilled = fields.fulfilled_qty !== undefined ? fields.fulfilled_qty : oldOrder.fulfilled_qty;

    // If status is changed to Delivered, ensure everything is fulfilled
    if (fields.status === 'Delivered' && oldOrder.status !== 'Delivered') {
       newFulfilled = fields.quantity || oldOrder.quantity;
       fields.pending_qty = 0;
       fields.fulfilled_qty = newFulfilled;
    }

    // Handle stock synchronization unless caller explicitly skips it
    const productChanged = newProduct !== oldOrder.product_name;
    const batchChanged = newBatch !== oldOrder.batch_no;
    const fulfilledChanged = newFulfilled !== oldOrder.fulfilled_qty;
    const categoryChanged = fields.stock_category !== undefined && fields.stock_category !== oldOrder.stock_category;

    if (!skipStockUpdate && (productChanged || batchChanged || fulfilledChanged || categoryChanged)) {
      // 1. Revert old stock deduction
      if (oldOrder.fulfilled_qty > 0 && oldOrder.product_name) {
        const oldCategory = oldOrder.stock_category || 'Available';
        let revertCol = 'available_qty';
        if (oldCategory === 'Display') revertCol = 'display_qty';
        else if (oldCategory === 'Damage') revertCol = 'damage_qty';

        await db.query(
          `UPDATE batches SET ${revertCol} = CASE WHEN quantity > 0 THEN LEAST(quantity, ${revertCol} + $1) ELSE ${revertCol} + $1 END WHERE product_name = $2 AND batch_number = $3`,
          [oldOrder.fulfilled_qty, oldOrder.product_name, oldOrder.batch_no || '0']
        );
      }

      // 2. Apply new stock deduction
      if (newFulfilled > 0 && newProduct) {
        const newCategory = fields.stock_category || oldOrder.stock_category || 'Available';
        let applyCol = 'available_qty';
        if (newCategory === 'Display') applyCol = 'display_qty';
        else if (newCategory === 'Damage') applyCol = 'damage_qty';

        const updateResult = await db.query(
          `UPDATE batches SET ${applyCol} = ${applyCol} - $1 WHERE product_name = $2 AND batch_number = $3`,
          [newFulfilled, newProduct, newBatch || '0']
        );

        if (updateResult.rowCount === 0) {
          // Create placeholder batch if it doesn't exist
          const productLookup = await db.query('SELECT category FROM products WHERE name = $1 LIMIT 1', [newProduct]);
          const category = productLookup.rows.length > 0 ? productLookup.rows[0].category : 'Other';
          
          let insertCols = 'product_name, category, batch_number, quantity, date';
          let insertVals = '$1, $2, $3, 0, CURRENT_DATE';
          if (newCategory === 'Display') {
            insertCols += ', display_qty';
            insertVals += ', ' + (-newFulfilled);
          } else if (newCategory === 'Damage') {
            insertCols += ', damage_qty';
            insertVals += ', ' + (-newFulfilled);
          } else {
            insertCols += ', available_qty';
            insertVals += ', ' + (-newFulfilled);
          }

          await db.query(
            `INSERT INTO batches (${insertCols}) VALUES (${insertVals})`,
            [newProduct, category, newBatch || '0']
          );
        }
      }
    }

    // Prepare update query
    const updateKeys = Object.keys(fields).filter((key) => key !== 'skip_stock_update');
    if (updateKeys.length > 0) {
      const setClause = updateKeys.map((key, i) => `${key} = $${i + 1}`).join(', ');
      const values = Object.entries(fields)
        .filter(([key]) => key !== 'skip_stock_update')
        .map(([, value]) => value);
      const finalValues = [...values];
      let finalSetClause = setClause;
      if (fields.status === 'Delivered' && oldOrder.status !== 'Delivered') {
        finalSetClause += `, delivered_at = ${deliveryTimestampSql}`;
      }
      const result = await db.query(`UPDATE orders SET ${finalSetClause} WHERE id = $${finalValues.length + 1} RETURNING *`, [...finalValues, id]);
      await db.query('COMMIT');
      res.json(result.rows[0]);
    } else {
      await db.query('COMMIT');
      res.json(oldOrder);
    }
  } catch (err) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM orders WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Challans ---
app.get('/api/challans', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM challans ORDER BY date DESC, id DESC');
    const challans = result.rows;

    const returnsRes = await db.query('SELECT client_name, product_name, batch_no, quantity FROM sales_returns');
    const returns = returnsRes.rows;

    const returnsByKey = new Map();
    for (const r of returns) {
      const key = `${r.client_name}||${r.product_name}||${r.batch_no || '0'}`;
      returnsByKey.set(key, (returnsByKey.get(key) || 0) + Number(r.quantity || 0));
    }

    const sortedChallans = [...challans].sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      if (dateA !== dateB) return dateA - dateB;
      const idA = a.id ? String(a.id) : '';
      const idB = b.id ? String(b.id) : '';
      return idA.localeCompare(idB);
    });
    const distributedReturnsByKey = new Map();

    for (const c of sortedChallans) {
      const key = `${c.client_name}||${c.product_name}||${c.batch_no || '0'}`;
      const totalReturns = returnsByKey.get(key) || 0;
      const alreadyDistributed = distributedReturnsByKey.get(key) || 0;
      const remainingReturns = Math.max(0, totalReturns - alreadyDistributed);

      if (c.is_cancelled) {
        const absorbed = Number(c.quantity || 0) - Number(c.restored_qty ?? c.quantity);
        c.returned_qty = absorbed;
        distributedReturnsByKey.set(key, alreadyDistributed + absorbed);
      } else {
        const toAbsorb = Math.min(Number(c.quantity || 0), remainingReturns);
        c.returned_qty = toAbsorb;
        distributedReturnsByKey.set(key, alreadyDistributed + toAbsorb);
      }
    }

    res.json(challans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/challans', async (req, res) => {
  const { challan_number, order_number, client_name, client_phone, product_name, quantity, date, batch_no, notes, should_fulfill, skip_stock_update, stock_category = 'Available' } = req.body;
  try {
    await db.query('BEGIN');
    
    const result = await db.query(
      `INSERT INTO challans 
      (challan_number, order_number, client_name, client_phone, product_name, quantity, date, batch_no, notes, is_cancelled, stock_category) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, $10) RETURNING *`,
      [challan_number, order_number, client_name, client_phone, product_name, quantity, date, batch_no, notes, stock_category]
    );
    
    if (should_fulfill) {
      // Mark as generated AND fulfill everything (used when clearing backorders)
      await db.query(
        'UPDATE orders SET is_challan_generated = TRUE, pending_qty = 0, fulfilled_qty = quantity WHERE order_number = $1',
        [order_number]
      );
    } else {
      // Just mark as generated, keep existing partial quantities
      await db.query(
        'UPDATE orders SET is_challan_generated = TRUE WHERE order_number = $1',
        [order_number]
      );
    }

    // Deduct stock from the specified batch (allow negative stock as requested)
    if (!skip_stock_update && batch_no && product_name) {
      let applyCol = 'available_qty';
      if (stock_category === 'Display') applyCol = 'display_qty';
      else if (stock_category === 'Damage') applyCol = 'damage_qty';

      const updateResult = await db.query(
        `UPDATE batches SET ${applyCol} = ${applyCol} - $1 WHERE batch_number = $2 AND product_name = $3`,
        [quantity, batch_no, product_name]
      );
      
      if (updateResult.rowCount === 0) {
        // Find category from products or sales to create a placeholder batch
        const productRes = await db.query('SELECT category FROM products WHERE name = $1 LIMIT 1', [product_name]);
        let category = 'Other';
        if (productRes.rows.length > 0) {
          category = productRes.rows[0].category;
        } else {
          const saleRes = await db.query('SELECT category FROM sales WHERE product_name = $1 LIMIT 1', [product_name]);
          if (saleRes.rows.length > 0) category = saleRes.rows[0].category;
        }

        let insertCols = 'product_name, category, batch_number, quantity, date';
        let insertVals = '$1, $2, $3, 0, $5';
        let params = [product_name, category, batch_no, -quantity, date];
        if (stock_category === 'Display') {
          insertCols += ', display_qty';
          insertVals += ', $4';
        } else if (stock_category === 'Damage') {
          insertCols += ', damage_qty';
          insertVals += ', $4';
        } else {
          insertCols += ', available_qty';
          insertVals += ', $4';
        }

        await db.query(
          `INSERT INTO batches (${insertCols}) VALUES (${insertVals})`,
          params
        );
      }
    }

    await db.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/challans/:id', async (req, res) => {
  const { id } = req.params;
  const fields = { ...req.body };
  if (fields.stockCategory !== undefined) {
    fields.stock_category = fields.stockCategory;
    delete fields.stockCategory;
  }
  const existing = await db.query('SELECT is_cancelled FROM challans WHERE id = $1', [id]);
  if (existing.rows.length > 0 && existing.rows[0].is_cancelled && fields.is_built === true) {
    return res.status(400).json({ error: 'Cancelled challans cannot be marked as built' });
  }
  const setClause = Object.keys(fields).map((key, i) => `${key} = $${i + 1}`).join(', ');
  const values = Object.values(fields);
  try {
    const result = await db.query(`UPDATE challans SET ${setClause} WHERE id = $${values.length + 1} RETURNING *`, [...values, id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/challans/group/:challanNumber', async (req, res) => {
  const { challanNumber } = req.params;
  const { client_name, client_phone, date, items = [] } = req.body;
  try {
    await db.query('BEGIN');

    const existingRes = await db.query('SELECT * FROM challans WHERE challan_number = $1', [challanNumber]);
    const existingItems = existingRes.rows;
    if (existingItems.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'Challan not found' });
    }

    const stockByKey = new Map();
    for (const row of existingItems) {
      const key = `${row.product_name}||${row.batch_no || ''}||${row.stock_category || 'Available'}`;
      stockByKey.set(key, (stockByKey.get(key) || 0) + Number(row.quantity || 0));
    }

    const newByKey = new Map();
    for (const item of items) {
      const category = item.stockCategory || item.stock_category || 'Available';
      const key = `${item.product_name}||${item.batch_no || ''}||${category}`;
      newByKey.set(key, (newByKey.get(key) || 0) + Number(item.quantity || 0));
    }

    for (const [key, oldQty] of stockByKey.entries()) {
      const [productName, batchNo = '', stockCategory = 'Available'] = key.split('||');
      const newQty = newByKey.get(key) || 0;
      const diff = oldQty - newQty;

      let updateCol = 'available_qty';
      if (stockCategory === 'Display') updateCol = 'display_qty';
      else if (stockCategory === 'Damage') updateCol = 'damage_qty';

      if (diff > 0) {
        await db.query(
          `UPDATE batches SET ${updateCol} = CASE WHEN quantity > 0 THEN LEAST(quantity, ${updateCol} + $1) ELSE ${updateCol} + $1 END WHERE product_name = $2 AND batch_number = $3`,
          [diff, productName, batchNo]
        );
      } else if (diff < 0) {
        await db.query(
          `UPDATE batches SET ${updateCol} = ${updateCol} - $1 WHERE product_name = $2 AND batch_number = $3`,
          [-diff, productName, batchNo]
        );
      }
    }

    for (const [key, newQty] of newByKey.entries()) {
      if (stockByKey.has(key)) continue;
      const [productName, batchNo = '', stockCategory = 'Available'] = key.split('||');

      let updateCol = 'available_qty';
      if (stockCategory === 'Display') updateCol = 'display_qty';
      else if (stockCategory === 'Damage') updateCol = 'damage_qty';

      await db.query(
        `UPDATE batches SET ${updateCol} = ${updateCol} - $1 WHERE product_name = $2 AND batch_number = $3`,
        [newQty, productName, batchNo]
      );
    }

    await db.query('DELETE FROM challans WHERE challan_number = $1', [challanNumber]);

    for (const item of items) {
      const category = item.stockCategory || item.stock_category || 'Available';
      await db.query(
        `INSERT INTO challans
         (challan_number, order_number, client_name, client_phone, product_name, quantity, date, batch_no, notes, is_cancelled, stock_category)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, $10)`,
        [
          challanNumber,
          challanNumber,
          client_name,
          client_phone || '',
          item.product_name,
          item.quantity,
          date,
          item.batch_no || '',
          item.notes || null,
          category,
        ]
      );
    }

    await db.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/challans/group/:challanNumber/cancel', async (req, res) => {
  const { challanNumber } = req.params;
  try {
    await db.query('BEGIN');
    const existingRes = await db.query('SELECT * FROM challans WHERE challan_number = $1', [challanNumber]);
    const existingItems = existingRes.rows;
    if (existingItems.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'Challan not found' });
    }

    const alreadyCancelled = existingItems.every((item) => item.is_cancelled);
    if (!alreadyCancelled) {
      for (const item of existingItems) {
        const stockCategory = item.stock_category || 'Available';
        let updateCol = 'available_qty';
        if (stockCategory === 'Display') updateCol = 'display_qty';
        else if (stockCategory === 'Damage') updateCol = 'damage_qty';

        // 1. Get total returns for this client, product and batch
        const returnsRes = await db.query(
          `SELECT COALESCE(SUM(quantity), 0) AS total_returns 
           FROM sales_returns 
           WHERE client_name = $1 AND product_name = $2 AND batch_no = $3`,
          [item.client_name, item.product_name, item.batch_no || '0']
        );
        const totalReturns = Number(returnsRes.rows[0].total_returns || 0);

        // 2. Get total returns already applied to other cancelled challans
        const appliedRes = await db.query(
          `SELECT COALESCE(SUM(quantity - COALESCE(restored_qty, quantity)), 0) AS total_applied 
           FROM challans 
           WHERE client_name = $1 AND product_name = $2 AND batch_no = $3 AND is_cancelled = TRUE`,
          [item.client_name, item.product_name, item.batch_no || '0']
        );
        const totalApplied = Number(appliedRes.rows[0].total_applied || 0);

        const unappliedReturns = Math.max(0, totalReturns - totalApplied);
        const restoreQty = Math.max(0, Number(item.quantity || 0) - unappliedReturns);

        await db.query(
          `UPDATE batches SET ${updateCol} = CASE WHEN quantity > 0 THEN LEAST(quantity, ${updateCol} + $1) ELSE ${updateCol} + $1 END WHERE product_name = $2 AND batch_number = $3`,
          [restoreQty, item.product_name, item.batch_no || '0']
        );

        // Update the item's restored_qty
        await db.query(
          'UPDATE challans SET restored_qty = $1 WHERE id = $2',
          [restoreQty, item.id]
        );
      }
    }

    await db.query(
      'UPDATE challans SET is_cancelled = TRUE, cancelled_at = CURRENT_TIMESTAMP WHERE challan_number = $1',
      [challanNumber]
    );

    await db.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/challans/cancel/:challanNumber', async (req, res) => {
  const { challanNumber } = req.params;
  try {
    await db.query('BEGIN');
    const existingRes = await db.query('SELECT * FROM challans WHERE challan_number = $1', [challanNumber]);
    const existingItems = existingRes.rows;
    if (existingItems.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'Challan not found' });
    }

    const alreadyCancelled = existingItems.every((item) => item.is_cancelled);
    if (!alreadyCancelled) {
      for (const item of existingItems) {
        const stockCategory = item.stock_category || 'Available';
        let updateCol = 'available_qty';
        if (stockCategory === 'Display') updateCol = 'display_qty';
        else if (stockCategory === 'Damage') updateCol = 'damage_qty';

        // 1. Get total returns for this client, product and batch
        const returnsRes = await db.query(
          `SELECT COALESCE(SUM(quantity), 0) AS total_returns 
           FROM sales_returns 
           WHERE client_name = $1 AND product_name = $2 AND batch_no = $3`,
          [item.client_name, item.product_name, item.batch_no || '0']
        );
        const totalReturns = Number(returnsRes.rows[0].total_returns || 0);

        // 2. Get total returns already applied to other cancelled challans
        const appliedRes = await db.query(
          `SELECT COALESCE(SUM(quantity - COALESCE(restored_qty, quantity)), 0) AS total_applied 
           FROM challans 
           WHERE client_name = $1 AND product_name = $2 AND batch_no = $3 AND is_cancelled = TRUE`,
          [item.client_name, item.product_name, item.batch_no || '0']
        );
        const totalApplied = Number(appliedRes.rows[0].total_applied || 0);

        const unappliedReturns = Math.max(0, totalReturns - totalApplied);
        const restoreQty = Math.max(0, Number(item.quantity || 0) - unappliedReturns);

        await db.query(
          `UPDATE batches SET ${updateCol} = CASE WHEN quantity > 0 THEN LEAST(quantity, ${updateCol} + $1) ELSE ${updateCol} + $1 END WHERE product_name = $2 AND batch_number = $3`,
          [restoreQty, item.product_name, item.batch_no || '0']
        );

        // Update the item's restored_qty
        await db.query(
          'UPDATE challans SET restored_qty = $1 WHERE id = $2',
          [restoreQty, item.id]
        );
      }
    }

    await db.query(
      'UPDATE challans SET is_cancelled = TRUE, cancelled_at = CURRENT_TIMESTAMP WHERE challan_number = $1',
      [challanNumber]
    );

    await db.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/challans/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('BEGIN');
    
    // Get the order_number before deleting
    const challanRes = await db.query('SELECT order_number FROM challans WHERE id = $1', [id]);
    
    if (challanRes.rows.length > 0) {
      const orderNumber = challanRes.rows[0].order_number;
      
      // Delete the challan
      await db.query('DELETE FROM challans WHERE id = $1', [id]);
      
      // Check if there are any OTHER challans for this order (in case of partial delivery etc. though current logic is 1:1)
      const others = await db.query('SELECT id FROM challans WHERE order_number = $1', [orderNumber]);
      if (others.rows.length === 0) {
        await db.query('UPDATE orders SET is_challan_generated = FALSE WHERE order_number = $1', [orderNumber]);
      }
    } else {
      await db.query('DELETE FROM challans WHERE id = $1', [id]);
    }

    await db.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// --- Clients ---
app.get('/api/clients', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM clients ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clients', async (req, res) => {
  const { name, phone, price_category } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO clients (name, phone, price_category) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET phone = EXCLUDED.phone, price_category = EXCLUDED.price_category RETURNING *',
      [name, phone, price_category]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/clients/:id', async (req, res) => {
  const { id } = req.params;
  const { name, phone, price_category } = req.body;
  try {
    const result = await db.query(
      'UPDATE clients SET name = $1, phone = $2, price_category = $3 WHERE id = $4 RETURNING *',
      [name, phone, price_category, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clients/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM clients WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Users ---
app.get('/api/users', async (req, res) => {
  try {
    const result = await db.query('SELECT id, name, role, email FROM users');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', async (req, res) => {
  const { name, role, email, password } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO users (name, role, email, password) VALUES ($1, $2, $3, $4) RETURNING id, name, role, email',
      [name, role, email, password]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// --- Holds ---
app.get('/api/holds', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM holds ORDER BY hold_date DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/holds', async (req, res) => {
  const { client_name, client_phone, product_name, category, quantity, batch_no, hold_date } = req.body;
  try {
    await db.query('BEGIN');

    const result = await db.query(
      `INSERT INTO holds (client_name, client_phone, product_name, category, quantity, batch_no, hold_date) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [client_name, client_phone, product_name, category, quantity, batch_no, hold_date || new Date().toISOString().split('T')[0]]
    );

    // Deduct stock from available and add to hold
    let bQuery = 'SELECT id, batch_number, available_qty FROM batches WHERE product_name = $1';
    let bParams = [product_name];
    if (batch_no) {
      bQuery += ' AND batch_number = $2';
      bParams.push(batch_no);
    }
    bQuery += ' AND available_qty > 0 ORDER BY date ASC';
    
    const batchesResult = await db.query(bQuery, bParams);
    let remainingToHold = quantity;
    let lastBatchNo = batch_no;

    for (const b of batchesResult.rows) {
      if (remainingToHold <= 0) break;
      const canHold = Math.min(remainingToHold, b.available_qty);
      await db.query('UPDATE batches SET available_qty = available_qty - $1, hold_qty = hold_qty + $1 WHERE id = $2', [canHold, b.id]);
      remainingToHold -= canHold;
      lastBatchNo = b.batch_number;
    }

    if (!batch_no && lastBatchNo) {
        await db.query('UPDATE holds SET batch_no = $1 WHERE id = $2', [lastBatchNo, result.rows[0].id]);
        result.rows[0].batch_no = lastBatchNo;
    }

    await db.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/holds/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('BEGIN');
    
    const holdRes = await db.query('SELECT * FROM holds WHERE id = $1', [id]);
    if (holdRes.rows.length > 0) {
      const hold = holdRes.rows[0];
      
      // Return stock
      if (hold.product_name) {
        await db.query(
          'UPDATE batches SET available_qty = CASE WHEN quantity > 0 THEN LEAST(quantity, available_qty + $1) ELSE available_qty + $1 END, hold_qty = GREATEST(0, hold_qty - $1) WHERE product_name = $2 AND batch_number = $3',
          [hold.quantity, hold.product_name, hold.batch_no || '0']
        );
      }
      
      await db.query('DELETE FROM holds WHERE id = $1', [id]);
    }

    await db.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// Test database connection on startup
db.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
  } else {
    console.log('✅ Connected to PostgreSQL at:', res.rows[0].now);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

