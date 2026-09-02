const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

async function ensureDeliveredAtColumn() {
  try {
    await db.query(
      "ALTER TABLE sales ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP",
    );
  } catch (err) {
    // Ignore legacy table errors
  }
}

ensureDeliveredAtColumn().catch(() => { });

async function ensureChallanCancelColumns() {
  await db.query(
    "ALTER TABLE challans ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN DEFAULT FALSE",
  );
  await db.query(
    "ALTER TABLE challans ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP",
  );
  await db.query(
    "ALTER TABLE challans ADD COLUMN IF NOT EXISTS is_built BOOLEAN DEFAULT FALSE",
  );
  await db.query(
    "ALTER TABLE challans ADD COLUMN IF NOT EXISTS bill_no TEXT",
  );
  await db.query(
    "ALTER TABLE challans ADD COLUMN IF NOT EXISTS restored_qty INTEGER",
  );
  await db.query(
    "ALTER TABLE challans ADD COLUMN IF NOT EXISTS is_challan_generated BOOLEAN DEFAULT FALSE",
  );
}

ensureChallanCancelColumns().catch((err) => {
  console.error("Challan column initialization failed:", err.message);
});

async function ensureSaleDamageColumns() {
  await db.query(
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS damage_qty INTEGER DEFAULT 0",
  );
}

ensureSaleDamageColumns().catch((err) => {
  console.error("Sales damage column initialization failed:", err.message);
});

async function ensureSalesStatusConstraint() {
  try {
    await db.query(
      "ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_status_check",
    );
    await db.query(
      "ALTER TABLE sales ADD CONSTRAINT sales_status_check CHECK (status IN ('Pending', 'Confirmed', 'Partial', 'Delivered', 'Cancelled'))",
    );
  } catch (err) {
    console.error("ensureSalesStatusConstraint failed:", err.message);
  }
}

ensureSalesStatusConstraint().catch((err) => {
  console.error("Sales status constraint initialization failed:", err.message);
});

async function ensureHoldQtyColumn() {
  await db.query("ALTER TABLE holds ADD COLUMN IF NOT EXISTS held_qty INTEGER");
}

ensureHoldQtyColumn().catch((err) => {
  console.error("Holds held_qty column initialization failed:", err.message);
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
  console.error("Sales return table initialization failed:", err.message);
});

async function ensureDisplayQtyAndStockCategory() {
  await db.query(
    "ALTER TABLE batches ADD COLUMN IF NOT EXISTS display_qty INTEGER DEFAULT 0",
  );
  await db.query(
    "ALTER TABLE batches ADD COLUMN IF NOT EXISTS hold_qty INTEGER DEFAULT 0",
  );
  await db.query(
    "ALTER TABLE batches ADD COLUMN IF NOT EXISTS stock_maintain INTEGER DEFAULT 0",
  );
  await db.query(
    "ALTER TABLE batches ADD COLUMN IF NOT EXISTS is_dead_stock BOOLEAN DEFAULT FALSE",
  );
  try {
    await db.query(
      "UPDATE batches SET display_qty = nil_qty WHERE display_qty = 0 AND nil_qty > 0",
    );
  } catch (e) {
    // Ignore if nil_qty doesn't exist
  }
  await db.query(
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS stock_category TEXT DEFAULT 'Available'",
  );
  await db.query(
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS estimated_delivery_date DATE",
  );
  await db.query(
    "ALTER TABLE challans ADD COLUMN IF NOT EXISTS stock_category TEXT DEFAULT 'Available'",
  );
  await db.query(
    "UPDATE batches SET batch_number = '0' WHERE batch_number IS NULL OR batch_number = '' OR TRIM(batch_number) = ''",
  );
  await db.query(
    "UPDATE purchases SET batch_number = '0' WHERE batch_number IS NULL OR batch_number = '' OR TRIM(batch_number) = ''",
  );
  try {
    const allProds = await db.query(
      "SELECT DISTINCT product_name FROM batches",
    );
    for (const p of allProds.rows) {
      if (p.product_name) {
        await resolveNegativeStock(p.product_name);
      }
    }
    await reconcileAllProductStocks();
  } catch (e) {
    console.error("Batch reconciliation failed:", e.message);
  }
}

ensureDisplayQtyAndStockCategory().catch((err) => {
  console.error(
    "Database migration for display_qty / stock_category failed:",
    err.message,
  );
});

// Helper for UUID generation if needed in JS, but DB handles it
const uid = () => require("crypto").randomUUID();
const deliveryTimestampSql = "CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'";

// --- Auth Routes ---
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    const user = result.rows[0];
    if (user && user.password === password) {
      res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Products ---
app.get("/api/products", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM products");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/products", async (req, res) => {
  const { name, category, size, barcode } = req.body;
  try {
    const result = await db.query(
      "INSERT INTO products (name, category, size, barcode) VALUES ($1, $2, $3, $4) RETURNING *",
      [name, category, size, barcode],
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Batches ---
app.get("/api/batches", async (req, res) => {
  try {
    const { page, limit = 50, search, category } = req.query;

    if (!page) {
      const result = await db.query(
        "SELECT * FROM batches ORDER BY date DESC, id DESC",
      );
      return res.json(result.rows);
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 50);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    const values = [];

    if (category && category !== "all") {
      values.push(category);
      conditions.push(`LOWER(category) = LOWER($${values.length})`);
    }

    if (search && search.trim()) {
      const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
      tokens.forEach((token) => {
        values.push(`%${token}%`);
        const idx = values.length;
        conditions.push(
          `(LOWER(COALESCE(product_name, '')) LIKE $${idx} OR LOWER(COALESCE(product_code, '')) LIKE $${idx} OR LOWER(COALESCE(batch_number, '')) LIKE $${idx} OR LOWER(COALESCE(category, '')) LIKE $${idx} OR LOWER(COALESCE(supplier, '')) LIKE $${idx} OR LOWER(COALESCE(description, '')) LIKE $${idx})`
        );
      });
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const overallStatsQuery = await db.query(`
      SELECT 
        COALESCE(SUM(GREATEST(0, quantity - available_qty - COALESCE(display_qty, 0) - COALESCE(damage_qty, 0) - COALESCE(hold_qty, 0))), 0) as total_sales,
        COALESCE(SUM(available_qty), 0) as available_stock,
        COALESCE(SUM(display_qty), 0) as total_display,
        COALESCE(SUM(damage_qty), 0) as total_damage
      FROM batches
    `);
    const statsRow = overallStatsQuery.rows[0] || {};
    const stats = {
      totalSales: Number(statsRow.total_sales || 0),
      availableStock: Number(statsRow.available_stock || 0),
      totalDisplay: Number(statsRow.total_display || 0),
      totalDamage: Number(statsRow.total_damage || 0),
    };

    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM batches ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].total, 10) || 0;
    const totalPages = Math.ceil(total / limitNum) || 1;

    const dataValues = [...values, limitNum, offset];
    const limitIdx = values.length + 1;
    const offsetIdx = values.length + 2;

    const dataResult = await db.query(
      `SELECT * FROM batches ${whereClause} ORDER BY LOWER(product_name) ASC, LOWER(batch_number) ASC, date DESC, id DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      dataValues
    );

    res.json({
      data: dataResult.rows,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages,
      stats,
    });
  } catch (err) {
    console.error("GET /api/batches error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/batches", async (req, res) => {
  const {
    product_id,
    product_code,
    product_name,
    category,
    batch_number,
    supplier,
    quantity,
    rate,
    date,
    available_qty,
    damage_qty,
    display_qty,
    stock_maintain,
    nil_qty,
    description,
  } = req.body;
  const productId = product_id === "" ? null : product_id;
  const displayQty =
    display_qty !== undefined
      ? display_qty
      : nil_qty !== undefined
        ? nil_qty
        : 0;
  const stockMaintain = stock_maintain !== undefined ? Number(stock_maintain) || 0 : 0;
  try {
    const result = await db.query(
      `INSERT INTO batches 
      (product_id, product_code, product_name, category, batch_number, supplier, quantity, rate, date, available_qty, damage_qty, display_qty, stock_maintain, description) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [
        productId,
        product_code,
        product_name,
        category,
        batch_number,
        supplier,
        quantity,
        rate,
        date,
        available_qty,
        damage_qty,
        displayQty,
        stockMaintain,
        description,
      ],
    );

    // Auto-create product entry in products table if not present
    if (product_name && product_name.trim()) {
      await db.query(
        "INSERT INTO products (name, category) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM products WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)))",
        [product_name.trim(), category || ""]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/batches/:id", async (req, res) => {
  const { id } = req.params;
  const fields = { ...req.body };
  if (fields.nil_qty !== undefined) {
    fields.display_qty = fields.nil_qty;
    delete fields.nil_qty;
  }
  const setClause = Object.keys(fields)
    .map((key, i) => `${key} = $${i + 1}`)
    .join(", ");
  const values = Object.values(fields);
  try {
    const result = await db.query(
      `UPDATE batches SET ${setClause} WHERE id = $${values.length + 1} RETURNING *`,
      [...values, id],
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/batches/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM batches WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Purchases ---
app.get("/api/purchases", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM purchases");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/purchases", async (req, res) => {
  const {
    supplier_name,
    supplier_phone,
    product_name,
    category,
    quantity,
    rate,
    total_amount,
    batch_number,
    date,
  } = req.body;
  const finalBatchNumber =
    batch_number && String(batch_number).trim()
      ? String(batch_number).trim()
      : "0";
  try {
    await db.query("BEGIN");

    const result = await db.query(
      `INSERT INTO purchases (supplier_name, supplier_phone, product_name, category, quantity, rate, total_amount, batch_number, date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        supplier_name,
        supplier_phone,
        product_name,
        category,
        quantity,
        rate,
        total_amount,
        finalBatchNumber,
        date,
      ],
    );

    // Upsert stock in batches
    const updateResult = await db.query(
      "UPDATE batches SET available_qty = available_qty + $1, quantity = quantity + $1 WHERE batch_number = $2 AND product_name = $3",
      [quantity, finalBatchNumber, product_name],
    );

    if (updateResult.rowCount === 0) {
      // Create new batch if it doesn't exist
      await db.query(
        `INSERT INTO batches 
        (product_name, category, batch_number, supplier, quantity, available_qty, date) 
        VALUES ($1, $2, $3, $4, $5, $5, $6)`,
        [
          product_name,
          category,
          finalBatchNumber,
          supplier_name,
          quantity,
          date,
        ],
      );
    }

    // Resolve any negative stock across batches of this product
    await resolveNegativeStock(product_name);

    await db.query("COMMIT");
    res.json(result.rows[0]);
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/purchases/:id", async (req, res) => {
  const { id } = req.params;
  const fields = req.body;
  try {
    await db.query("BEGIN");

    const purchaseRes = await db.query(
      "SELECT * FROM purchases WHERE id = $1",
      [id],
    );
    if (purchaseRes.rows.length === 0) {
      await db.query("ROLLBACK");
      return res.status(404).json({ error: "Purchase not found" });
    }
    const oldPurchase = purchaseRes.rows[0];

    const newProduct =
      fields.product_name !== undefined
        ? fields.product_name
        : oldPurchase.product_name;
    const newBatch =
      fields.batch_number !== undefined
        ? fields.batch_number
        : oldPurchase.batch_number;
    const newQty =
      fields.quantity !== undefined
        ? Number(fields.quantity)
        : Number(oldPurchase.quantity);
    const newCategory =
      fields.category !== undefined ? fields.category : oldPurchase.category;
    const newSupplier =
      fields.supplier_name !== undefined
        ? fields.supplier_name
        : oldPurchase.supplier_name;
    const newDate = fields.date !== undefined ? fields.date : oldPurchase.date;

    const productChanged = newProduct !== oldPurchase.product_name;
    const batchChanged = newBatch !== oldPurchase.batch_number;
    const qtyChanged = newQty !== Number(oldPurchase.quantity);
    const categoryChanged = newCategory !== oldPurchase.category;
    const supplierChanged = newSupplier !== oldPurchase.supplier_name;
    const dateChanged = newDate !== oldPurchase.date;

    if (
      productChanged ||
      batchChanged ||
      qtyChanged ||
      categoryChanged ||
      supplierChanged ||
      dateChanged
    ) {
      // 1. Revert old stock addition
      if (oldPurchase.batch_number && oldPurchase.product_name) {
        await db.query(
          "UPDATE batches SET available_qty = available_qty - $1, quantity = quantity - $1 WHERE batch_number = $2 AND product_name = $3",
          [
            oldPurchase.quantity,
            oldPurchase.batch_number,
            oldPurchase.product_name,
          ],
        );
      }

      // 2. Apply new stock addition
      if (newBatch && newProduct) {
        const updateResult = await db.query(
          "UPDATE batches SET available_qty = available_qty + $1, quantity = quantity + $1 WHERE batch_number = $2 AND product_name = $3",
          [newQty, newBatch, newProduct],
        );

        if (updateResult.rowCount === 0) {
          await db.query(
            `INSERT INTO batches 
            (product_name, category, batch_number, supplier, quantity, available_qty, date) 
            VALUES ($1, $2, $3, $4, $5, $5, $6)`,
            [newProduct, newCategory, newBatch, newSupplier, newQty, newDate],
          );
        }
      }
    }

    const setClause = Object.keys(fields)
      .map((key, i) => `${key} = $${i + 1}`)
      .join(", ");
    const values = Object.values(fields);
    const result = await db.query(
      `UPDATE purchases SET ${setClause} WHERE id = $${values.length + 1} RETURNING *`,
      [...values, id],
    );

    // Resolve any negative stock across batches of this product
    await resolveNegativeStock(newProduct);

    await db.query("COMMIT");
    res.json(result.rows[0]);
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/purchases/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("BEGIN");
    const purchaseRes = await db.query(
      "SELECT * FROM purchases WHERE id = $1",
      [id],
    );
    if (purchaseRes.rows.length > 0) {
      const p = purchaseRes.rows[0];
      if (p.batch_number && p.product_name) {
        await db.query(
          "UPDATE batches SET available_qty = available_qty - $1, quantity = quantity - $1 WHERE batch_number = $2 AND product_name = $3",
          [p.quantity, p.batch_number, p.product_name],
        );
      }
      await db.query("DELETE FROM purchases WHERE id = $1", [id]);
    }
    await db.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

// --- Helper for Challan Numbering ---
async function getNextChallanNumber(prefix) {
  const result = await db.query(
    `SELECT challan_no FROM challans WHERE challan_no LIKE $1`,
    [`${prefix}%`],
  );
  let maxNum = 0;
  for (const row of result.rows) {
    const parts = row.challan_no.split("-");
    if (parts.length === 2) {
      const num = parseInt(parts[1], 10);
      if (!isNaN(num)) {
        maxNum = Math.max(maxNum, num);
      }
    }
  }
  const nextNum = maxNum + 1;
  return `${prefix}${String(nextNum).padStart(4, "0")}`;
}

// --- Helpers for Stock Deduction and Restoration ---
async function deductStock(
  productName,
  batchNo,
  quantityToDeduct,
  stockCategory,
) {
  const qty = Number(quantityToDeduct || 0);
  const cleanProduct = (productName || "").trim();
  const cleanBatch = (batchNo || "0").trim();
  if (qty <= 0 || !cleanProduct) return cleanBatch || "0";

  let updateCol = "available_qty";
  if (stockCategory === "Damage") updateCol = "damage_qty";
  else if (stockCategory === "Display") updateCol = "display_qty";

  // 1. Try to find batches matching product (and batch if specified and not '0')
  let bQuery = `SELECT id, batch_number, "${updateCol}" FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))`;
  let bParams = [cleanProduct];
  if (cleanBatch && cleanBatch !== "0") {
    bQuery += " AND LOWER(TRIM(batch_number)) = LOWER(TRIM($2))";
    bParams.push(cleanBatch);
  }
  bQuery += " ORDER BY date ASC";

  let batchesResult = await db.query(bQuery, bParams);

  // If specific batch requested has no rows, create/find the batch record for that specific batch
  if (batchesResult.rows.length === 0 && cleanBatch && cleanBatch !== "0") {
    const productLookup = await db.query(
      "SELECT category FROM products WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1",
      [cleanProduct],
    );
    const category =
      productLookup.rows.length > 0 ? productLookup.rows[0].category : "Other";
    const insRes = await db.query(
      `INSERT INTO batches (product_name, category, batch_number, quantity, "${updateCol}", date) VALUES ($1, $2, $3, 0, 0, CURRENT_DATE) RETURNING id, batch_number, "${updateCol}"`,
      [cleanProduct, category, cleanBatch],
    );
    batchesResult = insRes;
  }

  let remainingToSell = qty;
  let lastBatchNo = cleanBatch;

  for (const b of batchesResult.rows) {
    if (remainingToSell <= 0) break;
    const availableInBatch = Number(b[updateCol] || 0);
    const canDeduct = Math.min(remainingToSell, availableInBatch);
    if (canDeduct > 0) {
      await db.query(
        `UPDATE batches SET "${updateCol}" = "${updateCol}" - $1 WHERE id = $2`,
        [canDeduct, b.id],
      );
      remainingToSell -= canDeduct;
    }
    lastBatchNo = b.batch_number;
  }

  // If remaining > 0, deduct from the specific/first matching batch
  if (remainingToSell > 0) {
    const existingBatch = batchesResult.rows[0];

    if (existingBatch) {
      await db.query(
        `UPDATE batches SET "${updateCol}" = "${updateCol}" - $1 WHERE id = $2`,
        [remainingToSell, existingBatch.id],
      );
      lastBatchNo = existingBatch.batch_number;
    } else {
      const productLookup = await db.query(
        "SELECT category FROM products WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1",
        [cleanProduct],
      );
      const category =
        productLookup.rows.length > 0
          ? productLookup.rows[0].category
          : "Other";
      let insertCols = "product_name, category, batch_number, quantity, date";
      let insertVals = "$1, $2, $3, 0, CURRENT_DATE";
      const params = [cleanProduct, category, cleanBatch || "0"];
      if (stockCategory === "Display") {
        insertCols += ", display_qty";
        insertVals += ", -" + remainingToSell;
      } else if (stockCategory === "Damage") {
        insertCols += ", damage_qty";
        insertVals += ", -" + remainingToSell;
      } else {
        insertCols += ", available_qty";
        insertVals += ", -" + remainingToSell;
      }
      await db.query(
        `INSERT INTO batches (${insertCols}) VALUES (${insertVals})`,
        params,
      );
    }
  }

  return lastBatchNo || cleanBatch || "0";
}

async function restoreStock(
  productName,
  batchNo,
  quantityToRestore,
  stockCategory,
) {
  const qty = Number(quantityToRestore || 0);
  const cleanProduct = (productName || "").trim();
  const cleanBatch = (batchNo || "0").trim();
  if (qty <= 0 || !cleanProduct) return;

  let updateCol = "available_qty";
  if (stockCategory === "Damage") updateCol = "damage_qty";
  else if (stockCategory === "Display") updateCol = "display_qty";

  // Find if the batch exists
  let checkBatch = await db.query(
    `SELECT id, quantity FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1)) AND LOWER(TRIM(batch_number)) = LOWER(TRIM($2))`,
    [cleanProduct, cleanBatch],
  );

  if (checkBatch.rows.length === 0) {
    checkBatch = await db.query(
      `SELECT id, quantity FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1)) ORDER BY date ASC LIMIT 1`,
      [cleanProduct],
    );
  }

  if (checkBatch.rows.length > 0) {
    await db.query(
      `UPDATE batches SET "${updateCol}" = CASE WHEN quantity > 0 THEN LEAST(quantity, "${updateCol}" + $1) ELSE "${updateCol}" + $1 END WHERE id = $2`,
      [qty, checkBatch.rows[0].id],
    );
    await resolveNegativeStock(cleanProduct);
  } else {
    const productLookup = await db.query(
      "SELECT category FROM products WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1",
      [cleanProduct],
    );
    const category =
      productLookup.rows.length > 0 ? productLookup.rows[0].category : "Other";
    await db.query(
      `INSERT INTO batches (product_name, category, batch_number, quantity, "${updateCol}", date) VALUES ($1, $2, $3, 0, $4, CURRENT_DATE)`,
      [cleanProduct, category, cleanBatch || "0", qty],
    );
  }
}

async function resolveNegativeStock(productName) {
  const cleanProduct = (productName || "").trim();
  if (!cleanProduct) return;
  const cols = ["available_qty", "display_qty", "damage_qty"];

  for (const col of cols) {
    const negativeBatches = await db.query(
      `SELECT id, batch_number, "${col}" FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1)) AND "${col}" < 0 ORDER BY date ASC`,
      [cleanProduct],
    );

    if (negativeBatches.rows.length === 0) continue;

    for (const negBatch of negativeBatches.rows) {
      let needed = Math.abs(Number(negBatch[col]));
      if (needed <= 0) continue;

      const cleanBNo = (negBatch.batch_number || "0").trim();
      let posQuery = `SELECT id, "${col}" FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1)) AND "${col}" > 0 AND id != $2`;
      let posParams = [cleanProduct, negBatch.id];

      if (cleanBNo && cleanBNo !== "0") {
        posQuery += ` AND LOWER(TRIM(batch_number)) = LOWER(TRIM($3))`;
        posParams.push(cleanBNo);
      }
      posQuery += ` ORDER BY date ASC`;

      const positiveBatches = await db.query(posQuery, posParams);

      for (const posBatch of positiveBatches.rows) {
        if (needed <= 0) break;
        const available = Number(posBatch[col]);
        const transfer = Math.min(needed, available);

        if (transfer > 0) {
          await db.query(
            `UPDATE batches SET "${col}" = "${col}" - $1 WHERE id = $2`,
            [transfer, posBatch.id],
          );
          await db.query(
            `UPDATE batches SET "${col}" = "${col}" + $1 WHERE id = $2`,
            [transfer, negBatch.id],
          );
          needed -= transfer;
        }
      }
    }
  }

  // Preserve 0-quantity batches in DB so zero-stock products can be searched and displayed
}

async function reconcileAllProductStocks(productName) {
  try {
    let pQuery =
      "SELECT id, product_name, batch_number, quantity, display_qty, damage_qty, hold_qty FROM batches";
    let pParams = [];
    if (productName && productName.trim()) {
      pQuery += " WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))";
      pParams.push(productName.trim());
    }
    const allBatches = await db.query(pQuery, pParams);

    for (const b of allBatches.rows) {
      const prod = b.product_name;
      const bNo = b.batch_number || "0";
      const initialQty = Number(b.quantity || 0);

      // Sum all active (non-cancelled) challan quantities for this product
      const activeChallansRes = await db.query(
        `SELECT COALESCE(SUM(quantity), 0) AS total_deducted
         FROM challans
         WHERE LOWER(TRIM(product)) = LOWER(TRIM($1))
           AND (LOWER(TRIM(batch_no)) = LOWER(TRIM($2)) OR $2 = '0' OR $2 = '' OR batch_no IS NULL OR TRIM(batch_no) = '0')
           AND is_cancelled = FALSE`,
        [prod, bNo],
      );

      const totalDeducted = Number(
        activeChallansRes.rows[0].total_deducted || 0,
      );

      // Sum all sales return quantities for this product & batch
      const activeReturnsRes = await db.query(
        `SELECT COALESCE(SUM(quantity), 0) AS total_returned
         FROM sales_returns
         WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))
           AND (LOWER(TRIM(batch_no)) = LOWER(TRIM($2)) OR $2 = '0' OR $2 = '' OR batch_no IS NULL OR TRIM(batch_no) = '0')`,
        [prod, bNo],
      );

      const totalReturned = Number(
        activeReturnsRes.rows[0].total_returned || 0,
      );

      const dispQty = Number(b.display_qty || 0);
      const dmgQty = Number(b.damage_qty || 0);
      const hldQty = Number(b.hold_qty || 0);

      const newAvail = initialQty - totalDeducted + totalReturned - dispQty - dmgQty - hldQty;

      await db.query("UPDATE batches SET available_qty = $1 WHERE id = $2", [
        newAvail,
        b.id,
      ]);
    }

    // Preserve 0-quantity batches in DB so zero-stock products can be searched and displayed
  } catch (err) {
    console.error("Error in reconcileAllProductStocks:", err.message);
  }
}

// --- Sales ---

app.get("/api/sales", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM sales ORDER BY order_date DESC, created_at DESC",
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/sales/bulk", async (req, res) => {
  const {
    customer,
    clientPhone,
    orderDate,
    status,
    remarks,
    category,
    items = [],
  } = req.body;

  const finalCustomer = customer ? customer.trim() : "";
  const finalClientPhone = clientPhone ? clientPhone.trim() : "";
  const finalOrderDate = orderDate || new Date().toISOString().split("T")[0];
  const finalRemarks = remarks || "";
  const finalStatus = status || "Pending";

  try {
    await db.query("BEGIN");

    // 1. Automatically update or create client profile
    await db.query(
      "INSERT INTO clients (name, phone, price_category) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET phone = EXCLUDED.phone, price_category = EXCLUDED.price_category",
      [finalCustomer, finalClientPhone, category || "Regular"],
    );

    const orderNum = `ORD-${Date.now().toString(36).toUpperCase()}`;

    let challanNum = null;
    let pChallanNum = null;

    let hasCH = false;
    let hasP = false;

    const itemDetails = [];

    for (const item of items) {
      const finalProduct = item.productName;
      const finalBatchNo = item.batchNo;
      const finalOrderedQty = Number(item.quantity || 0);
      const finalStockCategory = item.stockCategory || "Available";

      let bQuery =
        "SELECT id, batch_number, available_qty, display_qty, damage_qty FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))";
      let bParams = [finalProduct];
      if (finalBatchNo && finalBatchNo !== "0") {
        bQuery += " AND LOWER(TRIM(batch_number)) = LOWER(TRIM($2))";
        bParams.push(finalBatchNo);
      }
      bQuery += " ORDER BY date ASC";

      const batchesResult = await db.query(bQuery, bParams);

      let updateCol = "available_qty";
      if (finalStockCategory === "Damage") updateCol = "damage_qty";
      else if (finalStockCategory === "Display") updateCol = "display_qty";

      const totalAvailable = batchesResult.rows.reduce(
        (sum, b) => sum + Number(b[updateCol] || 0),
        0,
      );
      const fulfillableQty = Math.min(
        finalOrderedQty,
        Math.max(0, totalAvailable),
      );
      const pendingRemaining = finalOrderedQty - fulfillableQty;

      let lastBatchNo = finalBatchNo;
      if (batchesResult.rows.length > 0) {
        lastBatchNo = batchesResult.rows[0].batch_number;
      }

      if (fulfillableQty > 0) hasCH = true;
      if (pendingRemaining > 0) hasP = true;

      itemDetails.push({
        item,
        fulfillableQty,
        pendingRemaining,
        lastBatchNo,
      });
    }

    if (hasCH) {
      challanNum = await getNextChallanNumber("CH-");
    }
    if (hasP) {
      pChallanNum = await getNextChallanNumber("P-");
    }

    const createdSales = [];

    for (const details of itemDetails) {
      const { item, fulfillableQty, pendingRemaining, lastBatchNo } = details;
      const finalProduct = item.productName;
      const finalBatchNo = item.batchNo;
      const finalOrderedQty = Number(item.quantity || 0);
      const finalStockCategory = item.stockCategory || "Available";
      const finalDamageQty = item.damageQty || 0;

      const finalRate = Number(item.rate || 0);
      const finalGST = Number(item.GST || 0);
      const totalPrice = finalOrderedQty * finalRate;

      // Deduct stock immediately
      const actualBatchNo = await deductStock(
        finalProduct,
        finalBatchNo || "0",
        finalOrderedQty,
        finalStockCategory,
      );

      const saleInsertResult = await db.query(
        `INSERT INTO sales 
        (order_no, customer, client_phone, product, category, ordered_qty, delivered_qty, pending_qty, rate, "GST", total_price, order_date, value_category, batch_no, remarks, status, stock_category, damage_qty, created_at, updated_at) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Standard', $13, $14, $15, $16, $17, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
        [
          orderNum,
          finalCustomer,
          finalClientPhone,
          finalProduct,
          category || "Regular",
          finalOrderedQty,
          0,
          finalOrderedQty,
          finalRate,
          finalGST,
          totalPrice,
          finalOrderDate,
          actualBatchNo,
          finalRemarks,
          finalStatus,
          finalStockCategory,
          finalDamageQty,
        ],
      );

      const createdSale = saleInsertResult.rows[0];
      createdSales.push(createdSale);

      if (fulfillableQty > 0 && challanNum) {
        await db.query(
          `INSERT INTO challans 
          (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', CURRENT_DATE, $8, $9, FALSE, FALSE, FALSE)`,
          [
            challanNum,
            createdSale.id,
            finalCustomer,
            finalClientPhone,
            finalProduct,
            actualBatchNo,
            fulfillableQty,
            finalRemarks,
            finalStockCategory,
          ],
        );
      }

      if (pendingRemaining > 0 && pChallanNum) {
        await db.query(
          `INSERT INTO challans 
          (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', CURRENT_DATE, $8, $9, FALSE, FALSE, FALSE)`,
          [
            pChallanNum,
            createdSale.id,
            finalCustomer,
            finalClientPhone,
            finalProduct,
            actualBatchNo,
            pendingRemaining,
            finalRemarks,
            finalStockCategory,
          ],
        );
      }
    }

    await db.query("COMMIT");
    res.json(createdSales);
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/sales", async (req, res) => {
  const {
    customer,
    client_name,
    client_phone,
    clientPhone,
    product,
    product_name,
    category,
    ordered_qty,
    quantity,
    remarks,
    narration,
    value_category,
    valueCategory,
    batch_no,
    batchNo,
    stock_category = "Available",
    damage_qty,
    damageQty,
    order_date,
    status,
  } = req.body;

  const finalCustomer = customer || client_name;
  const finalClientPhone = client_phone || clientPhone;
  const finalProduct = product || product_name;
  const finalOrderedQty = Number(
    ordered_qty !== undefined ? ordered_qty : quantity || 0,
  );
  const finalRate = 0;
  const finalGST = 0;
  const finalRemarks = remarks !== undefined ? remarks : narration;
  const finalValueCategory = value_category || valueCategory || "Standard";
  const finalBatchNo = batch_no || batchNo;
  const finalStockCategory = stock_category;
  const finalDamageQty = Number(
    damage_qty !== undefined ? damage_qty : damageQty || 0,
  );
  const finalOrderDate = order_date || new Date().toISOString().slice(0, 10);

  try {
    await db.query("BEGIN");

    // 1. Automatically update or create client profile
    await db.query(
      "INSERT INTO clients (name, phone, price_category) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET phone = EXCLUDED.phone, price_category = EXCLUDED.price_category",
      [finalCustomer, finalClientPhone, category || "Regular"],
    );

    // 2. Check available stock to decide CH- vs P- prefix (NO deduction at sale creation)
    let bQuery =
      "SELECT id, batch_number, available_qty, display_qty, damage_qty FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))";
    let bParams = [finalProduct];
    if (finalBatchNo && finalBatchNo !== "0") {
      bQuery += " AND LOWER(TRIM(batch_number)) = LOWER(TRIM($2))";
      bParams.push(finalBatchNo);
    }
    bQuery += " ORDER BY date ASC";

    const batchesResult = await db.query(bQuery, bParams);

    let updateCol = "available_qty";
    if (finalStockCategory === "Damage") updateCol = "damage_qty";
    else if (finalStockCategory === "Display") updateCol = "display_qty";

    const totalAvailable = batchesResult.rows.reduce(
      (sum, b) => sum + Number(b[updateCol] || 0),
      0,
    );
    const fulfillableQty = Math.min(
      finalOrderedQty,
      Math.max(0, totalAvailable),
    );
    const pendingRemaining = finalOrderedQty - fulfillableQty;

    // Determine last batch no for reference
    let lastBatchNo = finalBatchNo;
    if (batchesResult.rows.length > 0) {
      lastBatchNo = batchesResult.rows[0].batch_number;
    }

    const pendingQty = finalOrderedQty; // always full qty pending until delivered
    const deliveredQty = 0; // never deduct at creation
    const finalStatus = "Confirmed";

    const orderNum = `ORD-${Date.now().toString(36).toUpperCase()}`;
    const totalPrice = finalOrderedQty * finalRate;

    // Deduct stock immediately
    const actualBatchNo = await deductStock(
      finalProduct,
      finalBatchNo || "0",
      finalOrderedQty,
      finalStockCategory,
    );

    // 3. Insert Sales record
    const result = await db.query(
      `INSERT INTO sales 
      (order_no, customer, client_phone, product, category, ordered_qty, delivered_qty, pending_qty, rate, "GST", total_price, order_date, value_category, batch_no, remarks, status, stock_category, damage_qty, created_at, updated_at) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
      [
        orderNum,
        finalCustomer,
        finalClientPhone,
        finalProduct,
        category || "Regular",
        finalOrderedQty,
        deliveredQty,
        pendingQty,
        finalRate,
        finalGST,
        totalPrice,
        finalOrderDate,
        finalValueCategory,
        actualBatchNo,
        finalRemarks,
        finalStatus,
        finalStockCategory,
        finalDamageQty,
      ],
    );

    const createdSale = result.rows[0];

    // 4. Create challan(s) based on stock availability
    //    - fulfillableQty > 0 → CH-xxxx (visible in ChallanPage, ready to confirm+deliver)
    //    - pendingRemaining > 0 → P-xxxx  (visible in PendingDeliveries, needs stock before delivery)
    if (fulfillableQty > 0) {
      const challanNum = await getNextChallanNumber("CH-");
      await db.query(
        `INSERT INTO challans 
        (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'Confirmed', CURRENT_DATE, $8, $9, FALSE, FALSE, FALSE)`,
        [
          challanNum,
          createdSale.id,
          finalCustomer,
          finalClientPhone,
          finalProduct,
          actualBatchNo,
          fulfillableQty,
          finalRemarks || "",
          finalStockCategory,
        ],
      );
    }

    if (pendingRemaining > 0) {
      const pChallanNum = await getNextChallanNumber("P-");
      await db.query(
        `INSERT INTO challans 
        (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', CURRENT_DATE, $8, $9, FALSE, FALSE, FALSE)`,
        [
          pChallanNum,
          createdSale.id,
          finalCustomer,
          finalClientPhone,
          finalProduct,
          actualBatchNo,
          pendingRemaining,
          finalRemarks || "",
          finalStockCategory,
        ],
      );
    }

    await db.query("COMMIT");
    res.json(createdSale);
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/sales/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("BEGIN");

    // Get existing sale record
    const saleRes = await db.query("SELECT * FROM sales WHERE id = $1", [id]);
    if (saleRes.rows.length === 0) {
      await db.query("ROLLBACK");
      return res.status(404).json({ error: "Sale record not found" });
    }
    const sale = saleRes.rows[0];
    const deliveredQty = Number(sale.delivered_qty || 0);

    const updates = {};

    const newQtyFromBody =
      req.body.ordered_qty !== undefined
        ? Number(req.body.ordered_qty)
        : req.body.quantity !== undefined
          ? Number(req.body.quantity)
          : null;

    // Delivered State: lock customer, product. Allow quantity INCREASE only.
    if (deliveredQty >= Number(sale.ordered_qty)) {
      const isTryingToEditLocked =
        (req.body.customer !== undefined &&
          req.body.customer !== sale.customer) ||
        (req.body.clientName !== undefined &&
          req.body.clientName !== sale.customer) ||
        (req.body.product !== undefined && req.body.product !== sale.product) ||
        (req.body.productName !== undefined &&
          req.body.productName !== sale.product) ||
        // Allow increasing qty but not decreasing below deliveredQty
        (newQtyFromBody !== null && newQtyFromBody < deliveredQty);

      if (isTryingToEditLocked) {
        await db.query("ROLLBACK");
        return res
          .status(400)
          .json({
            error:
              "Cannot edit product or customer on a fully delivered sale, and cannot reduce quantity below delivered amount.",
          });
      }

      // Handle quantity increase on a fully-delivered order
      if (newQtyFromBody !== null && newQtyFromBody > Number(sale.ordered_qty)) {
        const extraQty = newQtyFromBody - Number(sale.ordered_qty);
        await deductStock(
          sale.product,
          sale.batch_no,
          extraQty,
          sale.stock_category,
        );
        updates.ordered_qty = newQtyFromBody;
        updates.pending_qty = newQtyFromBody - deliveredQty;
        updates.status = "Partial";

        // Create a P-draft challan for the extra pending quantity
        const pChallanNum = await getNextChallanNumber("P-");
        await db.query(
          `INSERT INTO challans 
          (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', CURRENT_DATE, $8, $9, FALSE, FALSE, FALSE)`,
          [
            pChallanNum,
            id,
            sale.customer,
            sale.client_phone,
            sale.product,
            sale.batch_no,
            newQtyFromBody - deliveredQty,
            sale.remarks || "",
            sale.stock_category,
          ],
        );
      }
    }

    // Partial State: lock customer, product. Allow qty adjustments only if newQty >= deliveredQty.
    if (deliveredQty > 0 && deliveredQty < Number(sale.ordered_qty)) {
      const isTryingToEditLocked =
        (req.body.customer !== undefined &&
          req.body.customer !== sale.customer) ||
        (req.body.clientName !== undefined &&
          req.body.clientName !== sale.customer) ||
        (req.body.product !== undefined && req.body.product !== sale.product) ||
        (req.body.productName !== undefined &&
          req.body.productName !== sale.product);

      if (isTryingToEditLocked) {
        await db.query("ROLLBACK");
        return res
          .status(400)
          .json({
            error:
              "Cannot edit customer or product on a partially delivered sale.",
          });
      }

      const newQty = newQtyFromBody;
      if (newQty !== null) {
        if (newQty < deliveredQty) {
          await db.query("ROLLBACK");
          return res
            .status(400)
            .json({
              error: `Quantity cannot be reduced below the delivered quantity (${deliveredQty}).`,
            });
        }

        const oldQty = Number(sale.ordered_qty);
        const diff = newQty - oldQty;
        if (diff > 0) {
          await deductStock(
            sale.product,
            sale.batch_no,
            diff,
            sale.stock_category,
          );
        } else if (diff < 0) {
          await restoreStock(
            sale.product,
            sale.batch_no,
            Math.abs(diff),
            sale.stock_category,
          );
        }

        updates.ordered_qty = newQty;
        updates.pending_qty = newQty - deliveredQty;
        updates.status = newQty === deliveredQty ? "Delivered" : "Partial";

        // Sync pending challans
        const newPending = newQty - deliveredQty;
        const pChallanRes = await db.query(
          "SELECT * FROM challans WHERE sales_id = $1 AND challan_no LIKE 'P-%' AND is_cancelled = FALSE AND status = 'Pending' LIMIT 1",
          [id],
        );
        if (pChallanRes.rows.length > 0) {
          const pChallan = pChallanRes.rows[0];
          if (newPending > 0) {
            await db.query("UPDATE challans SET quantity = $1 WHERE id = $2", [
              newPending,
              pChallan.id,
            ]);
          } else {
            await db.query("DELETE FROM challans WHERE id = $1", [pChallan.id]);
          }
        } else if (newPending > 0) {
          const pChallanNum = await getNextChallanNumber("P-");
          await db.query(
            `INSERT INTO challans 
            (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', CURRENT_DATE, $8, $9, FALSE, FALSE, FALSE)`,
            [
              pChallanNum,
              id,
              sale.customer,
              sale.client_phone,
              sale.product,
              sale.batch_no,
              newPending,
              sale.remarks || "",
              sale.stock_category,
            ],
          );
        }
      }
    }

    // Pending State (delivered_qty === 0): allow all edits
    let isInventoryChanged = false;
    if (deliveredQty === 0) {
      const newQty =
        req.body.ordered_qty !== undefined
          ? Number(req.body.ordered_qty)
          : req.body.quantity !== undefined
            ? Number(req.body.quantity)
            : null;
      const newProduct =
        req.body.product !== undefined
          ? req.body.product
          : req.body.productName !== undefined
            ? req.body.productName
            : null;
      const newBatchNo =
        req.body.batch_no !== undefined
          ? req.body.batch_no
          : req.body.batchNo !== undefined
            ? req.body.batchNo
            : null;
      const newStockCategory =
        req.body.stock_category !== undefined
          ? req.body.stock_category
          : req.body.stockCategory !== undefined
            ? req.body.stockCategory
            : null;

      if (
        (newQty !== null && newQty !== Number(sale.ordered_qty)) ||
        (newProduct !== null && newProduct !== sale.product) ||
        (newBatchNo !== null && newBatchNo !== sale.batch_no) ||
        (newStockCategory !== null && newStockCategory !== sale.stock_category)
      ) {
        isInventoryChanged = true;
      }

      if (newQty !== null) {
        updates.ordered_qty = newQty;
        updates.pending_qty = newQty;
        if (sale.status === "Confirmed" || sale.status === "Delivered" || sale.status === "Partial") {
          updates.status = sale.status;
        } else {
          updates.status = "Pending";
        }
      }

      const newCustomer =
        req.body.customer !== undefined
          ? req.body.customer
          : req.body.clientName;
      if (newCustomer !== undefined) updates.customer = newCustomer;

      if (newProduct !== null) updates.product = newProduct;

      if (isInventoryChanged) {
        const finalQty =
          updates.ordered_qty !== undefined
            ? updates.ordered_qty
            : Number(sale.ordered_qty);
        const finalProd =
          updates.product !== undefined ? updates.product : sale.product;
        const finalBatch =
          req.body.batch_no !== undefined
            ? req.body.batch_no
            : req.body.batchNo !== undefined
              ? req.body.batchNo
              : sale.batch_no;
        const finalStockCat =
          req.body.stock_category !== undefined
            ? req.body.stock_category
            : req.body.stockCategory !== undefined
              ? req.body.stockCategory
              : sale.stock_category;

        // 1. Revert old stock deduction
        await restoreStock(
          sale.product,
          sale.batch_no,
          sale.ordered_qty,
          sale.stock_category,
        );

        // 2. Deduct new stock
        const actualBatchNo = await deductStock(
          finalProd,
          finalBatch || "0",
          finalQty,
          finalStockCat,
        );
        updates.batch_no = actualBatchNo;

        // 3. Sync and distribute quantity accurately across active challans for this sale item
        const finalCustomer =
          updates.customer !== undefined ? updates.customer : sale.customer;
        const finalClientPhone =
          req.body.client_phone !== undefined
            ? req.body.client_phone
            : req.body.clientPhone !== undefined
              ? req.body.clientPhone
              : sale.client_phone;
        const finalRemarks =
          req.body.remarks !== undefined
            ? req.body.remarks
            : req.body.narration !== undefined
              ? req.body.narration
              : sale.remarks;

        const activeChallans = await db.query(
          "SELECT * FROM challans WHERE sales_id = $1 AND is_cancelled = FALSE ORDER BY created_at ASC",
          [id],
        );

        if (activeChallans.rows.length > 0) {
          const chChallans = activeChallans.rows.filter(
            (c) =>
              c.challan_no.startsWith("CH-") ||
              c.challan_no.startsWith("CH") ||
              c.status === "Confirmed",
          );
          const pDraftChallans = activeChallans.rows.filter(
            (c) => c.challan_no.startsWith("P-") && c.status === "Pending",
          );

          let remainingQty = finalQty;

          // 1. Allocate quantity to main delivery / confirmed challans first
          for (const ch of chChallans) {
            const allocatedQty = Math.min(
              remainingQty,
              Number(ch.quantity || 0) || finalQty,
            );
            remainingQty = Math.max(0, remainingQty - allocatedQty);

            await db.query(
              `UPDATE challans 
               SET customer = $1, client_phone = $2, product = $3, batch_no = $4, quantity = $5, stock_category = $6, notes = $7 
               WHERE id = $8`,
              [
                finalCustomer,
                finalClientPhone,
                finalProd,
                actualBatchNo,
                allocatedQty,
                finalStockCat,
                finalRemarks || "",
                ch.id,
              ],
            );
          }

          // 2. Assign remaining unhandled pending quantity to draft P- challan
          if (pDraftChallans.length > 0) {
            for (const pCh of pDraftChallans) {
              if (remainingQty > 0) {
                await db.query(
                  `UPDATE challans 
                   SET customer = $1, client_phone = $2, product = $3, batch_no = $4, quantity = $5, stock_category = $6, notes = $7 
                   WHERE id = $8`,
                  [
                    finalCustomer,
                    finalClientPhone,
                    finalProd,
                    actualBatchNo,
                    remainingQty,
                    finalStockCat,
                    finalRemarks || "",
                    pCh.id,
                  ],
                );
                remainingQty = 0;
              } else {
                // Remove redundant/exhausted pending draft challan when order is already fully covered by delivery challan
                await db.query("DELETE FROM challans WHERE id = $1", [pCh.id]);
              }
            }
          } else if (remainingQty > 0) {
            // No P-draft exists yet but there is extra qty (e.g. user increased ordered qty above CH fulfilled qty)
            // Create a new P-draft challan for the extra unhandled pending quantity
            const pChallanNum = await getNextChallanNumber("P-");
            await db.query(
              `INSERT INTO challans 
              (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled) 
              VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', CURRENT_DATE, $8, $9, FALSE, FALSE, FALSE)`,
              [
                pChallanNum,
                id,
                finalCustomer,
                finalClientPhone,
                finalProd,
                actualBatchNo,
                remainingQty,
                finalRemarks || "",
                finalStockCat,
              ],
            );
            // Update pending_qty on the sale to reflect the extra unhandled qty
            updates.pending_qty = remainingQty;
          }
        }
      }
    }

    // Fields editable in all states (except fully locked Delivered if they affect price/qty, but here they are safety checked)
    const finalCustomerPhone =
      req.body.client_phone !== undefined
        ? req.body.client_phone
        : req.body.clientPhone;
    if (finalCustomerPhone !== undefined)
      updates.client_phone = finalCustomerPhone;

    const finalRemarks =
      req.body.remarks !== undefined ? req.body.remarks : req.body.narration;
    if (finalRemarks !== undefined) updates.remarks = finalRemarks;

    if (req.body.category !== undefined) updates.category = req.body.category;
    if (
      req.body.stock_category !== undefined ||
      req.body.stockCategory !== undefined
    ) {
      const newStockCategory =
        req.body.stock_category !== undefined
          ? req.body.stock_category
          : req.body.stockCategory;
      if (deliveredQty > 0 || !isInventoryChanged) {
        updates.stock_category = newStockCategory;
      }
    }
    if (req.body.damage_qty !== undefined || req.body.damageQty !== undefined) {
      updates.damage_qty =
        req.body.damage_qty !== undefined
          ? req.body.damage_qty
          : req.body.damageQty;
    }
    if (req.body.batch_no !== undefined || req.body.batchNo !== undefined) {
      const newBatchNo =
        req.body.batch_no !== undefined ? req.body.batch_no : req.body.batchNo;
      if (deliveredQty > 0 || !isInventoryChanged) {
        updates.batch_no = newBatchNo;
      }
    }
    if (req.body.status !== undefined) {
      const activeChallanRes = await db.query(
        "SELECT status FROM challans WHERE sales_id = $1 AND is_cancelled = FALSE ORDER BY created_at ASC LIMIT 1",
        [id],
      );
      const existingChallanStatus = activeChallanRes.rows[0]?.status;
      const currentEffectiveStatus = existingChallanStatus || sale.status;

      if (req.body.status !== "Pending" || currentEffectiveStatus === "Pending") {
        updates.status = req.body.status;
      } else {
        updates.status = currentEffectiveStatus;
      }
    }
    if (
      req.body.estimated_delivery_date !== undefined ||
      req.body.estimatedDeliveryDate !== undefined
    ) {
      updates.estimated_delivery_date =
        req.body.estimated_delivery_date !== undefined
          ? req.body.estimated_delivery_date
          : req.body.estimatedDeliveryDate;
    }

    // Sync client_phone, customer, or notes/remarks to challans if inventory didn't change but customer/phone/remarks did
    if (deliveredQty === 0 && !isInventoryChanged) {
      const finalCustomer =
        updates.customer !== undefined ? updates.customer : sale.customer;
      const finalClientPhone =
        updates.client_phone !== undefined
          ? updates.client_phone
          : sale.client_phone;
      const finalRemarks =
        updates.remarks !== undefined ? updates.remarks : sale.remarks;
      if (
        updates.customer !== undefined ||
        updates.client_phone !== undefined ||
        updates.remarks !== undefined
      ) {
        await db.query(
          "UPDATE challans SET customer = $1, client_phone = $2, notes = $3 WHERE sales_id = $4",
          [finalCustomer, finalClientPhone, finalRemarks || "", id],
        );
      }
    }

    // Recalculate total price
    const finalOrderedQty =
      updates.ordered_qty !== undefined
        ? updates.ordered_qty
        : Number(sale.ordered_qty);
    const finalRate = Number(sale.rate || 0);
    updates.total_price = finalOrderedQty * finalRate;

    if (Object.keys(updates).length > 0) {
      const setClause = Object.keys(updates)
        .map((key, i) => `"${key}" = $${i + 1}`)
        .join(", ");
      const values = Object.values(updates);
      const result = await db.query(
        `UPDATE sales SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = $${values.length + 1} RETURNING *`,
        [...values, id],
      );
      await db.query("COMMIT");
      res.json(result.rows[0]);
    } else {
      await db.query("COMMIT");
      res.json(sale);
    }
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/sales/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("BEGIN");
    // Fetch associated non-cancelled challans to restore their stock
    const challansRes = await db.query(
      "SELECT * FROM challans WHERE sales_id = $1 AND is_cancelled = FALSE",
      [id],
    );
    for (const item of challansRes.rows) {
      const stockCategory = item.stock_category || "Available";
      let updateCol = "available_qty";
      if (stockCategory === "Display") updateCol = "display_qty";
      else if (stockCategory === "Damage") updateCol = "damage_qty";

      // 1. Get total returns for this client, product and batch
      const returnsRes = await db.query(
        `SELECT COALESCE(SUM(quantity), 0) AS total_returns 
         FROM sales_returns 
         WHERE client_name = $1 AND product_name = $2 AND batch_no = $3`,
        [item.customer, item.product, item.batch_no || "0"],
      );
      const totalReturns = Number(returnsRes.rows[0].total_returns || 0);

      // 2. Get total returns already applied to other cancelled challans
      const appliedRes = await db.query(
        `SELECT COALESCE(SUM(quantity - COALESCE(restored_qty, quantity)), 0) AS total_applied 
         FROM challans 
         WHERE customer = $1 AND product = $2 AND batch_no = $3 AND is_cancelled = TRUE`,
        [item.customer, item.product, item.batch_no || "0"],
      );
      const totalApplied = Number(appliedRes.rows[0].total_applied || 0);

      const unappliedReturns = Math.max(0, totalReturns - totalApplied);
      const restoreQty = Math.max(
        0,
        Number(item.quantity || 0) - unappliedReturns,
      );

      await db.query(
        `UPDATE batches SET ${updateCol} = CASE WHEN quantity > 0 THEN LEAST(quantity, ${updateCol} + $1) ELSE ${updateCol} + $1 END WHERE product_name = $2 AND batch_number = $3`,
        [restoreQty, item.product, item.batch_no || "0"],
      );
    }

    // Delete associated challans first
    await db.query("DELETE FROM challans WHERE sales_id = $1", [id]);
    await db.query("DELETE FROM sales WHERE id = $1", [id]);
    await db.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

// Confirm a sale (Pending â†’ Confirmed) â€” also updates its pending challan status
app.put("/api/sales/:id/confirm", async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("BEGIN");
    const saleRes = await db.query("SELECT * FROM sales WHERE id = $1", [id]);
    if (saleRes.rows.length === 0) {
      await db.query("ROLLBACK");
      return res.status(404).json({ error: "Sale not found" });
    }
    const sale = saleRes.rows[0];
    if (sale.status !== "Pending") {
      await db.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: `Cannot confirm a sale with status: ${sale.status}` });
    }
    await db.query(
      "UPDATE sales SET status = 'Confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [id],
    );
    // Also update associated pending challans to Confirmed
    await db.query(
      "UPDATE challans SET status = 'Confirmed' WHERE sales_id = $1 AND status = 'Pending' AND is_cancelled = FALSE",
      [id],
    );
    await db.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

// Deliver a sale directly from the Sales page â€” deducts stock via its pending/confirmed challan
app.put("/api/sales/:id/deliver", async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("BEGIN");

    const saleRes = await db.query("SELECT * FROM sales WHERE id = $1", [id]);
    if (saleRes.rows.length === 0) {
      await db.query("ROLLBACK");
      return res.status(404).json({ error: "Sale not found" });
    }
    const sale = saleRes.rows[0];

    if (sale.status === "Delivered" || sale.status === "Cancelled") {
      await db.query("ROLLBACK");
      return res.status(400).json({ error: `Sale is already ${sale.status}.` });
    }

    // Find the first active (non-cancelled) challan for this sale
    const challanRes = await db.query(
      "SELECT * FROM challans WHERE sales_id = $1 AND is_cancelled = FALSE AND status != 'Delivered' ORDER BY created_at ASC LIMIT 1",
      [id],
    );

    if (challanRes.rows.length === 0) {
      await db.query("ROLLBACK");
      return res
        .status(404)
        .json({
          error: "No active challan found for this sale. Cannot deliver.",
        });
    }
    const challan = challanRes.rows[0];
    const quantityToDeliver = Number(challan.quantity);
    const stockCategory = challan.stock_category || "Available";
    const productName = challan.product;
    const batchNo = challan.batch_no;

    const lastBatchNo = batchNo;

    // Update Sale to Delivered
    const newDeliveredQty = Number(sale.delivered_qty || 0) + quantityToDeliver;
    const newPendingQty = Math.max(
      0,
      Number(sale.pending_qty || 0) - quantityToDeliver,
    );
    let newStatus =
      newDeliveredQty >= Number(sale.ordered_qty) ? "Delivered" : "Partial";

    await db.query(
      `UPDATE sales SET delivered_qty = $1, pending_qty = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
      [newDeliveredQty, newPendingQty, newStatus, id],
    );

    // Mark challan as Delivered
    await db.query(
      `UPDATE challans SET status = 'Delivered', batch_no = $1 WHERE id = $2`,
      [lastBatchNo || batchNo || "0", challan.id],
    );

    await db.query("COMMIT");
    res.json({ success: true, status: newStatus });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/sales-returns", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM sales_returns ORDER BY receive_date DESC, created_at DESC",
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/sales-returns", async (req, res) => {
  const {
    client_name,
    client_phone,
    price_category,
    receive_date,
    product_name,
    quantity,
    batch_no,
    notes,
  } = req.body;
  const qty = Number(quantity || 0);
  try {
    await db.query("BEGIN");

    const result = await db.query(
      `INSERT INTO sales_returns
       (client_name, client_phone, price_category, receive_date, product_name, quantity, batch_no, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        client_name,
        client_phone,
        price_category,
        receive_date,
        product_name,
        qty,
        batch_no || null,
        notes || null,
      ],
    );

    let updated = false;
    if (batch_no) {
      const updateResult = await db.query(
        "UPDATE batches SET available_qty = CASE WHEN quantity > 0 THEN LEAST(quantity, available_qty + $1) ELSE available_qty + $1 END WHERE product_name = $2 AND batch_number = $3",
        [qty, product_name, batch_no],
      );
      updated = updateResult.rowCount > 0;
    }

    if (!updated) {
      const batchLookup = await db.query(
        "SELECT id FROM batches WHERE product_name = $1 ORDER BY date ASC LIMIT 1",
        [product_name],
      );
      if (batchLookup.rows.length > 0) {
        await db.query(
          "UPDATE batches SET available_qty = CASE WHEN quantity > 0 THEN LEAST(quantity, available_qty + $1) ELSE available_qty + $1 END WHERE id = $2",
          [qty, batchLookup.rows[0].id],
        );
        updated = true;
      }
    }

    if (!updated) {
      const productLookup = await db.query(
        "SELECT category FROM products WHERE name = $1 LIMIT 1",
        [product_name],
      );
      const category =
        productLookup.rows.length > 0
          ? productLookup.rows[0].category
          : "Other";
      await db.query(
        "INSERT INTO batches (product_name, category, batch_number, quantity, available_qty, date) VALUES ($1, $2, $3, 0, $4, CURRENT_DATE)",
        [
          product_name,
          category,
          batch_no || `RET-${Date.now().toString(36).toUpperCase()}`,
          qty,
        ],
      );
    }

    // Reconcile stock for this product so available_qty incorporates the sales return
    await reconcileAllProductStocks(product_name);
    await resolveNegativeStock(product_name);

    await db.query("COMMIT");
    res.json(result.rows[0]);
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/sales-returns/:id", async (req, res) => {
  const { id } = req.params;
  const {
    client_name,
    client_phone,
    price_category,
    receive_date,
    product_name,
    quantity,
    batch_no,
    notes,
  } = req.body;
  const newQty = Number(quantity || 0);

  try {
    await db.query("BEGIN");

    // 1. Fetch existing return record
    const existingRes = await db.query(
      "SELECT * FROM sales_returns WHERE id = $1",
      [id],
    );
    if (existingRes.rows.length === 0) {
      await db.query("ROLLBACK");
      return res.status(404).json({ error: "Sales return not found" });
    }
    const oldReturn = existingRes.rows[0];
    const oldQty = Number(oldReturn.quantity || 0);
    const oldProduct = oldReturn.product_name;
    const oldBatch = oldReturn.batch_no;

    // 2. Revert the old return's stock restoration
    if (oldBatch) {
      await db.query(
        "UPDATE batches SET available_qty = available_qty - $1 WHERE product_name = $2 AND batch_number = $3",
        [oldQty, oldProduct, oldBatch],
      );
    } else {
      const batchLookup = await db.query(
        "SELECT id FROM batches WHERE product_name = $1 ORDER BY date ASC LIMIT 1",
        [oldProduct],
      );
      if (batchLookup.rows.length > 0) {
        await db.query(
          "UPDATE batches SET available_qty = available_qty - $1 WHERE id = $2",
          [oldQty, batchLookup.rows[0].id],
        );
      }
    }

    // 3. Apply the new return's stock restoration
    let updated = false;
    const finalBatchNo = batch_no !== undefined ? batch_no : oldBatch;
    const finalProduct = product_name || oldProduct;

    if (finalBatchNo) {
      const updateResult = await db.query(
        "UPDATE batches SET available_qty = CASE WHEN quantity > 0 THEN LEAST(quantity, available_qty + $1) ELSE available_qty + $1 END WHERE product_name = $2 AND batch_number = $3",
        [newQty, finalProduct, finalBatchNo],
      );
      updated = updateResult.rowCount > 0;
    }

    if (!updated) {
      const batchLookup = await db.query(
        "SELECT id FROM batches WHERE product_name = $1 ORDER BY date ASC LIMIT 1",
        [finalProduct],
      );
      if (batchLookup.rows.length > 0) {
        await db.query(
          "UPDATE batches SET available_qty = CASE WHEN quantity > 0 THEN LEAST(quantity, available_qty + $1) ELSE available_qty + $1 END WHERE id = $2",
          [newQty, batchLookup.rows[0].id],
        );
        updated = true;
      }
    }

    if (!updated) {
      const productLookup = await db.query(
        "SELECT category FROM products WHERE name = $1 LIMIT 1",
        [finalProduct],
      );
      const category =
        productLookup.rows.length > 0
          ? productLookup.rows[0].category
          : "Other";
      await db.query(
        "INSERT INTO batches (product_name, category, batch_number, quantity, available_qty, date) VALUES ($1, $2, $3, 0, $4, CURRENT_DATE)",
        [
          finalProduct,
          category,
          finalBatchNo || `RET-${Date.now().toString(36).toUpperCase()}`,
          newQty,
        ],
      );
    }

    // 4. Update the sales_returns table
    const result = await db.query(
      `UPDATE sales_returns
       SET client_name = $1, client_phone = $2, price_category = $3, receive_date = $4,
           product_name = $5, quantity = $6, batch_no = $7, notes = $8
       WHERE id = $9
       RETURNING *`,
      [
        client_name || oldReturn.client_name,
        client_phone !== undefined ? client_phone : oldReturn.client_phone,
        price_category || oldReturn.price_category,
        receive_date || oldReturn.receive_date,
        finalProduct,
        newQty,
        finalBatchNo || null,
        notes !== undefined ? notes : oldReturn.notes,
        id,
      ],
    );

    await reconcileAllProductStocks(finalProduct);
    if (oldProduct && oldProduct !== finalProduct) {
      await reconcileAllProductStocks(oldProduct);
    }
    await resolveNegativeStock(finalProduct);

    await db.query("COMMIT");
    res.json(result.rows[0]);
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/sales-returns/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("BEGIN");
    const existingRes = await db.query(
      "SELECT * FROM sales_returns WHERE id = $1",
      [id],
    );
    if (existingRes.rows.length === 0) {
      await db.query("ROLLBACK");
      return res.status(404).json({ error: "Sales return not found" });
    }
    const oldReturn = existingRes.rows[0];
    const oldQty = Number(oldReturn.quantity || 0);
    const oldProduct = oldReturn.product_name;
    const oldBatch = oldReturn.batch_no;

    // Deduct stock
    if (oldBatch) {
      await db.query(
        "UPDATE batches SET available_qty = available_qty - $1 WHERE product_name = $2 AND batch_number = $3",
        [oldQty, oldProduct, oldBatch],
      );
    } else {
      const batchLookup = await db.query(
        "SELECT id FROM batches WHERE product_name = $1 ORDER BY date ASC LIMIT 1",
        [oldProduct],
      );
      if (batchLookup.rows.length > 0) {
        await db.query(
          "UPDATE batches SET available_qty = available_qty - $1 WHERE id = $2",
          [oldQty, batchLookup.rows[0].id],
        );
      }
    }

    await db.query("DELETE FROM sales_returns WHERE id = $1", [id]);
    await reconcileAllProductStocks(oldProduct);
    await db.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

// --- Challans ---
app.get("/api/challans", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM challans ORDER BY created_at DESC, id DESC",
    );
    const challans = result.rows;

    const returnsRes = await db.query(
      "SELECT client_name, product_name, batch_no, quantity FROM sales_returns",
    );
    const returns = returnsRes.rows;

    const returnsByKey = new Map();
    for (const r of returns) {
      const key = `${r.client_name}||${r.product_name}||${r.batch_no || "0"}`;
      returnsByKey.set(
        key,
        (returnsByKey.get(key) || 0) + Number(r.quantity || 0),
      );
    }

    const sortedChallans = [...challans].sort((a, b) => {
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (dateA !== dateB) return dateA - dateB;
      const idA = a.id ? String(a.id) : "";
      const idB = b.id ? String(b.id) : "";
      return idA.localeCompare(idB);
    });
    const distributedReturnsByKey = new Map();

    for (const c of sortedChallans) {
      const key = `${c.customer}||${c.product}||${c.batch_no || "0"}`;
      const totalReturns = returnsByKey.get(key) || 0;
      const alreadyDistributed = distributedReturnsByKey.get(key) || 0;
      const remainingReturns = Math.max(0, totalReturns - alreadyDistributed);

      if (c.is_cancelled) {
        const absorbed =
          Number(c.quantity || 0) - Number(c.restored_qty ?? c.quantity);
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

app.post("/api/challans", async (req, res) => {
  const {
    sales_id,
    quantity,
    batch_no,
    notes,
    stock_category = "Available",
    status = "Pending",
  } = req.body;
  try {
    await db.query("BEGIN");

    // Get Sale info
    const saleRes = await db.query("SELECT * FROM sales WHERE id = $1", [
      sales_id,
    ]);
    if (saleRes.rows.length === 0) {
      await db.query("ROLLBACK");
      return res.status(404).json({ error: "Sale record not found" });
    }
    const sale = saleRes.rows[0];

    // Generate challan number: CH-xxxx for immediate, P-xxxx for pending
    const prefix = status === "Pending" ? "P-" : "CH-";
    const challanNo = await getNextChallanNumber(prefix);

    const result = await db.query(
      `INSERT INTO challans 
      (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE, $9, $10, FALSE, FALSE, FALSE) RETURNING *`,
      [
        challanNo,
        sales_id,
        sale.customer,
        sale.client_phone,
        sale.product,
        batch_no || sale.batch_no || "0",
        quantity,
        status,
        notes,
        stock_category,
      ],
    );

    await db.query("COMMIT");
    res.json(result.rows[0]);
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/challans/deliver/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("BEGIN");

    // 1. Fetch Challan
    const challanRes = await db.query("SELECT * FROM challans WHERE id = $1", [
      id,
    ]);
    if (challanRes.rows.length === 0) {
      await db.query("ROLLBACK");
      return res.status(404).json({ error: "Challan not found" });
    }
    const challan = challanRes.rows[0];

    if (challan.status !== "Pending" && challan.status !== "Confirmed") {
      await db.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "Challan is already delivered or cancelled." });
    }

    // 2. Fetch Sale
    const saleRes = await db.query("SELECT * FROM sales WHERE id = $1", [
      challan.sales_id,
    ]);
    if (saleRes.rows.length === 0) {
      await db.query("ROLLBACK");
      return res
        .status(404)
        .json({ error: "Associated Sale record not found." });
    }
    const sale = saleRes.rows[0];

    const quantityToDeliver = Number(challan.quantity);
    const stockCategory = challan.stock_category || "Available";
    const productName = challan.product;
    const batchNo = challan.batch_no;

    const lastBatchNo = batchNo;

    // 4. Update Sale quantities and status
    const newDeliveredQty = Number(sale.delivered_qty || 0) + quantityToDeliver;
    const newPendingQty = Math.max(
      0,
      Number(sale.pending_qty || 0) - quantityToDeliver,
    );
    let newStatus = "Pending";
    if (newDeliveredQty >= Number(sale.ordered_qty)) {
      newStatus = "Delivered";
    } else if (newDeliveredQty > 0) {
      newStatus = "Partial";
    }

    await db.query(
      `UPDATE sales 
       SET delivered_qty = $1, pending_qty = $2, status = $3, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $4`,
      [newDeliveredQty, newPendingQty, newStatus, sale.id],
    );

    // 5. Update Challan status to Delivered
    await db.query(
      `UPDATE challans SET status = 'Delivered', batch_no = $1 WHERE id = $2`,
      [lastBatchNo || batchNo || "0", id],
    );

    await db.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/challans/:id", async (req, res) => {
  const { id } = req.params;
  const fields = { ...req.body };
  if (fields.stockCategory !== undefined) {
    fields.stock_category = fields.stockCategory;
    delete fields.stockCategory;
  }
  try {
    const existing = await db.query(
      "SELECT status, is_cancelled FROM challans WHERE id = $1",
      [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Challan not found" });
    }
    const challan = existing.rows[0];

    if (challan.status === "Delivered") {
      const hasOtherUpdates = Object.keys(fields).some(
        (k) =>
          k !== "is_printed" &&
          k !== "is_built" &&
          k !== "is_challan_generated" &&
          k !== "isPrinted" &&
          k !== "isBuilt" &&
          k !== "isChallanGenerated" &&
          k !== "bill_no" &&
          k !== "billNo",
      );
      if (hasOtherUpdates) {
        return res
          .status(400)
          .json({ error: "Delivered challans are read-only." });
      }
    }
    if (challan.is_cancelled) {
      return res
        .status(400)
        .json({ error: "Cancelled challans cannot be edited." });
    }

    const allowedUpdates = {};
    if (fields.quantity !== undefined)
      allowedUpdates.quantity = fields.quantity;
    if (fields.notes !== undefined) allowedUpdates.notes = fields.notes;
    if (fields.stock_category !== undefined)
      allowedUpdates.stock_category = fields.stock_category;
    if (fields.batch_no !== undefined)
      allowedUpdates.batch_no = fields.batch_no;
    if (fields.status !== undefined) allowedUpdates.status = fields.status;
    if (fields.is_printed !== undefined)
      allowedUpdates.is_printed = fields.is_printed;
    if (fields.is_built !== undefined)
      allowedUpdates.is_built = fields.is_built;
    if (fields.bill_no !== undefined)
      allowedUpdates.bill_no = fields.bill_no;
    if (fields.billNo !== undefined)
      allowedUpdates.bill_no = fields.billNo;
    if (fields.is_challan_generated !== undefined)
      allowedUpdates.is_challan_generated = fields.is_challan_generated;

    if (Object.keys(allowedUpdates).length > 0) {
      const setClause = Object.keys(allowedUpdates)
        .map((key, i) => `"${key}" = $${i + 1}`)
        .join(", ");
      const values = Object.values(allowedUpdates);
      const result = await db.query(
        `UPDATE challans SET ${setClause} WHERE id = $${values.length + 1} RETURNING *`,
        [...values, id],
      );
      res.json(result.rows[0]);
    } else {
      res.json(challan);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/challans/group/:challanNumber", async (req, res) => {
  let { challanNumber } = req.params;
  const { customer, client_name, client_phone, date, items = [] } = req.body;
  const finalCustomer = customer || client_name;
  try {
    await db.query("BEGIN");

    let existingRes = await db.query(
      "SELECT * FROM challans WHERE challan_no = $1",
      [challanNumber],
    );
    let existingItems = existingRes.rows;
    if (existingItems.length === 0) {
      const salesRes = await db.query(
        "SELECT * FROM sales WHERE order_no = $1",
        [challanNumber],
      );
      if (salesRes.rows.length === 0) {
        await db.query("ROLLBACK");
        return res.status(404).json({ error: "Challan or Order not found" });
      }

      const pGroupNum = await getNextChallanNumber("P-");
      for (const s of salesRes.rows) {
        const unhandledQty = Number(s.pending_qty || s.ordered_qty || 0);
        if (unhandledQty > 0) {
          await db.query(
            `INSERT INTO challans (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', CURRENT_DATE, $8, $9, FALSE, FALSE, FALSE)`,
            [
              pGroupNum,
              s.id,
              s.customer,
              s.client_phone || "",
              s.product,
              s.batch_no || "0",
              unhandledQty,
              s.remarks || "",
              s.stock_category || "Available",
            ],
          );
        }
      }
      const freshChallans = await db.query(
        "SELECT * FROM challans WHERE challan_no = $1",
        [pGroupNum],
      );
      existingItems = freshChallans.rows;
      challanNumber = pGroupNum;
    }

    if (existingItems.some((item) => item.status === "Delivered")) {
      await db.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "Delivered challans are read-only." });
    }

    // Get parent sale info for fallback order metadata
    let parentSale = null;
    if (existingItems[0].sales_id) {
      const parentSaleRes = await db.query(
        "SELECT * FROM sales WHERE id = $1",
        [existingItems[0].sales_id],
      );
      if (parentSaleRes.rows.length > 0) parentSale = parentSaleRes.rows[0];
    }

    // 1. Restore stock for ALL existing items in this group upfront so stock is available for re-allocation
    for (const ei of existingItems) {
      let rQty = Number(ei.quantity || 0);
      let rBatch = ei.batch_no || "0";
      let rCat = ei.stock_category || "Available";
      if (ei.sales_id) {
        const saleRes = await db.query(
          "SELECT ordered_qty, batch_no, stock_category FROM sales WHERE id = $1",
          [ei.sales_id],
        );
        if (saleRes.rows.length > 0) {
          const s = saleRes.rows[0];
          rQty = Number(s.ordered_qty || 0);
          rBatch = s.batch_no || "0";
          rCat = s.stock_category || "Available";
        }
      }
      if (rQty > 0) {
        await restoreStock(ei.product, rBatch, rQty, rCat);
      }
    }

    // Handle deletion of removed items from group
    const inputItemIds = items.map((i) => i.id).filter(Boolean);
    const inputSalesIds = items.map((i) => i.salesId).filter(Boolean);
    for (const ei of existingItems) {
      const isKept = (ei.id && inputItemIds.includes(ei.id)) || (ei.sales_id && inputSalesIds.includes(ei.sales_id));
      if (!isKept) {
        await db.query("DELETE FROM challans WHERE id = $1", [ei.id]);
        if (ei.sales_id) {
          // Check if there are other active challans for this sale before deleting sale
          const otherChallans = await db.query(
            "SELECT id FROM challans WHERE sales_id = $1 AND id != $2",
            [ei.sales_id, ei.id],
          );
          if (otherChallans.rows.length === 0) {
            await db.query("DELETE FROM sales WHERE id = $1", [ei.sales_id]);
          }
        }
      }
    }

    const existingStatus = existingItems[0].status || "Pending";
    const updatedIds = [];

    for (const item of items) {
      const targetProdName = (item.productName || item.product || "").trim();
      // Match existing item strictly by ID or salesId if provided
      const existingItem = item.id
        ? existingItems.find((ei) => ei.id === item.id)
        : (item.salesId ? existingItems.find((ei) => ei.sales_id === item.salesId) : null);

      let salesId =
        item.salesId || (existingItem ? existingItem.sales_id : null);
      const productName =
        targetProdName || (existingItem ? existingItem.product : "");
      if (!productName) continue;

      const stockCategory =
        item.stockCategory ||
        item.stock_category ||
        (existingItem ? existingItem.stock_category : "Available");
      const batchNo =
        item.batchNo ||
        item.batch_no ||
        (existingItem ? existingItem.batch_no : "0");
      const notes =
        item.notes !== undefined
          ? item.notes
          : existingItem
            ? existingItem.notes
            : "";

      const newRequestedQty = Number(item.quantity || 0);

      // Fetch corresponding sale record to check for delivered quantity, and get old values for adjustment
      let oldQty = 0;
      let oldBatchNo = "0";
      let oldStockCat = "Available";
      let deliveredQty = 0;
      let rate = 0;

      if (salesId) {
        const saleRes = await db.query("SELECT * FROM sales WHERE id = $1", [
          salesId,
        ]);
        if (saleRes.rows.length > 0) {
          const sale = saleRes.rows[0];
          oldQty = Number(sale.ordered_qty || 0);
          oldBatchNo = sale.batch_no || "0";
          oldStockCat = sale.stock_category || "Available";
          deliveredQty = Number(sale.delivered_qty || 0);
          rate = Number(sale.rate || 0);

          if (deliveredQty > 0) {
            if (newRequestedQty < deliveredQty) {
              await db.query("ROLLBACK");
              return res.status(400).json({
                error: `Quantity cannot be reduced below the delivered quantity (${deliveredQty}).`,
              });
            }
            if (targetProdName && targetProdName.toLowerCase() !== (sale.product || "").trim().toLowerCase()) {
              await db.query("ROLLBACK");
              return res.status(400).json({
                error: "Cannot change product name on a partially delivered sale.",
              });
            }
          }
        }
      }

      let stockCol = "available_qty";
      if (stockCategory === "Damage") stockCol = "damage_qty";
      else if (stockCategory === "Display") stockCol = "display_qty";

      // Check available stock (positive only)
      const currentBatches = await db.query(
        `SELECT "${stockCol}" FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))`,
        [productName],
      );
      const tempAvail = currentBatches.rows.reduce(
        (acc, r) => acc + Math.max(0, Number(r[stockCol])),
        0,
      );

      // Calculate quantities to distribute based on stock availability
      const remainingToDistribute = Math.max(0, newRequestedQty - deliveredQty);
      const isPGroup =
        challanNumber.startsWith("P-") ||
        (existingItem &&
          existingItem.challan_no &&
          existingItem.challan_no.startsWith("P-"));

      const fulfillableQty = Math.min(remainingToDistribute, Math.max(0, tempAvail));
      const pDraftQty = Math.max(0, remainingToDistribute - fulfillableQty);

      const actualChallanQty = isPGroup ? pDraftQty : fulfillableQty;
      const secondaryQty = isPGroup ? fulfillableQty : pDraftQty;

      // Deduct the new stock (allows negative stock)
      const actualBatchNo = await deductStock(
        productName,
        batchNo || "0",
        newRequestedQty,
        stockCategory,
      );
      await resolveNegativeStock(productName);

      // Create Sales record if new product item added
      if (!salesId) {
        const orderNum = parentSale
          ? parentSale.order_no
          : `ORD-${Date.now().toString(36).toUpperCase()}`;
        const newSaleRes = await db.query(
          `INSERT INTO sales 
          (order_no, customer, client_phone, product, category, ordered_qty, delivered_qty, pending_qty, rate, "GST", total_price, order_date, value_category, batch_no, remarks, status, stock_category, damage_qty, created_at, updated_at) 
          VALUES ($1, $2, $3, $4, $5, $6, 0, $6, 0, 0, 0, CURRENT_DATE, 'Standard', $7, $8, 'Pending', $9, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id`,
          [
            orderNum,
            finalCustomer,
            client_phone || (parentSale ? parentSale.client_phone : ""),
            productName,
            parentSale ? parentSale.category : "Regular",
            newRequestedQty,
            actualBatchNo,
            notes || (parentSale ? parentSale.remarks : ""),
            stockCategory,
          ],
        );
        salesId = newSaleRes.rows[0].id;
      } else {
        const newPendingQtyForSale = Math.max(
          0,
          newRequestedQty - deliveredQty,
        );
        const newSaleStatus =
          newPendingQtyForSale > 0
            ? deliveredQty > 0
              ? "Partial"
              : "Pending"
            : "Delivered";
        let updateSalesQuery = `UPDATE sales SET customer = $1, client_phone = $2, product = $3, ordered_qty = $4, pending_qty = $5, total_price = $6, batch_no = $7, stock_category = $8, remarks = $9, status = $10`;
        let updateParams = [
          finalCustomer,
          client_phone || "",
          productName,
          newRequestedQty,
          newPendingQtyForSale,
          newRequestedQty * rate,
          actualBatchNo || batchNo || "0",
          stockCategory,
          notes || "",
          newSaleStatus,
        ];
        if (date) {
          updateSalesQuery += `, order_date = $${updateParams.length + 1}`;
          updateParams.push(date);
        }
        updateSalesQuery += `, updated_at = CURRENT_TIMESTAMP WHERE id = $${updateParams.length + 1}`;
        updateParams.push(salesId);

        await db.query(updateSalesQuery, updateParams);
      }

      // Update or Insert Primary Challan Item for current group
      if (actualChallanQty === 0 && isPGroup) {
        if (existingItem) {
          await db.query("DELETE FROM challans WHERE id = $1", [
            existingItem.id,
          ]);
        }
      } else if (existingItem) {
        await db.query(
          `UPDATE challans SET 
            customer = $1, 
            client_phone = $2, 
            product = $3, 
            batch_no = $4, 
            quantity = $5, 
            notes = $6, 
            stock_category = $7,
            created_at = $8
           WHERE id = $9`,
          [
            finalCustomer,
            client_phone || "",
            productName,
            actualBatchNo || batchNo || "0",
            actualChallanQty,
            notes,
            stockCategory,
            date || new Date().toISOString().slice(0, 10),
            existingItem.id,
          ],
        );
        updatedIds.push(existingItem.id);
      } else if (actualChallanQty > 0 || !isPGroup) {
        const insertRes = await db.query(
          `INSERT INTO challans
           (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, is_cancelled, stock_category, is_printed, is_built)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, $11, FALSE, FALSE) RETURNING id`,
          [
            challanNumber,
            salesId,
            finalCustomer,
            client_phone || "",
            productName,
            actualBatchNo || batchNo || "0",
            actualChallanQty,
            existingStatus,
            date || new Date().toISOString().slice(0, 10),
            notes,
            stockCategory,
          ],
        );
        if (insertRes.rows.length > 0) {
          updatedIds.push(insertRes.rows[0].id);
        }
      }

      // Dual-Sync counterpart (CH- delivery challan if editing P- group, or P- draft challan if editing CH- group)
      if (salesId) {
        const existingItemId = existingItem ? existingItem.id : null;
        const targetPrefix = isPGroup ? "CH-" : "P-";
        const targetStatus = isPGroup ? "Confirmed" : "Pending";

        const counterRes = existingItemId
          ? await db.query(
              `SELECT * FROM challans WHERE sales_id = $1 AND (challan_no LIKE '${targetPrefix}%' OR (challan_no LIKE 'CH%' AND $2 = 'CH-')) AND status != 'Delivered' AND is_cancelled = FALSE AND id != $3 ORDER BY created_at ASC LIMIT 1`,
              [salesId, targetPrefix, existingItemId],
            )
          : await db.query(
              `SELECT * FROM challans WHERE sales_id = $1 AND (challan_no LIKE '${targetPrefix}%' OR (challan_no LIKE 'CH%' AND $2 = 'CH-')) AND status != 'Delivered' AND is_cancelled = FALSE ORDER BY created_at ASC LIMIT 1`,
              [salesId, targetPrefix],
            );

        if (secondaryQty > 0) {
          if (counterRes.rows.length > 0) {
            await db.query(
              "UPDATE challans SET quantity = $1, customer = $2, client_phone = $3, product = $4, batch_no = $5, stock_category = $6 WHERE id = $7",
              [
                secondaryQty,
                finalCustomer,
                client_phone || "",
                productName,
                actualBatchNo || batchNo || "0",
                stockCategory,
                counterRes.rows[0].id,
              ],
            );
          } else {
            const nextNum = await getNextChallanNumber(targetPrefix);
            await db.query(
              `INSERT INTO challans
              (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE, $9, $10, FALSE, FALSE, FALSE)`,
              [
                nextNum,
                salesId,
                finalCustomer,
                client_phone || "",
                productName,
                actualBatchNo || batchNo || "0",
                secondaryQty,
                targetStatus,
                notes,
                stockCategory,
              ],
            );
          }
        } else if (counterRes.rows.length > 0) {
          await db.query("DELETE FROM challans WHERE id = $1", [
            counterRes.rows[0].id,
          ]);
        }
      }
    }

    await db.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/challans/group/:challanNumber/cancel", async (req, res) => {
  const { challanNumber } = req.params;
  try {
    await db.query("BEGIN");
    const existingRes = await db.query(
      "SELECT * FROM challans WHERE challan_no = $1",
      [challanNumber],
    );
    const existingItems = existingRes.rows;
    if (existingItems.length === 0) {
      await db.query("ROLLBACK");
      return res.status(404).json({ error: "Challan not found" });
    }

    const alreadyCancelled = existingItems.every(
      (item) => item.is_cancelled || item.status === "Cancelled",
    );
    if (!alreadyCancelled) {
      for (const item of existingItems) {
        if (!item.is_cancelled && item.status !== "Cancelled") {
          const stockCategory = item.stock_category || "Available";
          let updateCol = "available_qty";
          if (stockCategory === "Display") updateCol = "display_qty";
          else if (stockCategory === "Damage") updateCol = "damage_qty";

          // 1. Get total returns for this client, product and batch
          const returnsRes = await db.query(
            `SELECT COALESCE(SUM(quantity), 0) AS total_returns 
             FROM sales_returns 
             WHERE client_name = $1 AND product_name = $2 AND batch_no = $3`,
            [item.customer, item.product, item.batch_no || "0"],
          );
          const totalReturns = Number(returnsRes.rows[0].total_returns || 0);

          // 2. Get total returns already applied to other cancelled challans
          const appliedRes = await db.query(
            `SELECT COALESCE(SUM(quantity - COALESCE(restored_qty, quantity)), 0) AS total_applied 
             FROM challans 
             WHERE customer = $1 AND product = $2 AND batch_no = $3 AND is_cancelled = TRUE`,
            [item.customer, item.product, item.batch_no || "0"],
          );
          const totalApplied = Number(appliedRes.rows[0].total_applied || 0);

          const unappliedReturns = Math.max(0, totalReturns - totalApplied);
          const restoreQty = Math.max(
            0,
            Number(item.quantity || 0) - unappliedReturns,
          );

          await db.query(
            `UPDATE batches SET ${updateCol} = CASE WHEN quantity > 0 THEN LEAST(quantity, ${updateCol} + $1) ELSE ${updateCol} + $1 END WHERE product_name = $2 AND batch_number = $3`,
            [restoreQty, item.product, item.batch_no || "0"],
          );

          // Update the item's restored_qty
          await db.query(
            "UPDATE challans SET restored_qty = $1 WHERE id = $2",
            [restoreQty, item.id],
          );

          // 3. Revert Sale record delivered and pending quantities and recalculate status
          const saleRes = await db.query("SELECT * FROM sales WHERE id = $1", [
            item.sales_id,
          ]);
          if (saleRes.rows.length > 0) {
            const sale = saleRes.rows[0];
            const newDelivered = Math.max(
              0,
              Number(sale.delivered_qty || 0) - Number(item.quantity),
            );
            const newPending =
              Number(sale.pending_qty || 0) + Number(item.quantity);
            let newStatus = "Pending";
            if (newDelivered >= Number(sale.ordered_qty)) {
              newStatus = "Delivered";
            } else if (newDelivered > 0) {
              newStatus = "Partial";
            }
            await db.query(
              "UPDATE sales SET delivered_qty = $1, pending_qty = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4",
              [newDelivered, newPending, newStatus, sale.id],
            );
          }
        }
      }
    }

    await db.query(
      `UPDATE challans SET is_cancelled = TRUE, status = 'Cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE challan_no = $1`,
      [challanNumber],
    );

    // Also cancel any linked P-xxx pending draft for this sale
    const salesIdForPDraft = existingItems[0]
      ? existingItems[0].sales_id
      : null;
    if (salesIdForPDraft) {
      await db.query(
        "UPDATE challans SET is_cancelled = TRUE, status = 'Cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE sales_id = $1 AND challan_no LIKE 'P-%' AND is_cancelled = FALSE",
        [salesIdForPDraft],
      );
      await db.query(
        "UPDATE sales SET status = 'Cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [salesIdForPDraft],
      );
    }

    await db.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/challans/cancel/:challanNumber", async (req, res) => {
  const { challanNumber } = req.params;
  try {
    await db.query("BEGIN");
    const existingRes = await db.query(
      "SELECT * FROM challans WHERE challan_no = $1",
      [challanNumber],
    );
    const existingItems = existingRes.rows;
    if (existingItems.length === 0) {
      await db.query("ROLLBACK");
      return res.status(404).json({ error: "Challan not found" });
    }

    const alreadyCancelled = existingItems.every(
      (item) => item.is_cancelled || item.status === "Cancelled",
    );
    if (!alreadyCancelled) {
      for (const item of existingItems) {
        if (!item.is_cancelled && item.status !== "Cancelled") {
          const stockCategory = item.stock_category || "Available";
          let updateCol = "available_qty";
          if (stockCategory === "Display") updateCol = "display_qty";
          else if (stockCategory === "Damage") updateCol = "damage_qty";

          // 1. Get total returns for this client, product and batch
          const returnsRes = await db.query(
            `SELECT COALESCE(SUM(quantity), 0) AS total_returns 
             FROM sales_returns 
             WHERE client_name = $1 AND product_name = $2 AND batch_no = $3`,
            [item.customer, item.product, item.batch_no || "0"],
          );
          const totalReturns = Number(returnsRes.rows[0].total_returns || 0);

          // 2. Get total returns already applied to other cancelled challans
          const appliedRes = await db.query(
            `SELECT COALESCE(SUM(quantity - COALESCE(restored_qty, quantity)), 0) AS total_applied 
             FROM challans 
             WHERE customer = $1 AND product = $2 AND batch_no = $3 AND is_cancelled = TRUE`,
            [item.customer, item.product, item.batch_no || "0"],
          );
          const totalApplied = Number(appliedRes.rows[0].total_applied || 0);

          const unappliedReturns = Math.max(0, totalReturns - totalApplied);
          const restoreQty = Math.max(
            0,
            Number(item.quantity || 0) - unappliedReturns,
          );

          await restoreStock(
            item.product,
            item.batch_no || "0",
            restoreQty,
            stockCategory,
          );

          // Update the item's restored_qty
          await db.query(
            "UPDATE challans SET restored_qty = $1 WHERE id = $2",
            [restoreQty, item.id],
          );

          // 3. Revert Sale record delivered and pending quantities and recalculate status
          const saleRes = await db.query("SELECT * FROM sales WHERE id = $1", [
            item.sales_id,
          ]);
          if (saleRes.rows.length > 0) {
            const sale = saleRes.rows[0];
            const newDelivered = Math.max(
              0,
              Number(sale.delivered_qty || 0) - Number(item.quantity),
            );
            const newPending =
              Number(sale.pending_qty || 0) + Number(item.quantity);
            let newStatus = "Pending";
            if (newDelivered >= Number(sale.ordered_qty)) {
              newStatus = "Delivered";
            } else if (newDelivered > 0) {
              newStatus = "Partial";
            }
            await db.query(
              "UPDATE sales SET delivered_qty = $1, pending_qty = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4",
              [newDelivered, newPending, newStatus, sale.id],
            );
          }
        }
      }
    }

    await db.query(
      `UPDATE challans SET is_cancelled = TRUE, status = 'Cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE challan_no = $1`,
      [challanNumber],
    );

    // Cascade: also cancel any linked P-xxx pending draft for the same sale & restore its deducted stock
    const salesIdForCascade = existingItems[0]
      ? existingItems[0].sales_id
      : null;
    if (salesIdForCascade) {
      const pDrafts = await db.query(
        "SELECT * FROM challans WHERE sales_id = $1 AND challan_no LIKE 'P-%' AND is_cancelled = FALSE",
        [salesIdForCascade],
      );
      for (const pItem of pDrafts.rows) {
        await restoreStock(
          pItem.product,
          pItem.batch_no || "0",
          Number(pItem.quantity || 0),
          pItem.stock_category || "Available",
        );
      }

      await db.query(
        "UPDATE challans SET is_cancelled = TRUE, status = 'Cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE sales_id = $1 AND is_cancelled = FALSE",
        [salesIdForCascade],
      );
      await db.query(
        "UPDATE sales SET status = 'Cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [salesIdForCascade],
      );
    }

    await db.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

// Generate a single P-xxxx draft challan for an entire pending order group
app.post("/api/challans/group/generate-pending", async (req, res) => {
  const { orderNo, salesIds } = req.body;
  try {
    await db.query("BEGIN");

    let salesRows = [];
    if (salesIds && Array.isArray(salesIds) && salesIds.length > 0) {
      const numericIds = salesIds.map((id) => Number(id)).filter((id) => !isNaN(id));
      if (numericIds.length > 0) {
        const salesRes = await db.query(
          "SELECT * FROM sales WHERE id = ANY($1::int[]) AND status != 'Cancelled' AND pending_qty > 0",
          [numericIds],
        );
        salesRows = salesRes.rows;
      }
    }
    
    if (salesRows.length === 0 && orderNo) {
      const salesRes = await db.query(
        "SELECT * FROM sales WHERE order_no = $1 AND status != 'Cancelled' AND pending_qty > 0",
        [orderNo],
      );
      salesRows = salesRes.rows;
    }

    if (salesRows.length === 0) {
      await db.query("ROLLBACK");
      return res.status(404).json({ error: "No pending sales found for this order." });
    }

    // Check if a P- draft challan already exists for any of these sales
    const existingPChallans = await db.query(
      `SELECT * FROM challans WHERE sales_id = ANY($1::int[]) AND challan_no LIKE 'P-%' AND is_cancelled = FALSE AND status = 'Pending'`,
      [salesRows.map((s) => s.id)],
    );

    if (existingPChallans.rows.length > 0) {
      await db.query("COMMIT");
      return res.json(existingPChallans.rows);
    }

    // Generate a single P- draft challan number for all pending items in this order
    const pGroupNum = await getNextChallanNumber("P-");
    const createdChallans = [];

    for (const sale of salesRows) {
      // Calculate covered qty by active CH- or Confirmed/Delivered challans
      const coveredRes = await db.query(
        `SELECT SUM(quantity) as sum FROM challans WHERE sales_id = $1 AND is_cancelled = FALSE AND (challan_no LIKE 'CH-%' OR challan_no LIKE 'CH%' OR status = 'Confirmed' OR status = 'Delivered')`,
        [sale.id],
      );
      const coveredQty = Number(coveredRes.rows[0]?.sum || 0);
      const unhandledQty = Math.max(
        0,
        Number(sale.pending_qty || sale.ordered_qty || 0) - coveredQty,
      );

      if (unhandledQty > 0) {
        const insRes = await db.query(
          `INSERT INTO challans 
          (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', CURRENT_DATE, $8, $9, FALSE, FALSE, FALSE) RETURNING *`,
          [
            pGroupNum,
            sale.id,
            sale.customer,
            sale.client_phone || "",
            sale.product,
            sale.batch_no || "0",
            unhandledQty,
            sale.remarks || "",
            sale.stock_category || "Available",
          ],
        );
        createdChallans.push(insRes.rows[0]);
      }
    }

    await db.query("COMMIT");
    res.json(createdChallans);
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

// Confirm an entire challan group (Pending → Confirmed, no stock deduction)
app.put("/api/challans/group/:challanNumber/confirm", async (req, res) => {
  const { challanNumber } = req.params;
  try {
    await db.query("BEGIN");
    const challanRes = await db.query(
      "SELECT * FROM challans WHERE challan_no = $1 AND is_cancelled = FALSE AND status != 'Delivered'",
      [challanNumber],
    );
    if (challanRes.rows.length === 0) {
      await db.query("ROLLBACK");
      return res
        .status(404)
        .json({ error: "No confirmable challan items found." });
    }
    // Update all items to Confirmed
    await db.query(
      "UPDATE challans SET status = 'Confirmed' WHERE challan_no = $1 AND is_cancelled = FALSE AND status = 'Pending'",
      [challanNumber],
    );
    // Update related sales to Confirmed (only if currently Pending)
    const salesIds = [
      ...new Set(challanRes.rows.map((c) => c.sales_id).filter(Boolean)),
    ];
    for (const sid of salesIds) {
      await db.query(
        "UPDATE sales SET status = 'Confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'Pending'",
        [sid],
      );
    }
    await db.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

// Deliver an entire challan group â€” FIFO stock deduction for every item
app.put("/api/challans/group/:challanNumber/deliver", async (req, res) => {
  const { challanNumber } = req.params;
  try {
    await db.query("BEGIN");
    const challanRes = await db.query(
      "SELECT * FROM challans WHERE challan_no = $1 AND is_cancelled = FALSE AND status != 'Delivered'",
      [challanNumber],
    );
    if (challanRes.rows.length === 0) {
      await db.query("ROLLBACK");
      return res
        .status(404)
        .json({ error: "No deliverable challan items found." });
    }

    for (const challan of challanRes.rows) {
      const quantityToDeliver = Number(challan.quantity);
      const stockCategory = challan.stock_category || "Available";
      const productName = challan.product;
      const batchNo = challan.batch_no;

      const lastBatchNo = batchNo;

      // Update related sale
      if (challan.sales_id) {
        const saleRes = await db.query("SELECT * FROM sales WHERE id = $1", [
          challan.sales_id,
        ]);
        if (saleRes.rows.length > 0) {
          const sale = saleRes.rows[0];
          const newDeliveredQty =
            Number(sale.delivered_qty || 0) + quantityToDeliver;
          const newPendingQty = Math.max(
            0,
            Number(sale.pending_qty || 0) - quantityToDeliver,
          );
          let newStatus = "Pending";
          if (newDeliveredQty >= Number(sale.ordered_qty))
            newStatus = "Delivered";
          else if (newDeliveredQty > 0) newStatus = "Partial";
          await db.query(
            "UPDATE sales SET delivered_qty = $1, pending_qty = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4",
            [newDeliveredQty, newPendingQty, newStatus, challan.sales_id],
          );
        }
      }

      // Mark challan item as Delivered
      await db.query(
        "UPDATE challans SET status = 'Delivered', batch_no = $1 WHERE id = $2",
        [lastBatchNo || batchNo || "0", challan.id],
      );
    }

    await db.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

// Update bill_no for an entire challan group
app.put("/api/challans/group/:challanNumber/bill", async (req, res) => {
  const { challanNumber } = req.params;
  const { billNo, bill_no } = req.body;
  const finalBillNo = (billNo !== undefined ? billNo : bill_no) ?? null;
  try {
    await db.query(
      "UPDATE challans SET bill_no = $1 WHERE challan_no = $2",
      [finalBillNo, challanNumber],
    );
    res.json({ success: true, billNo: finalBillNo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete entire challan group by challanNo (safe – only for cancelled/pending rows)
app.delete("/api/challans/group/:challanNumber", async (req, res) => {
  const { challanNumber } = req.params;
  try {
    const existing = await db.query(
      "SELECT * FROM challans WHERE challan_no = $1",
      [challanNumber],
    );
    if (existing.rows.length === 0)
      return res.status(404).json({ error: "Challan not found" });
    // Safety: refuse to delete delivered, non-cancelled challans
    const hasActiveDelivered = existing.rows.some(
      (r) => r.status === "Delivered" && !r.is_cancelled,
    );
    if (hasActiveDelivered)
      return res
        .status(400)
        .json({ error: "Cannot delete a delivered challan." });
    // Delete the challan group
    await db.query("DELETE FROM challans WHERE challan_no = $1", [
      challanNumber,
    ]);
    // Also delete any linked P-xxx drafts for the same sale (orphan cleanup)
    const salesId = existing.rows[0] ? existing.rows[0].sales_id : null;
    const isCancelled = existing.rows.some(
      (r) => r.is_cancelled || r.status === "Cancelled",
    );
    if (salesId) {
      if (isCancelled) {
        // If deleting a cancelled challan, delete all cancelled challans for this sale (both CH- and P-)
        await db.query(
          "DELETE FROM challans WHERE sales_id = $1 AND is_cancelled = TRUE",
          [salesId],
        );
      }
      await db.query(
        "DELETE FROM challans WHERE sales_id = $1 AND challan_no LIKE 'P-%'",
        [salesId],
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/challans/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("BEGIN");

    const challanRes = await db.query("SELECT * FROM challans WHERE id = $1", [
      id,
    ]);

    if (challanRes.rows.length > 0) {
      const challan = challanRes.rows[0];

      if (challan.status === "Delivered" && !challan.is_cancelled) {
        // Revert stock from batches
        const stockCategory = challan.stock_category || "Available";
        let updateCol = "available_qty";
        if (stockCategory === "Display") updateCol = "display_qty";
        else if (stockCategory === "Damage") updateCol = "damage_qty";

        await db.query(
          `UPDATE batches SET ${updateCol} = CASE WHEN quantity > 0 THEN LEAST(quantity, ${updateCol} + $1) ELSE ${updateCol} + $1 END WHERE product_name = $2 AND batch_number = $3`,
          [challan.quantity, challan.product, challan.batch_no || "0"],
        );

        // Update Sale quantities and status
        const saleRes = await db.query("SELECT * FROM sales WHERE id = $1", [
          challan.sales_id,
        ]);
        if (saleRes.rows.length > 0) {
          const sale = saleRes.rows[0];
          const newDelivered = Math.max(
            0,
            Number(sale.delivered_qty || 0) - Number(challan.quantity),
          );
          const newPending =
            Number(sale.pending_qty || 0) + Number(challan.quantity);
          let newStatus = "Pending";
          if (newDelivered >= Number(sale.ordered_qty)) {
            newStatus = "Delivered";
          } else if (newDelivered > 0) {
            newStatus = "Partial";
          }
          await db.query(
            "UPDATE sales SET delivered_qty = $1, pending_qty = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4",
            [newDelivered, newPending, newStatus, sale.id],
          );
        }
      }

      await db.query("DELETE FROM challans WHERE id = $1", [id]);
    }

    await db.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

// --- Clients ---
app.get("/api/clients", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM clients ORDER BY name ASC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/clients", async (req, res) => {
  const { name, name_gujarati, nameGujarati, phone, price_category } = req.body;
  const nameTrimmed = name ? String(name).trim() : "";
  const nameGujaratiTrimmed = (name_gujarati || nameGujarati) ? String(name_gujarati || nameGujarati).trim() : null;
  const phoneTrimmed = phone ? String(phone).trim() : "";

  if (!nameTrimmed) {
    return res.status(400).json({ error: "Client name is required" });
  }

  try {
    // Check duplicate name
    const existingName = await db.query(
      "SELECT id, name FROM clients WHERE LOWER(TRIM(name)) = LOWER($1)",
      [nameTrimmed]
    );
    if (existingName.rows.length > 0) {
      return res.status(400).json({ error: `Client "${nameTrimmed}" already exists in DB` });
    }

    // Check duplicate phone
    if (phoneTrimmed) {
      const existingPhone = await db.query(
        "SELECT id, name FROM clients WHERE TRIM(phone) = $1",
        [phoneTrimmed]
      );
      if (existingPhone.rows.length > 0) {
        return res.status(400).json({
          error: `Phone number "${phoneTrimmed}" is already registered to "${existingPhone.rows[0].name}"`,
        });
      }
    }

    const result = await db.query(
      "INSERT INTO clients (name, name_gujarati, phone, price_category) VALUES ($1, $2, $3, $4) RETURNING *",
      [nameTrimmed, nameGujaratiTrimmed, phoneTrimmed, price_category || "Regular"],
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/clients/bulk", async (req, res) => {
  const clients = req.body;
  if (!Array.isArray(clients) || clients.length === 0) {
    return res.status(400).json({ error: "No client data provided" });
  }
  try {
    await db.query("BEGIN");

    // Fetch existing clients to check for duplicate names and phone numbers
    const existingDbClients = await db.query(
      "SELECT id, name, phone FROM clients"
    );

    const existingNames = new Map(); // nameLower -> row
    const existingPhones = new Map(); // phoneTrimmed -> row

    for (const row of existingDbClients.rows) {
      if (row.name) existingNames.set(row.name.trim().toLowerCase(), row);
      if (row.phone && row.phone.trim()) existingPhones.set(row.phone.trim(), row);
    }

    const inserted = [];
    const skipped = [];

    for (const c of clients) {
      const nameTrimmed = c.name ? String(c.name).trim() : "";
      const phoneTrimmed = c.phone ? String(c.phone).trim() : "";
      const nameGujaratiTrimmed = (c.name_gujarati || c.nameGujarati) ? String(c.name_gujarati || c.nameGujarati).trim() : null;
      const nameLower = nameTrimmed.toLowerCase();

      if (!nameTrimmed) {
        skipped.push({ ...c, reason: "Missing client name" });
        continue;
      }

      const nameMatch = existingNames.get(nameLower);
      const phoneMatch = phoneTrimmed ? existingPhones.get(phoneTrimmed) : null;

      if (nameMatch && phoneMatch) {
        const phoneOwner = phoneMatch.name;
        const reason = phoneOwner.toLowerCase() !== nameLower
          ? `Name & Phone exist (Phone used by "${phoneOwner}")`
          : `Client "${nameTrimmed}" already exists in DB`;
        skipped.push({ ...c, reason });
        continue;
      }

      if (nameMatch) {
        skipped.push({ ...c, reason: `Client name "${nameTrimmed}" already exists in DB` });
        continue;
      }

      if (phoneMatch) {
        skipped.push({ ...c, reason: `Phone number "${phoneTrimmed}" already belongs to "${phoneMatch.name}"` });
        continue;
      }

      const result = await db.query(
        `INSERT INTO clients (name, name_gujarati, phone, price_category)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [
          nameTrimmed,
          nameGujaratiTrimmed,
          phoneTrimmed,
          c.price_category ? String(c.price_category).trim() : "Regular",
        ]
      );

      const newRow = result.rows[0];
      inserted.push(newRow);
      existingNames.set(nameLower, newRow);
      if (phoneTrimmed) {
        existingPhones.set(phoneTrimmed, newRow);
      }
    }

    await db.query("COMMIT");
    res.json({
      success: true,
      count: inserted.length,
      skippedCount: skipped.length,
      clients: inserted,
      skipped,
    });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/clients/:id", async (req, res) => {
  const { id } = req.params;
  const { name, name_gujarati, nameGujarati, phone, price_category } = req.body;
  const nameTrimmed = name ? String(name).trim() : "";
  const nameGujaratiRaw = name_gujarati !== undefined ? name_gujarati : nameGujarati;
  const nameGujaratiTrimmed = nameGujaratiRaw !== undefined ? (nameGujaratiRaw ? String(nameGujaratiRaw).trim() : null) : undefined;
  const phoneTrimmed = phone ? String(phone).trim() : "";

  try {
    if (nameTrimmed) {
      const existingName = await db.query(
        "SELECT id, name FROM clients WHERE LOWER(TRIM(name)) = LOWER($1) AND id != $2",
        [nameTrimmed, id]
      );
      if (existingName.rows.length > 0) {
        return res.status(400).json({ error: `Another client named "${nameTrimmed}" already exists` });
      }
    }

    if (phoneTrimmed) {
      const existingPhone = await db.query(
        "SELECT id, name FROM clients WHERE TRIM(phone) = $1 AND id != $2",
        [phoneTrimmed, id]
      );
      if (existingPhone.rows.length > 0) {
        return res.status(400).json({
          error: `Phone number "${phoneTrimmed}" is already registered to "${existingPhone.rows[0].name}"`,
        });
      }
    }

    let result;
    if (nameGujaratiTrimmed !== undefined) {
      result = await db.query(
        "UPDATE clients SET name = $1, name_gujarati = $2, phone = $3, price_category = $4 WHERE id = $5 RETURNING *",
        [nameTrimmed, nameGujaratiTrimmed, phoneTrimmed, price_category, id],
      );
    } else {
      result = await db.query(
        "UPDATE clients SET name = $1, phone = $2, price_category = $3 WHERE id = $4 RETURNING *",
        [nameTrimmed, phoneTrimmed, price_category, id],
      );
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/clients/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM clients WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Users ---
app.get("/api/users", async (req, res) => {
  try {
    const result = await db.query("SELECT id, name, role, email FROM users");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/users", async (req, res) => {
  const { name, role, email, password } = req.body;
  try {
    const result = await db.query(
      "INSERT INTO users (name, role, email, password) VALUES ($1, $2, $3, $4) RETURNING id, name, role, email",
      [name, role, email, password],
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/users/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM users WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Holds ---
app.get("/api/holds", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM holds ORDER BY hold_date DESC",
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/holds", async (req, res) => {
  const {
    client_name,
    client_phone,
    product_name,
    category,
    quantity,
    batch_no,
    hold_date,
  } = req.body;
  try {
    await db.query("BEGIN");

    const result = await db.query(
      `INSERT INTO holds (client_name, client_phone, product_name, category, quantity, batch_no, hold_date) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        client_name,
        client_phone,
        product_name,
        category,
        quantity,
        batch_no,
        hold_date || new Date().toISOString().split("T")[0],
      ],
    );

    // Calculate held quantity based on available stock without modifying batches table
    let bQuery =
      "SELECT id, batch_number, available_qty FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))";
    let bParams = [product_name];
    if (batch_no && batch_no !== "0") {
      bQuery += " AND LOWER(TRIM(batch_number)) = LOWER(TRIM($2))";
      bParams.push(batch_no);
    }
    bQuery += " AND available_qty > 0 ORDER BY date ASC";

    const batchesResult = await db.query(bQuery, bParams);
    let remainingToHold = quantity;
    let lastBatchNo = batch_no;

    for (const b of batchesResult.rows) {
      if (remainingToHold <= 0) break;
      const canHold = Math.min(remainingToHold, b.available_qty);
      remainingToHold -= canHold;
      lastBatchNo = b.batch_number;
    }

    const totalHeld = quantity - remainingToHold;

    // Deduct available stock immediately
    const actualBatchNo = await deductStock(
      product_name,
      batch_no || "0",
      quantity,
      "Available",
    );

    // Increase hold_qty in batches
    await db.query(
      `UPDATE batches SET hold_qty = COALESCE(hold_qty, 0) + $1 WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($2)) AND (LOWER(TRIM(batch_number)) = LOWER(TRIM($3)) OR $3 = '0' OR $3 = '')`,
      [quantity, product_name, actualBatchNo || batch_no || "0"],
    );

    await db.query(
      "UPDATE holds SET held_qty = $1, batch_no = $2 WHERE id = $3",
      [totalHeld, actualBatchNo || batch_no, result.rows[0].id],
    );
    result.rows[0].held_qty = totalHeld;
    result.rows[0].batch_no = actualBatchNo || batch_no;

    await db.query("COMMIT");
    res.json(result.rows[0]);
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/holds/cancel/:id", async (req, res) => {
  const { id } = req.params;
  const ids = id.split(",");
  try {
    await db.query("BEGIN");

    const holdRes = await db.query("SELECT * FROM holds WHERE id = ANY($1)", [
      ids,
    ]);
    if (holdRes.rows.length > 0) {
      for (const hold of holdRes.rows) {
        const qtyToRestore = Number(hold.quantity || 0);
        const prod = hold.product_name;
        const bNo = hold.batch_no || "0";

        // Revert hold_qty and restore available_qty in batches
        await db.query(
          `UPDATE batches SET 
             hold_qty = GREATEST(0, COALESCE(hold_qty, 0) - $1)
           WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($2)) AND (LOWER(TRIM(batch_number)) = LOWER(TRIM($3)) OR $3 = '0' OR $3 = '')`,
          [qtyToRestore, prod, bNo],
        );
        await restoreStock(prod, bNo, qtyToRestore, "Available");
      }

      await db.query("DELETE FROM holds WHERE id = ANY($1)", [ids]);
    }

    await db.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/holds/:id", async (req, res) => {
  const { id } = req.params;
  const ids = id.split(",");
  try {
    await db.query("BEGIN");

    const holdRes = await db.query("SELECT * FROM holds WHERE id = ANY($1)", [
      ids,
    ]);
    if (holdRes.rows.length > 0) {
      const holdsToRelease = holdRes.rows;

      // Generate one order number for all released items
      const orderNum = `ORD-${Date.now().toString(36).toUpperCase()}`;

      // Check if we need to generate CH- or P- challan numbers
      let hasCH = false;
      let hasP = false;

      const itemsDetails = holdsToRelease.map((hold) => {
        const heldQty =
          hold.held_qty !== null && hold.held_qty !== undefined
            ? Number(hold.held_qty)
            : Number(hold.quantity);
        const pendingQty = Math.max(0, Number(hold.quantity) - heldQty);

        if (heldQty > 0) hasCH = true;
        if (pendingQty > 0) hasP = true;

        return {
          hold,
          heldQty,
          pendingQty,
        };
      });

      let challanNum = null;
      let pChallanNum = null;

      if (hasCH) {
        challanNum = await getNextChallanNumber("CH-");
      }
      if (hasP) {
        pChallanNum = await getNextChallanNumber("P-");
      }

      for (const details of itemsDetails) {
        const { hold, heldQty, pendingQty } = details;
        const quantityVal = Number(hold.quantity || 0);

        // Subtract hold_qty from batches since hold is released into sales
        await db.query(
          `UPDATE batches SET hold_qty = GREATEST(0, COALESCE(hold_qty, 0) - $1) WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($2)) AND (LOWER(TRIM(batch_number)) = LOWER(TRIM($3)) OR $3 = '0' OR $3 = '')`,
          [quantityVal, hold.product_name, hold.batch_no || "0"],
        );

        // Insert into sales table sharing the same order number
        const saleInsertRes = await db.query(
          `INSERT INTO sales 
          (order_no, customer, client_phone, product, category, ordered_qty, delivered_qty, pending_qty, rate, "GST", total_price, order_date, value_category, batch_no, remarks, status, stock_category, damage_qty, created_at, updated_at) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, 0, $9, 'Standard', $10, 'Release from stock', $11, 'Available', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
          [
            orderNum,
            hold.client_name,
            hold.client_phone,
            hold.product_name,
            hold.category || "Regular",
            quantityVal,
            0,
            quantityVal,
            hold.hold_date || new Date().toISOString().split("T")[0],
            hold.batch_no || "0",
            "Pending",
          ],
        );

        const createdSale = saleInsertRes.rows[0];

        // Insert into challans using the shared challan number
        if (heldQty > 0 && challanNum) {
          await db.query(
            `INSERT INTO challans 
            (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'Confirmed', CURRENT_DATE, 'Release from stock', 'Available', FALSE, FALSE, FALSE)`,
            [
              challanNum,
              createdSale.id,
              hold.client_name,
              hold.client_phone,
              hold.product_name,
              hold.batch_no || "0",
              heldQty,
            ],
          );
        }

        if (pendingQty > 0 && pChallanNum) {
          await db.query(
            `INSERT INTO challans 
            (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', CURRENT_DATE, 'Release from stock', 'Available', FALSE, FALSE, FALSE)`,
            [
              pChallanNum,
              createdSale.id,
              hold.client_name,
              hold.client_phone,
              hold.product_name,
              hold.batch_no || "0",
              pendingQty,
            ],
          );
        }
      }

      // Delete the holds
      await db.query("DELETE FROM holds WHERE id = ANY($1)", [ids]);
    }

    await db.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  }
});

// Test database connection on startup
db.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("❌ Database connection failed:", err.message);
  } else {
    console.log("Connected to PostgreSQL at:", res.rows[0].now);
  }
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `❌ Port ${PORT} is already in use. Please stop the background process or kill port ${PORT}.`,
    );
  } else {
    console.error("❌ Server error:", err.message);
  }
});
