const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const db = require('./db');


const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Helper for UUID generation if needed in JS, but DB handles it
const uid = () => require('crypto').randomUUID();

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
  const { product_id, product_code, product_name, category, batch_number, supplier, quantity, rate, date, available_qty, damage_qty, nil_qty } = req.body;
  const productId = product_id === '' ? null : product_id;
  try {
    const result = await db.query(
      `INSERT INTO batches 
      (product_id, product_code, product_name, category, batch_number, supplier, quantity, rate, date, available_qty, damage_qty, nil_qty) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [productId, product_code, product_name, category, batch_number, supplier, quantity, rate, date, available_qty, damage_qty, nil_qty]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/batches/:id', async (req, res) => {
  const { id } = req.params;
  const fields = req.body;
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
  const { client_name, client_phone, product_name, category, quantity, rate, total_price, order_date, value_category, batch_no } = req.body;
  try {
    // Start transaction
    await db.query('BEGIN');

    const result = await db.query(
      `INSERT INTO sales 
      (client_name, client_phone, product_name, category, quantity, rate, total_price, order_date, value_category, batch_no) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [client_name, client_phone, product_name, category, quantity, rate, total_price, order_date, value_category, batch_no]
    );
 
    // Automatically update or create client profile
    await db.query(
      'INSERT INTO clients (name, phone, price_category) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET phone = EXCLUDED.phone, price_category = EXCLUDED.price_category',
      [client_name, client_phone, category]
    );

    // Deduct stock across batches
    let bQuery = 'SELECT id, batch_number, available_qty FROM batches WHERE product_name = $1';
    let bParams = [product_name];
    if (batch_no) {
      bQuery += ' AND batch_number = $2';
      bParams.push(batch_no);
    }
    bQuery += ' AND available_qty > 0 ORDER BY date ASC';
    
    const batchesResult = await db.query(bQuery, bParams);
    let remainingToDeduct = quantity;
    let totalDeducted = 0;
    let lastBatchNo = batch_no;

    for (const b of batchesResult.rows) {
      if (remainingToDeduct <= 0) break;
      const canDeduct = Math.min(remainingToDeduct, b.available_qty);
      await db.query('UPDATE batches SET available_qty = available_qty - $1 WHERE id = $2', [canDeduct, b.id]);
      remainingToDeduct -= canDeduct;
      totalDeducted += canDeduct;
      lastBatchNo = b.batch_number;
    }

    const pending_qty = quantity - totalDeducted;
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
  const { order_number, client_name, client_phone, product_name, quantity, total_amount, order_date, status, batch_no, pending_qty, fulfilled_qty } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO orders 
      (order_number, client_name, client_phone, product_name, quantity, total_amount, order_date, status, batch_no, pending_qty, fulfilled_qty) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [order_number, client_name, client_phone, product_name, quantity, total_amount, order_date, status, batch_no, pending_qty || 0, fulfilled_qty || quantity]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const fields = req.body;
  
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

    // Handle stock synchronization
    const productChanged = newProduct !== oldOrder.product_name;
    const batchChanged = newBatch !== oldOrder.batch_no;
    const fulfilledChanged = newFulfilled !== oldOrder.fulfilled_qty;

    if (productChanged || batchChanged || fulfilledChanged) {
      // 1. Revert old stock deduction
      if (oldOrder.fulfilled_qty > 0 && oldOrder.product_name) {
        await db.query(
          'UPDATE batches SET available_qty = available_qty + $1 WHERE product_name = $2 AND batch_number = $3',
          [oldOrder.fulfilled_qty, oldOrder.product_name, oldOrder.batch_no || '0']
        );
      }

      // 2. Apply new stock deduction
      if (newFulfilled > 0 && newProduct) {
        const updateResult = await db.query(
          'UPDATE batches SET available_qty = available_qty - $1 WHERE product_name = $2 AND batch_number = $3',
          [newFulfilled, newProduct, newBatch || '0']
        );

        if (updateResult.rowCount === 0) {
          // Create placeholder batch if it doesn't exist
          const productLookup = await db.query('SELECT category FROM products WHERE name = $1 LIMIT 1', [newProduct]);
          const category = productLookup.rows.length > 0 ? productLookup.rows[0].category : 'Other';
          await db.query(
            'INSERT INTO batches (product_name, category, batch_number, quantity, available_qty, date) VALUES ($1, $2, $3, 0, $4, CURRENT_DATE)',
            [newProduct, category, newBatch || '0', -newFulfilled]
          );
        }
      }
    }

    // Prepare update query
    const updateKeys = Object.keys(fields);
    if (updateKeys.length > 0) {
      const setClause = updateKeys.map((key, i) => `${key} = $${i + 1}`).join(', ');
      const values = Object.values(fields);
      const result = await db.query(`UPDATE orders SET ${setClause} WHERE id = $${values.length + 1} RETURNING *`, [...values, id]);
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
    const result = await db.query('SELECT * FROM challans');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/challans', async (req, res) => {
  const { challan_number, order_number, client_name, client_phone, product_name, quantity, date, batch_no, notes, should_fulfill, skip_stock_update } = req.body;
  try {
    await db.query('BEGIN');
    
    const result = await db.query(
      `INSERT INTO challans 
      (challan_number, order_number, client_name, client_phone, product_name, quantity, date, batch_no, notes) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [challan_number, order_number, client_name, client_phone, product_name, quantity, date, batch_no, notes]
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
      const updateResult = await db.query(
        'UPDATE batches SET available_qty = available_qty - $1 WHERE batch_number = $2 AND product_name = $3',
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

        await db.query(
          'INSERT INTO batches (product_name, category, batch_number, quantity, available_qty, date) VALUES ($1, $2, $3, 0, $4, $5)',
          [product_name, category, batch_no, -quantity, date]
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
  const fields = req.body;
  const setClause = Object.keys(fields).map((key, i) => `${key} = $${i + 1}`).join(', ');
  const values = Object.values(fields);
  try {
    const result = await db.query(`UPDATE challans SET ${setClause} WHERE id = $${values.length + 1} RETURNING *`, [...values, id]);
    res.json(result.rows[0]);
  } catch (err) {
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

