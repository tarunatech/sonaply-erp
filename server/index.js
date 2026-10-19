const express = require("express");
const cors = require("cors");
const compression = require("compression");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const db = require("./db");

const app = express();
app.use(compression());
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

ensureDeliveredAtColumn().catch(() => {});

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
  await db.query("ALTER TABLE challans ADD COLUMN IF NOT EXISTS bill_no TEXT");
  await db.query(
    "ALTER TABLE challans ADD COLUMN IF NOT EXISTS restored_qty INTEGER",
  );
  await db.query(
    "ALTER TABLE challans ADD COLUMN IF NOT EXISTS is_challan_generated BOOLEAN DEFAULT FALSE",
  );
  await db.query(
    "ALTER TABLE challans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
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

async function ensureOrderClassifiedColumns() {
  await db.query(
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS is_order BOOLEAN DEFAULT FALSE",
  );
  await db.query(
    "ALTER TABLE challans ADD COLUMN IF NOT EXISTS is_order BOOLEAN DEFAULT FALSE",
  );
}

ensureOrderClassifiedColumns().catch((err) => {
  console.error("Order classified column initialization failed:", err.message);
});

async function ensureDeliveryColumns() {
  try {
    await db.query("ALTER TABLE challans ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP");
    await db.query("ALTER TABLE challans ADD COLUMN IF NOT EXISTS delivery_date DATE");
    await db.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP");
    await db.query(`
      UPDATE challans 
      SET delivery_date = COALESCE(CAST(updated_at AS date), created_at),
          delivered_at = COALESCE(updated_at, CAST(created_at AS timestamp))
      WHERE status = 'Delivered' AND delivery_date IS NULL
    `);
  } catch (err) {
    console.error("Delivery columns initialization failed:", err.message);
  }
}

ensureDeliveryColumns().catch(() => {});

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

async function ensureChallanNotesTable() {
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
}

ensureChallanNotesTable().catch((err) => {
  console.error("Challan notes table initialization failed:", err.message);
});

async function cleanupZeroQtyChallans() {
  try {
    await db.query("DELETE FROM challans WHERE quantity <= 0");
  } catch (err) {
    console.error("Zero qty challan cleanup failed:", err.message);
  }
}

cleanupZeroQtyChallans().catch(() => {});

async function reconcilePendingChallans() {
  try {
    // 1. Delete duplicate P- draft challans for the same sales_id
    const duplicateP = await db.query(`
      SELECT sales_id, COUNT(*) as cnt
      FROM challans
      WHERE challan_no LIKE 'P-%' AND status = 'Pending' AND is_cancelled = FALSE AND sales_id IS NOT NULL
      GROUP BY sales_id
      HAVING COUNT(*) > 1
    `);
    for (const row of duplicateP.rows) {
      const pRows = await db.query(
        "SELECT id FROM challans WHERE sales_id = $1 AND challan_no LIKE 'P-%' AND status = 'Pending' AND is_cancelled = FALSE ORDER BY created_at ASC, id ASC",
        [row.sales_id],
      );
      for (let i = 1; i < pRows.rows.length; i++) {
        await db.query("DELETE FROM challans WHERE id = $1", [
          pRows.rows[i].id,
        ]);
      }
    }

    // 2. Clean up any P- challans (both Pending and Confirmed) if an active CH- challan already exists and covers the sale
    const activeCHs = await db.query(`
      SELECT sales_id, SUM(quantity) as ch_sum 
      FROM challans 
      WHERE (challan_no LIKE 'CH-%' OR challan_no LIKE 'CH%') AND is_cancelled = FALSE AND status != 'Delivered'
      GROUP BY sales_id
    `);
    for (const chRow of activeCHs.rows) {
      const saleRes = await db.query("SELECT * FROM sales WHERE id = $1", [
        chRow.sales_id,
      ]);
      if (saleRes.rows.length > 0) {
        const sale = saleRes.rows[0];
        const salePending = Number(
          sale.pending_qty !== undefined
            ? sale.pending_qty
            : Number(sale.ordered_qty || 0) - Number(sale.delivered_qty || 0),
        );
        const expectedShortage = Math.max(
          0,
          salePending - Number(chRow.ch_sum || 0),
        );
        if (expectedShortage === 0) {
          await db.query(
            "DELETE FROM challans WHERE sales_id = $1 AND challan_no LIKE 'P-%' AND status != 'Delivered'",
            [chRow.sales_id],
          );
        } else {
          await db.query(
            "UPDATE challans SET quantity = $1 WHERE sales_id = $2 AND challan_no LIKE 'P-%' AND status = 'Pending' AND is_cancelled = FALSE",
            [expectedShortage, chRow.sales_id],
          );
        }
      }
    }

    // 3. Ensure each active P- draft challan's quantity equals (sale.pending_qty - active_CH_qty)
    const pendingChallans = await db.query(`
      SELECT c.id, c.sales_id, c.quantity as p_qty, s.ordered_qty, s.delivered_qty, s.pending_qty
      FROM challans c
      JOIN sales s ON c.sales_id = s.id
      WHERE c.challan_no LIKE 'P-%' AND c.status = 'Pending' AND c.is_cancelled = FALSE
    `);

    for (const pc of pendingChallans.rows) {
      const chRes = await db.query(
        `
        SELECT COALESCE(SUM(quantity), 0) as ch_sum
        FROM challans
        WHERE sales_id = $1 AND (challan_no LIKE 'CH-%' OR challan_no LIKE 'CH%' OR status = 'Confirmed') AND status != 'Delivered' AND is_cancelled = FALSE
      `,
        [pc.sales_id],
      );
      const chSum = Number(chRes.rows[0].ch_sum || 0);
      const salePending = Number(
        pc.pending_qty !== undefined
          ? pc.pending_qty
          : Number(pc.ordered_qty || 0) - Number(pc.delivered_qty || 0),
      );
      const expectedShortage = Math.max(0, salePending - chSum);

      if (expectedShortage === 0) {
        // Order is fully covered by CH challan, delete the redundant P- draft challan
        await db.query("DELETE FROM challans WHERE id = $1", [pc.id]);
      } else if (Number(pc.p_qty) !== expectedShortage) {
        await db.query("UPDATE challans SET quantity = $1 WHERE id = $2", [
          expectedShortage,
          pc.id,
        ]);
      }
    }
  } catch (err) {
    console.error("Error in reconcilePendingChallans:", err.message);
  }
}

reconcilePendingChallans().catch(() => {});

async function fixMixedChallanStatuses() {
  try {
    const mixed = await db.query(`
      SELECT DISTINCT c1.challan_no 
      FROM challans c1 
      JOIN challans c2 ON c1.challan_no = c2.challan_no 
      WHERE c1.status = 'Delivered' AND c2.status != 'Delivered' AND c2.is_cancelled = FALSE
    `);
    for (const row of mixed.rows) {
      const newChallanNo = await getNextChallanNumber("CH-");
      await db.query(
        `
        UPDATE challans 
        SET challan_no = $1 
        WHERE challan_no = $2 AND status != 'Delivered' AND is_cancelled = FALSE
      `,
        [newChallanNo, row.challan_no],
      );
      console.log(
        `Separated active items from delivered challan ${row.challan_no} to new challan ${newChallanNo}`,
      );
    }
  } catch (err) {
    console.error("Mixed challan fix error:", err.message);
  }
}

fixMixedChallanStatuses().catch(() => {});

ensureChallanNotesTable().catch((err) => {
  console.error("Challan notes table initialization failed:", err.message);
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
  try {
    await db.query(
      "UPDATE batches SET batch_number = '0' WHERE batch_number IS NULL OR batch_number = '' OR TRIM(batch_number) = ''",
    );
    await db.query(
      "UPDATE purchases SET batch_number = '0' WHERE batch_number IS NULL OR batch_number = '' OR TRIM(batch_number) = ''",
    );
  } catch (e) {
    console.error("Batch setup check failed:", e.message);
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

// --- Challan Notes ---
app.get("/api/challan-notes", async (req, res) => {
  try {
    const { status } = req.query;
    let query = "SELECT * FROM challan_notes";
    const params = [];
    if (status) {
      params.push(status);
      query += " WHERE status = $1";
    }
    query += " ORDER BY created_at DESC";
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/challan-notes", async (req, res) => {
  const { note, createdBy, status = "Pending" } = req.body;
  if (!note || !note.trim()) {
    return res.status(400).json({ error: "Note content is required" });
  }
  try {
    const result = await db.query(
      `INSERT INTO challan_notes (note, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [note.trim(), status, createdBy || null],
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/challan-notes/:id", async (req, res) => {
  const { id } = req.params;
  const { status, note } = req.body;
  try {
    const fields = [];
    const values = [];
    let idx = 1;
    if (status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(status);
    }
    if (note !== undefined) {
      fields.push(`note = $${idx++}`);
      values.push(note.trim());
    }
    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const query = `UPDATE challan_notes SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`;
    const result = await db.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Note not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/challan-notes/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      "DELETE FROM challan_notes WHERE id = $1 RETURNING *",
      [id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Note not found" });
    }
    res.json({ success: true, deleted: result.rows[0] });
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
app.get("/api/batches/distinct-column-values", async (req, res) => {
  try {
    const { column, search } = req.query;
    const allowed = [
      "product_name",
      "category",
      "batch_number",
      "supplier",
      "description",
    ];
    if (!allowed.includes(column)) {
      return res.status(400).json({ error: "Invalid column" });
    }
    const values = [];
    let query = `SELECT ${column} as value, COUNT(*) as count FROM batches WHERE ${column} IS NOT NULL AND TRIM(${column}) != ''`;
    if (search && search.trim()) {
      values.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND LOWER(${column}) LIKE $1`;
    }
    query += ` GROUP BY ${column} ORDER BY ${column} ASC LIMIT 100`;
    const result = await db.query(query, values);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/batches", async (req, res) => {
  try {
    const {
      page,
      limit = 50,
      search,
      category,
      product,
      batch,
      minSold,
      maxSold,
      soldType,
      minAvailable,
      maxAvailable,
      availableType,
      minStockMaintain,
      maxStockMaintain,
      stockMaintainType,
      minHold,
      maxHold,
      holdType,
      minDisplay,
      maxDisplay,
      displayType,
      minDamage,
      maxDamage,
      damageType,
      description,
      updatedDate,
      stockStatus,
      isCancelled,
      isDeadStock,
      isNil,
      soldStartDate,
      soldEndDate,
    } = req.query;

    const finalSoldStartDate = soldStartDate
      ? String(soldStartDate).trim()
      : null;
    const finalSoldEndDate = soldEndDate
      ? String(soldEndDate).trim()
      : finalSoldStartDate
        ? finalSoldStartDate
        : null;
    const isPeriodFilter = Boolean(finalSoldStartDate && finalSoldEndDate);

    if (!page) {
      const nonPageConditions = [];
      const nonPageValues = [];
      if (category && category !== "all") {
        nonPageValues.push(category);
        nonPageConditions.push(
          `LOWER(batches.category) = LOWER($${nonPageValues.length})`,
        );
      }
      if (
        stockStatus === "not_in_next_folder" ||
        isNil === "true" ||
        isNil === true
      ) {
        nonPageConditions.push(`batches.is_nil = TRUE`);
      } else if (
        stockStatus === "dead_stock" ||
        isCancelled === "true" ||
        isCancelled === true
      ) {
        nonPageConditions.push(`batches.is_cancelled = TRUE`);
      } else if (
        stockStatus === "nil" ||
        isDeadStock === "true" ||
        isDeadStock === true
      ) {
        nonPageConditions.push(`batches.is_dead_stock = TRUE`);
      } else if (stockStatus === "regular") {
        nonPageConditions.push(
          `COALESCE(batches.is_cancelled, FALSE) = FALSE AND COALESCE(batches.is_dead_stock, FALSE) = FALSE AND COALESCE(batches.is_nil, FALSE) = FALSE`,
        );
      } else if (stockStatus === "active") {
        nonPageConditions.push(
          `(batches.status IS NULL OR LOWER(batches.status) = 'active')`,
        );
      } else if (stockStatus === "inactive") {
        nonPageConditions.push(`LOWER(batches.status) = 'inactive'`);
      }
      if (isPeriodFilter) {
        nonPageValues.push(finalSoldStartDate, finalSoldEndDate);
        const sStartIdx = nonPageValues.length - 1;
        const sEndIdx = nonPageValues.length;
        const whereStr =
          nonPageConditions.length > 0
            ? `WHERE ${nonPageConditions.join(" AND ")}`
            : "";
        const result = await db.query(
          `SELECT batches.*, COALESCE(ps.period_sold_qty, 0) as period_sold_qty, ps.period_sales_count, ps.period_sales_details
           FROM batches
           INNER JOIN (
             SELECT 
               LOWER(TRIM(s.product)) as s_product,
               LOWER(TRIM(COALESCE(s.batch_no, '0'))) as s_batch,
               SUM(s.ordered_qty) as period_sold_qty,
               COUNT(s.id) as period_sales_count,
               JSON_AGG(
                 JSON_BUILD_OBJECT(
                   'orderNo', s.order_no,
                   'customer', s.customer,
                   'clientPhone', s.client_phone,
                   'orderedQty', s.ordered_qty,
                   'deliveredQty', s.delivered_qty,
                   'pendingQty', s.pending_qty,
                   'orderDate', s.order_date,
                   'estimatedDeliveryDate', s.estimated_delivery_date,
                   'status', s.status,
                   'rate', s.rate,
                   'totalPrice', s.total_price,
                   'remarks', s.remarks
                 ) ORDER BY s.order_date DESC
               ) as period_sales_details
             FROM sales s
             WHERE s.status != 'Cancelled'
               AND (
                 (s.order_date >= $${sStartIdx} AND s.order_date <= $${sEndIdx})
                 OR (s.estimated_delivery_date IS NOT NULL AND s.estimated_delivery_date >= $${sStartIdx} AND s.estimated_delivery_date <= $${sEndIdx})
               )
             GROUP BY LOWER(TRIM(s.product)), LOWER(TRIM(COALESCE(s.batch_no, '0')))
           ) ps ON LOWER(TRIM(batches.product_name)) = ps.s_product 
               AND LOWER(TRIM(COALESCE(batches.batch_number, '0'))) = ps.s_batch
           ${whereStr}
           ORDER BY ps.period_sold_qty DESC, LOWER(batches.product_name) ASC, batches.date DESC, batches.id DESC`,
          nonPageValues,
        );
        return res.json(result.rows);
      }
      const whereStr =
        nonPageConditions.length > 0
          ? `WHERE ${nonPageConditions.join(" AND ")}`
          : "";
      const result = await db.query(
        `SELECT * FROM batches ${whereStr} ORDER BY date DESC, id DESC`,
        nonPageValues,
      );
      return res.json(result.rows);
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 50);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    const values = [];

    let joinClause = "";
    let selectFields = "batches.*";
    if (isPeriodFilter) {
      values.push(finalSoldStartDate);
      const sStartIdx = values.length;
      values.push(finalSoldEndDate);
      const sEndIdx = values.length;

      joinClause = `
        INNER JOIN (
          SELECT 
            LOWER(TRIM(s.product)) as s_product,
            LOWER(TRIM(COALESCE(s.batch_no, '0'))) as s_batch,
            SUM(s.ordered_qty) as period_sold_qty,
            COUNT(s.id) as period_sales_count,
            JSON_AGG(
              JSON_BUILD_OBJECT(
                'orderNo', s.order_no,
                'customer', s.customer,
                'clientPhone', s.client_phone,
                'orderedQty', s.ordered_qty,
                'deliveredQty', s.delivered_qty,
                'pendingQty', s.pending_qty,
                'orderDate', s.order_date,
                'estimatedDeliveryDate', s.estimated_delivery_date,
                'status', s.status,
                'rate', s.rate,
                'totalPrice', s.total_price,
                'remarks', s.remarks
              ) ORDER BY s.order_date DESC
            ) as period_sales_details
          FROM sales s
          WHERE s.status != 'Cancelled'
            AND (
              (s.order_date >= $${sStartIdx} AND s.order_date <= $${sEndIdx})
              OR (s.estimated_delivery_date IS NOT NULL AND s.estimated_delivery_date >= $${sStartIdx} AND s.estimated_delivery_date <= $${sEndIdx})
            )
          GROUP BY LOWER(TRIM(s.product)), LOWER(TRIM(COALESCE(s.batch_no, '0')))
        ) ps ON LOWER(TRIM(batches.product_name)) = ps.s_product 
            AND LOWER(TRIM(COALESCE(batches.batch_number, '0'))) = ps.s_batch
      `;
      selectFields =
        "batches.*, COALESCE(ps.period_sold_qty, 0) as period_sold_qty, ps.period_sales_count, ps.period_sales_details";
    }

    // Global category filter
    if (category && category !== "all") {
      values.push(category);
      conditions.push(`LOWER(category) = LOWER($${values.length})`);
    }

    // Global search filter
    if (search && search.trim()) {
      const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
      tokens.forEach((token) => {
        values.push(`%${token}%`);
        const idx = values.length;
        conditions.push(
          `(LOWER(COALESCE(product_name, '')) LIKE $${idx} OR LOWER(COALESCE(product_code, '')) LIKE $${idx} OR LOWER(COALESCE(batch_number, '')) LIKE $${idx} OR LOWER(COALESCE(category, '')) LIKE $${idx} OR LOWER(COALESCE(supplier, '')) LIKE $${idx} OR LOWER(COALESCE(description, '')) LIKE $${idx})`,
        );
      });
    }

    // Column Filters
    // 1. Product Name filter
    if (product && product.trim()) {
      values.push(`%${product.trim().toLowerCase()}%`);
      conditions.push(
        `LOWER(COALESCE(product_name, '')) LIKE $${values.length}`,
      );
    }

    // 2. Batch Number filter
    if (batch && batch.trim()) {
      values.push(`%${batch.trim().toLowerCase()}%`);
      conditions.push(
        `LOWER(COALESCE(batch_number, '')) LIKE $${values.length}`,
      );
    }

    // 3. Sold quantity filter
    const soldFormula = isPeriodFilter
      ? "COALESCE(ps.period_sold_qty, 0)"
      : "GREATEST(0, batches.quantity - batches.available_qty - COALESCE(batches.display_qty, 0) - COALESCE(batches.damage_qty, 0) - COALESCE(batches.hold_qty, 0))";
    if (soldType === ">0") {
      conditions.push(`${soldFormula} > 0`);
    } else if (soldType === "=0") {
      conditions.push(`${soldFormula} = 0`);
    } else if (soldType === "<0") {
      conditions.push(`${soldFormula} < 0`);
    } else {
      if (minSold !== undefined && minSold !== "") {
        values.push(Number(minSold) || 0);
        conditions.push(`${soldFormula} >= $${values.length}`);
      }
      if (maxSold !== undefined && maxSold !== "") {
        values.push(Number(maxSold) || 0);
        conditions.push(`${soldFormula} <= $${values.length}`);
      }
    }

    // 4. Available quantity filter
    if (availableType === ">0") {
      conditions.push(`available_qty > 0`);
    } else if (availableType === "=0") {
      conditions.push(`available_qty = 0`);
    } else if (availableType === "<0") {
      conditions.push(`available_qty < 0`);
    } else {
      if (minAvailable !== undefined && minAvailable !== "") {
        values.push(Number(minAvailable) || 0);
        conditions.push(`available_qty >= $${values.length}`);
      }
      if (maxAvailable !== undefined && maxAvailable !== "") {
        values.push(Number(maxAvailable) || 0);
        conditions.push(`available_qty <= $${values.length}`);
      }
    }

    // 5. Stock Maintain filter
    if (stockMaintainType === ">0") {
      conditions.push(`COALESCE(stock_maintain, 0) > 0`);
    } else if (stockMaintainType === "=0") {
      conditions.push(`COALESCE(stock_maintain, 0) = 0`);
    } else if (stockMaintainType === "<0") {
      conditions.push(`COALESCE(stock_maintain, 0) < 0`);
    } else {
      if (minStockMaintain !== undefined && minStockMaintain !== "") {
        values.push(Number(minStockMaintain) || 0);
        conditions.push(`COALESCE(stock_maintain, 0) >= $${values.length}`);
      }
      if (maxStockMaintain !== undefined && maxStockMaintain !== "") {
        values.push(Number(maxStockMaintain) || 0);
        conditions.push(`COALESCE(stock_maintain, 0) <= $${values.length}`);
      }
    }

    // 6. Hold quantity filter
    if (holdType === ">0") {
      conditions.push(`COALESCE(hold_qty, 0) > 0`);
    } else if (holdType === "=0") {
      conditions.push(`COALESCE(hold_qty, 0) = 0`);
    } else if (holdType === "<0") {
      conditions.push(`COALESCE(hold_qty, 0) < 0`);
    } else {
      if (minHold !== undefined && minHold !== "") {
        values.push(Number(minHold) || 0);
        conditions.push(`COALESCE(hold_qty, 0) >= $${values.length}`);
      }
      if (maxHold !== undefined && maxHold !== "") {
        values.push(Number(maxHold) || 0);
        conditions.push(`COALESCE(hold_qty, 0) <= $${values.length}`);
      }
    }

    // 7. Display quantity filter
    if (displayType === ">0") {
      conditions.push(`COALESCE(display_qty, 0) > 0`);
    } else if (displayType === "=0") {
      conditions.push(`COALESCE(display_qty, 0) = 0`);
    } else if (displayType === "<0") {
      conditions.push(`COALESCE(display_qty, 0) < 0`);
    } else {
      if (minDisplay !== undefined && minDisplay !== "") {
        values.push(Number(minDisplay) || 0);
        conditions.push(`COALESCE(display_qty, 0) >= $${values.length}`);
      }
      if (maxDisplay !== undefined && maxDisplay !== "") {
        values.push(Number(maxDisplay) || 0);
        conditions.push(`COALESCE(display_qty, 0) <= $${values.length}`);
      }
    }

    // 8. Damage quantity filter
    if (damageType === ">0") {
      conditions.push(`COALESCE(damage_qty, 0) > 0`);
    } else if (damageType === "=0") {
      conditions.push(`COALESCE(damage_qty, 0) = 0`);
    } else if (damageType === "<0") {
      conditions.push(`COALESCE(damage_qty, 0) < 0`);
    } else {
      if (minDamage !== undefined && minDamage !== "") {
        values.push(Number(minDamage) || 0);
        conditions.push(`COALESCE(damage_qty, 0) >= $${values.length}`);
      }
      if (maxDamage !== undefined && maxDamage !== "") {
        values.push(Number(maxDamage) || 0);
        conditions.push(`COALESCE(damage_qty, 0) <= $${values.length}`);
      }
    }

    // 9. Description filter
    if (description && description.trim()) {
      values.push(`%${description.trim().toLowerCase()}%`);
      conditions.push(
        `LOWER(COALESCE(description, '')) LIKE $${values.length}`,
      );
    }

    // 10. Updated Date filter
    if (updatedDate && updatedDate.trim()) {
      values.push(`%${updatedDate.trim().toLowerCase()}%`);
      const idx = values.length;
      conditions.push(
        `(TO_CHAR(date, 'YYYY-MM-DD') LIKE $${idx} OR TO_CHAR(date, 'DD Mon YYYY') ILIKE $${idx} OR TO_CHAR(date, 'DD-MM-YYYY') LIKE $${idx})`,
      );
    }

    // 11. Status flags (Not in Next Folder, Dead Stock, Nil, Regular, Active, Inactive)
    // In database schema & UI:
    // - is_nil = Not in next folder (Blue)
    // - is_cancelled = Dead Stock (Red)
    // - is_dead_stock = Nil Stock (Slate/Gray)
    if (
      stockStatus === "not_in_next_folder" ||
      isNil === "true" ||
      isNil === true
    ) {
      conditions.push(`batches.is_nil = TRUE`);
    } else if (
      stockStatus === "dead_stock" ||
      isCancelled === "true" ||
      isCancelled === true
    ) {
      conditions.push(`batches.is_cancelled = TRUE`);
    } else if (
      stockStatus === "nil" ||
      isDeadStock === "true" ||
      isDeadStock === true
    ) {
      conditions.push(`batches.is_dead_stock = TRUE`);
    } else if (stockStatus === "regular") {
      conditions.push(
        `COALESCE(batches.is_cancelled, FALSE) = FALSE AND COALESCE(batches.is_dead_stock, FALSE) = FALSE AND COALESCE(batches.is_nil, FALSE) = FALSE`,
      );
    } else if (stockStatus === "active") {
      conditions.push(
        `(batches.status IS NULL OR LOWER(batches.status) = 'active')`,
      );
    } else if (stockStatus === "inactive") {
      conditions.push(`LOWER(batches.status) = 'inactive'`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    let stats = {
      totalSales: 0,
      availableStock: 0,
      totalHold: 0,
      totalDisplay: 0,
      totalDamage: 0,
    };

    if (isPeriodFilter) {
      const statsQuery = await db.query(
        `SELECT 
          COALESCE(SUM(ps.period_sold_qty), 0) as total_sales,
          COALESCE(SUM(batches.available_qty), 0) as available_stock,
          COALESCE(SUM(batches.hold_qty), 0) as total_hold,
          COALESCE(SUM(batches.display_qty), 0) as total_display,
          COALESCE(SUM(batches.damage_qty), 0) as total_damage
        FROM batches
        ${joinClause}
        ${whereClause}`,
        values,
      );
      const statsRow = statsQuery.rows[0] || {};
      stats = {
        totalSales: Number(statsRow.total_sales || 0),
        availableStock: Number(statsRow.available_stock || 0),
        totalHold: Number(statsRow.total_hold || 0),
        totalDisplay: Number(statsRow.total_display || 0),
        totalDamage: Number(statsRow.total_damage || 0),
      };
    } else {
      const overallStatsQuery = await db.query(
        `
        SELECT 
          COALESCE(SUM(GREATEST(0, batches.quantity - batches.available_qty - COALESCE(batches.display_qty, 0) - COALESCE(batches.damage_qty, 0) - COALESCE(batches.hold_qty, 0))), 0) as total_sales,
          COALESCE(SUM(batches.available_qty), 0) as available_stock,
          COALESCE(SUM(batches.hold_qty), 0) as total_hold,
          COALESCE(SUM(batches.display_qty), 0) as total_display,
          COALESCE(SUM(batches.damage_qty), 0) as total_damage
        FROM batches
        ${whereClause}
      `,
        values,
      );
      const statsRow = overallStatsQuery.rows[0] || {};
      stats = {
        totalSales: Number(statsRow.total_sales || 0),
        availableStock: Number(statsRow.available_stock || 0),
        totalHold: Number(statsRow.total_hold || 0),
        totalDisplay: Number(statsRow.total_display || 0),
        totalDamage: Number(statsRow.total_damage || 0),
      };
    }

    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM batches ${joinClause} ${whereClause}`,
      values,
    );
    const total = parseInt(countResult.rows[0].total, 10) || 0;
    const totalPages = Math.ceil(total / limitNum) || 1;

    let orderByClause = isPeriodFilter
      ? "ORDER BY ps.period_sold_qty DESC, LOWER(batches.product_name) ASC, LOWER(batches.batch_number) ASC, batches.date DESC, batches.id DESC"
      : "ORDER BY LOWER(batches.product_name) ASC, LOWER(batches.batch_number) ASC, batches.date DESC, batches.id DESC";
    const dataValues = [...values];

    const searchTarget =
      (search && search.trim()) || (product && product.trim());

    if (searchTarget) {
      const sLower = searchTarget.trim().toLowerCase();
      const sCompact = sLower.replace(/\s+/g, "");
      const sTokens = sLower.split(/\s+/).filter(Boolean);

      dataValues.push(sLower);
      const exactIdx = dataValues.length;

      dataValues.push(sCompact);
      const compactIdx = dataValues.length;

      dataValues.push(`${sLower}%`);
      const prefixIdx = dataValues.length;

      dataValues.push(`${sCompact}%`);
      const compactPrefixIdx = dataValues.length;

      dataValues.push(`%${sLower}%`);
      const containsIdx = dataValues.length;

      dataValues.push(`%${sCompact}%`);
      const compactContainsIdx = dataValues.length;

      // Token conditions for product_name
      const tokenConditions = sTokens.map((tok) => {
        dataValues.push(`%${tok}%`);
        return `LOWER(COALESCE(product_name, '')) LIKE $${dataValues.length}`;
      });
      const tokensInProdCondition =
        tokenConditions.length > 0 ? tokenConditions.join(" AND ") : "FALSE";

      orderByClause = `ORDER BY 
        CASE 
          WHEN LOWER(TRIM(COALESCE(product_name, ''))) = $${exactIdx} OR REPLACE(LOWER(COALESCE(product_name, '')), ' ', '') = $${compactIdx} THEN 1
          WHEN LOWER(COALESCE(product_name, '')) LIKE $${prefixIdx} OR REPLACE(LOWER(COALESCE(product_name, '')), ' ', '') LIKE $${compactPrefixIdx} THEN 2
          WHEN LOWER(COALESCE(product_name, '')) LIKE $${containsIdx} OR REPLACE(LOWER(COALESCE(product_name, '')), ' ', '') LIKE $${compactContainsIdx} THEN 3
          WHEN ${tokensInProdCondition} THEN 4
          WHEN LOWER(TRIM(COALESCE(batch_number, ''))) = $${exactIdx} OR LOWER(TRIM(COALESCE(product_code, ''))) = $${exactIdx} THEN 5
          WHEN LOWER(COALESCE(batch_number, '')) LIKE $${prefixIdx} OR LOWER(COALESCE(product_code, '')) LIKE $${prefixIdx} THEN 6
          ELSE 7
        END ASC, LOWER(product_name) ASC, LOWER(batch_number) ASC, date DESC, id DESC`;
    }

    dataValues.push(limitNum);
    const limitIdx = dataValues.length;

    dataValues.push(offset);
    const offsetIdx = dataValues.length;

    const dataResult = await db.query(
      `SELECT ${selectFields} FROM batches ${joinClause} ${whereClause} ${orderByClause} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      dataValues,
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
    status,
  } = req.body;
  const productId = product_id === "" ? null : product_id;
  const displayQty =
    display_qty !== undefined
      ? display_qty
      : nil_qty !== undefined
        ? nil_qty
        : 0;
  const stockMaintain =
    stock_maintain !== undefined ? Number(stock_maintain) || 0 : 0;
  const batchStatus =
    status && String(status).trim() ? String(status).trim() : "Active";
  try {
    const result = await db.query(
      `INSERT INTO batches 
      (product_id, product_code, product_name, category, batch_number, supplier, quantity, rate, date, available_qty, damage_qty, display_qty, stock_maintain, description, status) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
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
        batchStatus,
      ],
    );

    // Auto-create product entry in products table if not present
    if (product_name && product_name.trim()) {
      await db.query(
        "INSERT INTO products (name, category, status) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM products WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)))",
        [product_name.trim(), category || "", batchStatus],
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
  if (!fields.date) {
    fields.date = new Date().toISOString().slice(0, 10);
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
    if (fields.status) {
      if (result.rows[0]?.product_id) {
        await db.query("UPDATE products SET status = $1 WHERE id = $2", [
          fields.status,
          result.rows[0].product_id,
        ]);
      }
      if (result.rows[0]?.product_name) {
        await db.query(
          "UPDATE products SET status = $1 WHERE LOWER(TRIM(name)) = LOWER(TRIM($2))",
          [fields.status, result.rows[0].product_name],
        );
        await db.query(
          "UPDATE batches SET status = $1, date = $2 WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($3))",
          [fields.status, fields.date, result.rows[0].product_name],
        );
      }
    }
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

function isValidUuid(id) {
  return (
    typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  );
}

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
  const finalRate = rate !== undefined && rate !== null ? rate : 0;
  const finalTotalAmount =
    total_amount !== undefined && total_amount !== null
      ? total_amount
      : Number(finalRate) * Number(quantity || 0);
  try {
    const createdPurchase = await db.withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO purchases (supplier_name, supplier_phone, product_name, category, quantity, rate, total_amount, batch_number, date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          supplier_name,
          supplier_phone,
          product_name,
          category,
          quantity,
          finalRate,
          finalTotalAmount,
          finalBatchNumber,
          date,
        ],
      );

      // Upsert stock in batches: select specific matching batch by ID to prevent quantity multiplication across duplicate lots
      const existingBatchRes = await client.query(
        "SELECT id FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1)) AND LOWER(TRIM(batch_number)) = LOWER(TRIM($2)) ORDER BY date DESC, id DESC LIMIT 1",
        [product_name, finalBatchNumber],
      );

      if (existingBatchRes.rows.length > 0) {
        await client.query(
          "UPDATE batches SET available_qty = available_qty + $1, quantity = quantity + $1 WHERE id = $2",
          [quantity, existingBatchRes.rows[0].id],
        );
      } else {
        // Create new batch if it doesn't exist
        await client.query(
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
      await resolveNegativeStock(product_name, client);

      return result.rows[0];
    });

    res.json(createdPurchase);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.put("/api/purchases/:id", async (req, res) => {
  const { id } = req.params;
  if (!isValidUuid(id)) {
    return res.status(404).json({ error: "Purchase not found" });
  }
  const fields = req.body;
  try {
    const txResult = await db.withTransaction(async (client) => {
      const purchaseRes = await client.query(
        "SELECT * FROM purchases WHERE id = $1",
        [id],
      );
      if (purchaseRes.rows.length === 0) {
        return { notFound: true };
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
      const newDate =
        fields.date !== undefined ? fields.date : oldPurchase.date;

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
        // 1. Revert old stock addition on single matching batch by ID
        if (oldPurchase.batch_number && oldPurchase.product_name) {
          const oldBatchRes = await client.query(
            "SELECT id FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1)) AND LOWER(TRIM(batch_number)) = LOWER(TRIM($2)) ORDER BY date DESC, id DESC LIMIT 1",
            [oldPurchase.product_name, oldPurchase.batch_number],
          );
          if (oldBatchRes.rows.length > 0) {
            await client.query(
              "UPDATE batches SET available_qty = available_qty - $1, quantity = quantity - $1 WHERE id = $2",
              [oldPurchase.quantity, oldBatchRes.rows[0].id],
            );
          }
        }

        // 2. Apply new stock addition on single matching batch by ID
        if (newBatch && newProduct) {
          const newBatchRes = await client.query(
            "SELECT id FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1)) AND LOWER(TRIM(batch_number)) = LOWER(TRIM($2)) ORDER BY date DESC, id DESC LIMIT 1",
            [newProduct, newBatch],
          );

          if (newBatchRes.rows.length > 0) {
            await client.query(
              "UPDATE batches SET available_qty = available_qty + $1, quantity = quantity + $1 WHERE id = $2",
              [newQty, newBatchRes.rows[0].id],
            );
          } else {
            await client.query(
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
      const result = await client.query(
        `UPDATE purchases SET ${setClause} WHERE id = $${values.length + 1} RETURNING *`,
        [...values, id],
      );

      // Resolve any negative stock across batches of this product
      await resolveNegativeStock(newProduct, client);

      return { row: result.rows[0] };
    });

    if (txResult.notFound) {
      return res.status(404).json({ error: "Purchase not found" });
    }
    res.json(txResult.row);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete("/api/purchases/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.withTransaction(async (client) => {
      const purchaseRes = await client.query(
        "SELECT * FROM purchases WHERE id = $1",
        [id],
      );
      if (purchaseRes.rows.length > 0) {
        const p = purchaseRes.rows[0];
        if (p.batch_number && p.product_name) {
          const targetBatchRes = await client.query(
            "SELECT id FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1)) AND LOWER(TRIM(batch_number)) = LOWER(TRIM($2)) ORDER BY date DESC, id DESC LIMIT 1",
            [p.product_name, p.batch_number],
          );
          if (targetBatchRes.rows.length > 0) {
            await client.query(
              "UPDATE batches SET available_qty = available_qty - $1, quantity = quantity - $1 WHERE id = $2",
              [p.quantity, targetBatchRes.rows[0].id],
            );
          }
        }
        await client.query("DELETE FROM purchases WHERE id = $1", [id]);
      }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// --- Helper for Challan Numbering ---
async function getNextChallanNumber(prefix = "CH-", client = null) {
  const q = client || db;
  try {
    await q.query("SELECT pg_advisory_xact_lock(987654321)");
  } catch (e) {
    // Continue if advisory lock is not supported or outside transaction
  }
  const result = await q.query(
    `SELECT challan_no FROM challans WHERE challan_no LIKE 'CH-%' OR challan_no LIKE 'P-%' OR challan_no LIKE 'CH%'`,
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
function isBatchSpecified(b) {
  if (b === undefined || b === null) return false;
  const str = String(b).trim();
  if (
    str === "" ||
    str.toLowerCase() === "null" ||
    str.toLowerCase() === "undefined"
  )
    return false;
  return true;
}

async function deductStock(
  productName,
  batchNo,
  quantityToDeduct,
  stockCategory,
  client = null,
) {
  const q = client || db;
  const qty = Number(quantityToDeduct || 0);
  const cleanProduct = (productName || "").trim();
  const specified = isBatchSpecified(batchNo);
  const cleanBatch = specified ? String(batchNo).trim() : null;

  if (qty <= 0 || !cleanProduct) return cleanBatch;

  let updateCol = "available_qty";
  if (stockCategory === "Damage") updateCol = "damage_qty";
  else if (stockCategory === "Display") updateCol = "display_qty";

  // 1. Try to find batches matching product and batch (if specified)
  let bQuery = `SELECT id, batch_number, "${updateCol}" FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))`;
  let bParams = [cleanProduct];
  if (specified) {
    bQuery += " AND LOWER(TRIM(batch_number)) = LOWER(TRIM($2))";
    bParams.push(cleanBatch);
  }
  bQuery += " ORDER BY date ASC, id ASC";

  const batchesResult = await q.query(bQuery, bParams);

  // If no matching batches exist, fail safely without creating unintended rows or phantom batches
  if (batchesResult.rows.length === 0) {
    if (specified) {
      const err = new Error(
        `Batch "${cleanBatch}" does not exist for product "${cleanProduct}".`,
      );
      err.statusCode = 400;
      throw err;
    } else {
      const err = new Error(
        `No stock batches found for product "${cleanProduct}".`,
      );
      err.statusCode = 400;
      throw err;
    }
  }

  let remainingToSell = qty;
  let lastBatchNo = cleanBatch;

  for (const b of batchesResult.rows) {
    if (remainingToSell <= 0) break;
    const availableInBatch = Number(b[updateCol] || 0);
    const canDeduct = Math.min(remainingToSell, availableInBatch);
    if (canDeduct > 0) {
      await q.query(
        `UPDATE batches SET "${updateCol}" = "${updateCol}" - $1 WHERE id = $2`,
        [canDeduct, b.id],
      );
      remainingToSell -= canDeduct;
    }
    lastBatchNo = b.batch_number;
  }

  // If remaining > 0 (insufficient stock), deduct from the first matching batch without stealing from other batches
  if (remainingToSell > 0) {
    const existingBatch = batchesResult.rows[0];
    if (existingBatch) {
      await q.query(
        `UPDATE batches SET "${updateCol}" = "${updateCol}" - $1 WHERE id = $2`,
        [remainingToSell, existingBatch.id],
      );
      lastBatchNo = existingBatch.batch_number;
    }
  }

  return lastBatchNo || cleanBatch || null;
}

async function restoreStock(
  productName,
  batchNo,
  quantityToRestore,
  stockCategory,
  client = null,
) {
  const q = client || db;
  const qty = Number(quantityToRestore || 0);
  const cleanProduct = (productName || "").trim();
  const cleanBatch = (batchNo || "0").trim();
  if (qty <= 0 || !cleanProduct) return;

  let updateCol = "available_qty";
  if (stockCategory === "Damage") updateCol = "damage_qty";
  else if (stockCategory === "Display") updateCol = "display_qty";

  // Find all batches matching product and batch number
  let checkBatch = await q.query(
    `SELECT id, quantity, "${updateCol}" FROM batches 
     WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1)) 
       AND LOWER(TRIM(COALESCE(NULLIF(batch_number, ''), '0'))) = LOWER(TRIM(COALESCE(NULLIF($2, ''), '0')))
     ORDER BY date ASC, id ASC`,
    [cleanProduct, cleanBatch],
  );

  if (checkBatch.rows.length === 1) {
    // Exactly one matching batch lot: update directly by ID
    await q.query(
      `UPDATE batches SET "${updateCol}" = "${updateCol}" + $1 WHERE id = $2`,
      [qty, checkBatch.rows[0].id],
    );
    await resolveNegativeStock(cleanProduct, client);
  } else if (checkBatch.rows.length > 1) {
    // Multiple lots share the same batch number: allocate to depleted lots in reverse date order
    let remainingToRestore = qty;
    const reversedLots = [...checkBatch.rows].reverse();
    for (const b of reversedLots) {
      if (remainingToRestore <= 0) break;
      const initialQty = Number(b.quantity || 0);
      const currentQty = Number(b[updateCol] || 0);
      const deficit = Math.max(0, initialQty - currentQty);
      if (deficit > 0) {
        const canRestore = Math.min(remainingToRestore, deficit);
        await q.query(
          `UPDATE batches SET "${updateCol}" = "${updateCol}" + $1 WHERE id = $2`,
          [canRestore, b.id],
        );
        remainingToRestore -= canRestore;
      }
    }
    // If surplus remaining, apply to latest lot by ID
    if (remainingToRestore > 0) {
      const targetLot = reversedLots[0];
      await q.query(
        `UPDATE batches SET "${updateCol}" = "${updateCol}" + $1 WHERE id = $2`,
        [remainingToRestore, targetLot.id],
      );
    }
    await resolveNegativeStock(cleanProduct, client);
  } else {
    const productLookup = await q.query(
      "SELECT category FROM products WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1",
      [cleanProduct],
    );
    const category =
      productLookup.rows.length > 0 ? productLookup.rows[0].category : "Other";
    await q.query(
      `INSERT INTO batches (product_name, category, batch_number, quantity, "${updateCol}", date) VALUES ($1, $2, $3, 0, $4, CURRENT_DATE)`,
      [cleanProduct, category, cleanBatch || "0", qty],
    );
  }
}

async function resolveNegativeStock(productName, client = null) {
  const q = client || db;
  const cleanProduct = (productName || "").trim();
  if (!cleanProduct) return;
  const cols = ["available_qty", "display_qty", "damage_qty"];

  for (const col of cols) {
    const negativeBatches = await q.query(
      `SELECT id, batch_number, "${col}" FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1)) AND "${col}" < 0 ORDER BY date ASC`,
      [cleanProduct],
    );

    if (negativeBatches.rows.length === 0) continue;

    for (const negBatch of negativeBatches.rows) {
      let needed = Math.abs(Number(negBatch[col]));
      if (needed <= 0) continue;

      const cleanBNo = (negBatch.batch_number || "0").trim();
      let posQuery = `SELECT id, "${col}" FROM batches 
                      WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1)) 
                        AND "${col}" > 0 
                        AND id != $2 
                        AND LOWER(TRIM(COALESCE(NULLIF(batch_number, ''), '0'))) = LOWER(TRIM(COALESCE(NULLIF($3, ''), '0')))
                      ORDER BY date ASC`;
      const positiveBatches = await q.query(posQuery, [
        cleanProduct,
        negBatch.id,
        cleanBNo,
      ]);

      for (const posBatch of positiveBatches.rows) {
        if (needed <= 0) break;
        const available = Number(posBatch[col]);
        const transfer = Math.min(needed, available);

        if (transfer > 0) {
          await q.query(
            `UPDATE batches SET "${col}" = "${col}" - $1 WHERE id = $2`,
            [transfer, posBatch.id],
          );
          await q.query(
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

async function reconcileAllProductStocks(productName, client = null) {
  const q = client || db;
  try {
    if (!productName || !productName.trim()) {
      return; // Safeguard against unbounded full-database scans
    }
    const cleanProduct = productName.trim();

    // 1. Fetch all batches for this product
    const pQuery =
      "SELECT id, product_name, batch_number, quantity, available_qty, display_qty, damage_qty, hold_qty FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1)) ORDER BY date ASC, id ASC";
    const allBatches = await q.query(pQuery, [cleanProduct]);
    if (allBatches.rows.length === 0) {
      return;
    }

    // Set of known batch numbers for this product (normalized)
    const existingBatchNumbers = new Set(
      allBatches.rows.map((b) =>
        isBatchSpecified(b.batch_number)
          ? String(b.batch_number).trim().toLowerCase()
          : "",
      ),
    );

    // 2. Fetch all active non-cancelled challans for Available stock
    const activeChallans = await q.query(
      `SELECT id, challan_no, batch_no, quantity, stock_category
       FROM challans
       WHERE LOWER(TRIM(product)) = LOWER(TRIM($1))
         AND is_cancelled = FALSE
         AND (stock_category IS NULL OR LOWER(TRIM(stock_category)) = 'available')`,
      [cleanProduct],
    );

    // 3. Fetch all active returns
    const activeReturns = await q.query(
      `SELECT id, batch_no, quantity
       FROM sales_returns
       WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))`,
      [cleanProduct],
    );

    // Check for ambiguity: if any active challan or return has an unspecified batch,
    // or a batch number that does not exist in inventory batches (e.g. batch "0" challans when only named lots exist):
    let isAmbiguous = false;
    for (const ch of activeChallans.rows) {
      const chBatch = isBatchSpecified(ch.batch_no)
        ? String(ch.batch_no).trim().toLowerCase()
        : null;
      if (!chBatch || !existingBatchNumbers.has(chBatch)) {
        isAmbiguous = true;
        break;
      }
    }

    if (!isAmbiguous) {
      for (const ret of activeReturns.rows) {
        const retBatch = isBatchSpecified(ret.batch_no)
          ? String(ret.batch_no).trim().toLowerCase()
          : null;
        if (!retBatch || !existingBatchNumbers.has(retBatch)) {
          isAmbiguous = true;
          break;
        }
      }
    }

    if (isAmbiguous) {
      console.warn(
        `[Reconcile] Ambiguous stock allocation detected for product "${cleanProduct}". Preserving existing stock balances without overwrite.`,
      );
      return;
    }

    // Group batches by normalized batch number
    const batchGroups = new Map();
    for (const b of allBatches.rows) {
      const bNo = isBatchSpecified(b.batch_number)
        ? String(b.batch_number).trim()
        : "";
      const normKey = bNo.toLowerCase();
      if (!batchGroups.has(normKey)) batchGroups.set(normKey, []);
      batchGroups.get(normKey).push(b);
    }

    for (const [normKey, lots] of batchGroups.entries()) {
      const bNo = lots[0].batch_number;

      // Sum all active (non-cancelled) challan quantities for this product & exact batch
      const activeChallansRes = await q.query(
        `SELECT COALESCE(SUM(quantity), 0) AS total_deducted
         FROM challans
         WHERE LOWER(TRIM(product)) = LOWER(TRIM($1))
           AND LOWER(TRIM(batch_no)) = LOWER(TRIM($2))
           AND is_cancelled = FALSE
           AND (stock_category IS NULL OR LOWER(TRIM(stock_category)) = 'available')`,
        [cleanProduct, bNo],
      );
      const totalDeducted = Number(
        activeChallansRes.rows[0].total_deducted || 0,
      );

      // Sum all sales return quantities for this product & exact batch
      const activeReturnsRes = await q.query(
        `SELECT COALESCE(SUM(quantity), 0) AS total_returned
         FROM sales_returns
         WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))
           AND LOWER(TRIM(batch_no)) = LOWER(TRIM($2))`,
        [cleanProduct, bNo],
      );
      const totalReturned = Number(
        activeReturnsRes.rows[0].total_returned || 0,
      );

      if (lots.length === 1) {
        const b = lots[0];
        const initialQty = Number(b.quantity || 0);
        const dispQty = Number(b.display_qty || 0);
        const dmgQty = Number(b.damage_qty || 0);
        const hldQty = Number(b.hold_qty || 0);

        const newAvail =
          initialQty -
          totalDeducted +
          totalReturned -
          dispQty -
          dmgQty -
          hldQty;
        await q.query("UPDATE batches SET available_qty = $1 WHERE id = $2", [
          newAvail,
          b.id,
        ]);
      } else {
        // Multi-lot FIFO deduction
        let remainingDeduct = totalDeducted;
        const deductions = new Map();
        for (const b of lots) {
          const initQ = Number(b.quantity || 0);
          const deduct = Math.min(remainingDeduct, initQ);
          deductions.set(b.id, deduct);
          remainingDeduct -= deduct;
        }
        if (remainingDeduct > 0) {
          deductions.set(
            lots[0].id,
            deductions.get(lots[0].id) + remainingDeduct,
          );
        }

        // Multi-lot LIFO return (to lots that had deductions)
        let remainingReturn = totalReturned;
        const returns = new Map();
        for (const b of lots) returns.set(b.id, 0);
        const reversedLots = [...lots].reverse();
        for (const b of reversedLots) {
          if (remainingReturn <= 0) break;
          const deductedFromB = deductions.get(b.id) || 0;
          const canReturn = Math.min(remainingReturn, deductedFromB);
          returns.set(b.id, (returns.get(b.id) || 0) + canReturn);
          remainingReturn -= canReturn;
        }
        if (remainingReturn > 0) {
          returns.set(
            reversedLots[0].id,
            (returns.get(reversedLots[0].id) || 0) + remainingReturn,
          );
        }

        for (const b of lots) {
          const initialQty = Number(b.quantity || 0);
          const dispQty = Number(b.display_qty || 0);
          const dmgQty = Number(b.damage_qty || 0);
          const hldQty = Number(b.hold_qty || 0);
          const deduct = deductions.get(b.id) || 0;
          const ret = returns.get(b.id) || 0;
          const newAvail =
            initialQty - deduct + ret - dispQty - dmgQty - hldQty;
          await q.query("UPDATE batches SET available_qty = $1 WHERE id = $2", [
            newAvail,
            b.id,
          ]);
        }
      }
    }
  } catch (err) {
    console.error("Error in reconcileAllProductStocks:", err.message);
    if (client) throw err;
  }
}

// --- Dashboard Stats ---
app.get("/api/dashboard/stats", async (req, res) => {
  try {
    const [
      totalStockRes,
      pendingRes,
      todaySalesRes,
      todayPurchasesRes,
      todayChallansRes,
      catDistRes,
      monthlyComparisonRes,
    ] = await Promise.all([
      db.query("SELECT COALESCE(SUM(available_qty), 0) as total FROM batches"),
      db.query(
        "SELECT COUNT(*) as count FROM sales WHERE status != 'Delivered' AND status != 'Cancelled' AND COALESCE(pending_qty, 0) > 0",
      ),
      db.query(
        "SELECT COALESCE(SUM(ordered_qty), 0) as total_qty, COALESCE(SUM(total_price), 0) as total_amount FROM sales WHERE order_date = CURRENT_DATE AND status != 'Cancelled'",
      ),
      db.query(
        "SELECT COALESCE(SUM(quantity), 0) as total_qty, COALESCE(SUM(total_amount), 0) as total_amount FROM purchases WHERE date = CURRENT_DATE",
      ),
      db.query(
        "SELECT COUNT(*) as count FROM challans WHERE created_at = CURRENT_DATE AND is_cancelled = FALSE",
      ),
      db.query(`
        SELECT category as name, COALESCE(SUM(quantity), 0) as value 
        FROM batches 
        WHERE category IS NOT NULL AND TRIM(category) != '' 
        GROUP BY category 
        HAVING SUM(quantity) > 0
        ORDER BY value DESC
      `),
      db.query(`
        WITH months AS (
          SELECT DISTINCT TO_CHAR(d, 'YYYY-MM') as month, DATE_TRUNC('month', d) as m_date
          FROM GENERATE_SERIES(
            CURRENT_DATE - INTERVAL '5 months',
            CURRENT_DATE,
            '1 month'::interval
          ) d
        ),
        monthly_sales AS (
          SELECT TO_CHAR(order_date, 'YYYY-MM') as month, COALESCE(SUM(ordered_qty), 0) as sales_qty
          FROM sales
          WHERE order_date IS NOT NULL AND status != 'Cancelled'
          GROUP BY TO_CHAR(order_date, 'YYYY-MM')
        ),
        monthly_purchases AS (
          SELECT TO_CHAR(date, 'YYYY-MM') as month, COALESCE(SUM(quantity), 0) as purchase_qty
          FROM purchases
          WHERE date IS NOT NULL
          GROUP BY TO_CHAR(date, 'YYYY-MM')
        )
        SELECT 
          months.month,
          COALESCE(s.sales_qty, 0)::integer as "salesQty",
          COALESCE(p.purchase_qty, 0)::integer as "purchaseQty"
        FROM months
        LEFT JOIN monthly_sales s ON months.month = s.month
        LEFT JOIN monthly_purchases p ON months.month = p.month
        ORDER BY months.m_date ASC
      `),
    ]);

    const todaySalesQty = Number(todaySalesRes.rows[0]?.total_qty || 0);
    const todaySalesAmount = Number(todaySalesRes.rows[0]?.total_amount || 0);
    const todayPurchasesQty = Number(todayPurchasesRes.rows[0]?.total_qty || 0);
    const todayPurchasesAmount = Number(todayPurchasesRes.rows[0]?.total_amount || 0);

    const monthlyComparison = monthlyComparisonRes.rows.map((r) => ({
      month: r.month,
      salesQty: Number(r.salesQty || 0),
      purchaseQty: Number(r.purchaseQty || 0),
      sales: Number(r.salesQty || 0),
      purchase: Number(r.purchaseQty || 0),
    }));

    res.json({
      totalStock: Number(totalStockRes.rows[0]?.total || 0),
      pendingDeliveries: Number(pendingRes.rows[0]?.count || 0),
      todaySalesQty,
      todayPurchasesQty,
      todaySales: todaySalesQty,
      todayPurchases: todayPurchasesQty,
      todaySalesAmount,
      todayPurchasesAmount,
      todayChallans: Number(todayChallansRes.rows[0]?.count || 0),
      catDist: catDistRes.rows.map((r) => ({
        name: r.name,
        value: Number(r.value),
      })),
      monthlyComparison,
      monthlySales: monthlyComparison,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Sales ---

app.get("/api/sales", async (req, res) => {
  try {
    const { pendingOnly } = req.query;
    let query = "SELECT * FROM sales";
    if (pendingOnly === "true") {
      query +=
        " WHERE status != 'Delivered' AND status != 'Cancelled' AND COALESCE(pending_qty, 0) > 0";
    }
    query += " ORDER BY order_date DESC, created_at DESC";
    const result = await db.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/sales/classify-order", async (req, res) => {
  const { orderNo, challanNo, salesIds, isOrder } = req.body;
  const isOrderBool = Boolean(isOrder);
  try {
    await db.withTransaction(async (client) => {
      if (salesIds && Array.isArray(salesIds) && salesIds.length > 0) {
        const validIds = salesIds.filter(Boolean);
        if (validIds.length > 0) {
          await client.query(
            "UPDATE sales SET is_order = $1 WHERE id = ANY($2::uuid[])",
            [isOrderBool, validIds],
          );
          await client.query(
            "UPDATE challans SET is_order = $1 WHERE sales_id = ANY($2::uuid[])",
            [isOrderBool, validIds],
          );
        }
      }
      if (orderNo) {
        await client.query(
          "UPDATE sales SET is_order = $1 WHERE order_no = $2",
          [isOrderBool, orderNo],
        );
        await client.query(
          "UPDATE challans SET is_order = $1 WHERE sales_id IN (SELECT id FROM sales WHERE order_no = $2)",
          [isOrderBool, orderNo],
        );
      }
      if (challanNo) {
        await client.query(
          "UPDATE challans SET is_order = $1 WHERE challan_no = $2",
          [isOrderBool, challanNo],
        );
        await client.query(
          "UPDATE sales SET is_order = $1 WHERE id IN (SELECT sales_id FROM challans WHERE challan_no = $2)",
          [isOrderBool, challanNo],
        );
      }
    });

    res.json({ success: true, isOrder: isOrderBool });
  } catch (err) {
    console.error("Failed to classify order:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Normalizes an array of sales items by merging duplicate lines that share the
 * same inventory identity (product name, batch number, stock category, and category).
 * Validates that quantities are valid positive numbers and ensures compatibility
 * of rate, GST, and other item-level fields.
 *
 * @param {Array} items - List of raw order items
 * @param {string} [orderCategory] - Fallback order-level category
 * @returns {Array} Normalized items with merged quantities
 */
function normalizeOrderItems(items, orderCategory = "Regular") {
  if (!items || !Array.isArray(items)) return [];

  const mergedMap = new Map();

  for (const item of items) {
    const rawProd = item.productName || item.product;
    if (!rawProd || typeof rawProd !== "string" || !rawProd.trim()) {
      const err = new Error("Product name is required for all items.");
      err.statusCode = 400;
      throw err;
    }
    const productName = rawProd.trim();

    const rawQty =
      item.quantity !== undefined ? item.quantity : item.ordered_qty;
    const q = Number(rawQty);
    if (
      rawQty === null ||
      rawQty === undefined ||
      rawQty === "" ||
      isNaN(q) ||
      !isFinite(q) ||
      q <= 0
    ) {
      const err = new Error(
        `Quantity must be a valid number greater than 0 for product "${productName}". Cannot sell 0 or negative quantity.`,
      );
      err.statusCode = 400;
      throw err;
    }

    const rawBatchNo =
      item.batchNo !== undefined ? item.batchNo : item.batch_no;
    const isSpecified = isBatchSpecified(rawBatchNo);
    const batchNo = isSpecified ? String(rawBatchNo).trim() : null;

    const stockCategory = (
      item.stockCategory ||
      item.stock_category ||
      "Available"
    ).trim();

    const itemCategory = (item.category || orderCategory || "Regular").trim();

    const rate = Number(item.rate || 0);
    const gst = Number(item.GST !== undefined ? item.GST : item.gst || 0);
    const damageQty = Number(
      item.damageQty !== undefined ? item.damageQty : item.damage_qty || 0,
    );
    const notes = (
      item.notes !== undefined ? item.notes : item.remarks || ""
    ).trim();

    // Inventory identity key: product (case-insensitive) + batch (case-insensitive) + stockCategory + category
    const identityKey = [
      productName.toLowerCase(),
      (batchNo || "0").toLowerCase(),
      stockCategory.toLowerCase(),
      itemCategory.toLowerCase(),
    ].join("||");

    if (mergedMap.has(identityKey)) {
      const existing = mergedMap.get(identityKey);

      // Verify compatibility of financial and classification fields
      if (Math.abs(existing.rate - rate) > 0.0001) {
        const err = new Error(
          `Cannot merge duplicate lines for "${productName}" (batch: ${batchNo || "unspecified"}) with conflicting rates (${existing.rate} vs ${rate}). Please resolve pricing before submitting.`,
        );
        err.statusCode = 400;
        throw err;
      }

      if (Math.abs(existing.GST - gst) > 0.0001) {
        const err = new Error(
          `Cannot merge duplicate lines for "${productName}" with conflicting GST rates (${existing.GST}% vs ${gst}%).`,
        );
        err.statusCode = 400;
        throw err;
      }

      // Merge quantities
      existing.quantity += q;
      existing.ordered_qty += q;
      if (!existing.salesId && item.salesId) existing.salesId = item.salesId;
      if (!existing.id && item.id) existing.id = item.id;
      if (stockCategory === "Damage") {
        existing.damageQty =
          (existing.damageQty || 0) + (damageQty > 0 ? damageQty : q);
        existing.damage_qty = existing.damageQty;
      }

      // Merge notes if distinct
      if (notes) {
        if (existing.notes && existing.notes !== notes) {
          existing.notes = `${existing.notes}; ${notes}`;
          existing.remarks = existing.notes;
        } else if (!existing.notes) {
          existing.notes = notes;
          existing.remarks = notes;
        }
      }
    } else {
      mergedMap.set(identityKey, {
        id: item.id,
        salesId: item.salesId,
        productName,
        product: productName,
        quantity: q,
        ordered_qty: q,
        batchNo,
        batch_no: batchNo,
        stockCategory,
        stock_category: stockCategory,
        category: itemCategory,
        rate,
        GST: gst,
        gst,
        damageQty:
          stockCategory === "Damage" ? (damageQty > 0 ? damageQty : q) : 0,
        damage_qty:
          stockCategory === "Damage" ? (damageQty > 0 ? damageQty : q) : 0,
        notes,
        remarks: notes,
      });
    }
  }

  return Array.from(mergedMap.values());
}

app.post("/api/sales/bulk", async (req, res) => {
  const {
    customer,
    clientPhone,
    orderDate,
    status,
    remarks,
    category,
    items: rawItems = [],
  } = req.body;

  const finalCustomer = customer ? customer.trim() : "";
  const finalClientPhone = clientPhone ? clientPhone.trim() : "";
  const finalOrderDate = orderDate || new Date().toISOString().split("T")[0];
  const finalRemarks = remarks || "";
  const finalStatus = status || "Pending";

  if (!rawItems || !Array.isArray(rawItems) || rawItems.length === 0) {
    return res
      .status(400)
      .json({ error: "At least one product item is required." });
  }

  let items;
  try {
    items = normalizeOrderItems(rawItems, category || "Regular");
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }

  if (items.length === 0) {
    return res
      .status(400)
      .json({ error: "At least one valid product item is required." });
  }

  try {
    const createdSales = await db.withTransaction(async (client) => {
      // 1. Automatically update or create client profile
      await client.query(
        "INSERT INTO clients (name, phone, price_category) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET phone = EXCLUDED.phone, price_category = EXCLUDED.price_category",
        [finalCustomer, finalClientPhone, category || "Regular"],
      );

      const orderNum = `ORD-${Date.now().toString(36).toUpperCase()}`;

      let challanNum = null;
      let pChallanNum = null;

      let hasCH = false;
      let hasP = false;

      const itemDetails = [];
      const runningStockMap = new Map();

      for (const item of items) {
        const finalProduct = item.productName;
        const rawBatchNo =
          item.batchNo !== undefined ? item.batchNo : item.batch_no;
        const isSpecified = isBatchSpecified(rawBatchNo);
        const finalBatchNo = isSpecified ? String(rawBatchNo).trim() : null;
        const finalOrderedQty = Number(item.quantity || 0);
        const finalStockCategory = item.stockCategory || "Available";

        let updateCol = "available_qty";
        if (finalStockCategory === "Damage") updateCol = "damage_qty";
        else if (finalStockCategory === "Display") updateCol = "display_qty";

        const poolKey = `${finalProduct.trim().toLowerCase()}||${(finalBatchNo || "0").trim().toLowerCase()}||${updateCol}`;

        let bQuery =
          "SELECT id, batch_number, available_qty, display_qty, damage_qty FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))";
        let bParams = [finalProduct];
        if (isSpecified) {
          bQuery += " AND LOWER(TRIM(batch_number)) = LOWER(TRIM($2))";
          bParams.push(finalBatchNo);
        }
        bQuery += " ORDER BY date ASC, id ASC";

        const batchesResult = await client.query(bQuery, bParams);

        let totalAvailable;
        if (runningStockMap.has(poolKey)) {
          totalAvailable = runningStockMap.get(poolKey);
        } else {
          totalAvailable = batchesResult.rows.reduce(
            (sum, b) => sum + Number(b[updateCol] || 0),
            0,
          );
        }

        const fulfillableQty = Math.min(
          finalOrderedQty,
          Math.max(0, totalAvailable),
        );
        const pendingRemaining = finalOrderedQty - fulfillableQty;

        runningStockMap.set(
          poolKey,
          Math.max(0, totalAvailable - fulfillableQty),
        );

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
          finalBatchNo,
        });
      }

      if (hasCH) {
        challanNum = await getNextChallanNumber("CH-", client);
      }
      if (hasP) {
        if (hasCH && challanNum) {
          pChallanNum = challanNum.replace(/^CH-?/, "P-");
        } else {
          pChallanNum = await getNextChallanNumber("P-", client);
        }
      }

      const salesList = [];

      for (const details of itemDetails) {
        const { item, fulfillableQty, pendingRemaining, finalBatchNo } =
          details;
        const finalProduct = item.productName;
        const finalOrderedQty = Number(item.quantity || 0);
        const finalStockCategory = item.stockCategory || "Available";
        const finalDamageQty = item.damageQty || 0;

        const finalRate = Number(item.rate || 0);
        const finalGST = Number(item.GST || 0);
        const totalPrice = finalOrderedQty * finalRate;

        // Deduct stock immediately
        const actualBatchNo = await deductStock(
          finalProduct,
          finalBatchNo,
          finalOrderedQty,
          finalStockCategory,
          client,
        );

        const saleInsertResult = await client.query(
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
            actualBatchNo || finalBatchNo || null,
            finalRemarks,
            finalStatus,
            finalStockCategory,
            finalDamageQty,
          ],
        );

        const createdSale = saleInsertResult.rows[0];
        salesList.push(createdSale);

        if (fulfillableQty > 0 && challanNum) {
          await client.query(
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
          await client.query(
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

      return salesList;
    });

    res.json(createdSales);
  } catch (err) {
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
  const rawBatchNo = batch_no !== undefined ? batch_no : batchNo;
  const isSpecified = isBatchSpecified(rawBatchNo);
  const finalBatchNo = isSpecified ? String(rawBatchNo).trim() : null;
  const finalStockCategory = stock_category;
  const finalDamageQty = Number(
    damage_qty !== undefined ? damage_qty : damageQty || 0,
  );
  const finalOrderDate = order_date || new Date().toISOString().slice(0, 10);

  try {
    const createdSale = await db.withTransaction(async (client) => {
      // 1. Automatically update or create client profile
      await client.query(
        "INSERT INTO clients (name, phone, price_category) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET phone = EXCLUDED.phone, price_category = EXCLUDED.price_category",
        [finalCustomer, finalClientPhone, category || "Regular"],
      );

      // 2. Check available stock to decide CH- vs P- prefix (NO deduction at sale creation)
      let bQuery =
        "SELECT id, batch_number, available_qty, display_qty, damage_qty FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))";
      let bParams = [finalProduct];
      if (isSpecified) {
        bQuery += " AND LOWER(TRIM(batch_number)) = LOWER(TRIM($2))";
        bParams.push(finalBatchNo);
      }
      bQuery += " ORDER BY date ASC, id ASC";

      const batchesResult = await client.query(bQuery, bParams);

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

      const pendingQty = finalOrderedQty; // always full qty pending until delivered
      const deliveredQty = 0; // never deduct at creation
      const finalStatus = "Confirmed";

      const orderNum = `ORD-${Date.now().toString(36).toUpperCase()}`;
      const totalPrice = finalOrderedQty * finalRate;

      // Deduct stock immediately
      const actualBatchNo = await deductStock(
        finalProduct,
        finalBatchNo,
        finalOrderedQty,
        finalStockCategory,
        client,
      );

      // 3. Insert Sales record
      const result = await client.query(
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
          actualBatchNo || finalBatchNo || null,
          finalRemarks,
          finalStatus,
          finalStockCategory,
          finalDamageQty,
        ],
      );

      const saleRow = result.rows[0];

      // 4. Create challan(s) based on stock availability
      //    - fulfillableQty > 0 → CH-xxxx (visible in ChallanPage, ready to confirm+deliver)
      //    - pendingRemaining > 0 → P-xxxx  (visible in PendingDeliveries, needs stock before delivery)
      let challanNum = null;
      if (fulfillableQty > 0) {
        challanNum = await getNextChallanNumber("CH-", client);
        await client.query(
          `INSERT INTO challans 
          (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'Confirmed', CURRENT_DATE, $8, $9, FALSE, FALSE, FALSE)`,
          [
            challanNum,
            saleRow.id,
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
        const pChallanNum = challanNum
          ? challanNum.replace(/^CH-?/, "P-")
          : await getNextChallanNumber("P-", client);
        await client.query(
          `INSERT INTO challans 
          (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', CURRENT_DATE, $8, $9, FALSE, FALSE, FALSE)`,
          [
            pChallanNum,
            saleRow.id,
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

      return saleRow;
    });

    res.json(createdSale);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/sales/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const updatedSale = await db.withTransaction(async (client) => {
      // Get existing sale record
      const saleRes = await client.query("SELECT * FROM sales WHERE id = $1", [
        id,
      ]);
      if (saleRes.rows.length === 0) {
        const err = new Error("Sale record not found");
        err.statusCode = 404;
        throw err;
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
          (req.body.product !== undefined &&
            req.body.product !== sale.product) ||
          (req.body.productName !== undefined &&
            req.body.productName !== sale.product) ||
          // Allow increasing qty but not decreasing below deliveredQty
          (newQtyFromBody !== null && newQtyFromBody < deliveredQty);

        if (isTryingToEditLocked) {
          const err = new Error(
            "Cannot edit product or customer on a fully delivered sale, and cannot reduce quantity below delivered amount.",
          );
          err.statusCode = 400;
          throw err;
        }

        // Handle quantity increase on a fully-delivered order
        if (
          newQtyFromBody !== null &&
          newQtyFromBody > Number(sale.ordered_qty)
        ) {
          const extraQty = newQtyFromBody - Number(sale.ordered_qty);
          await deductStock(
            sale.product,
            sale.batch_no,
            extraQty,
            sale.stock_category,
            client,
          );
          updates.ordered_qty = newQtyFromBody;
          updates.pending_qty = newQtyFromBody - deliveredQty;
          updates.status = "Partial";

          // Create a P-draft challan for the extra pending quantity
          const existingCH = await client.query(
            "SELECT challan_no FROM challans WHERE sales_id = $1 AND (challan_no LIKE 'CH-%' OR challan_no LIKE 'CH%') AND is_cancelled = FALSE ORDER BY id ASC LIMIT 1",
            [id],
          );
          const pChallanNum =
            existingCH.rows.length > 0
              ? existingCH.rows[0].challan_no.replace(/^CH-?/, "P-")
              : await getNextChallanNumber("P-", client);
          await client.query(
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
          (req.body.product !== undefined &&
            req.body.product !== sale.product) ||
          (req.body.productName !== undefined &&
            req.body.productName !== sale.product);

        if (isTryingToEditLocked) {
          const err = new Error(
            "Cannot edit customer or product on a partially delivered sale.",
          );
          err.statusCode = 400;
          throw err;
        }

        const newQty = newQtyFromBody;
        if (newQty !== null) {
          if (newQty < deliveredQty) {
            const err = new Error(
              `Quantity cannot be reduced below the delivered quantity (${deliveredQty}).`,
            );
            err.statusCode = 400;
            throw err;
          }

          const oldQty = Number(sale.ordered_qty);
          const diff = newQty - oldQty;
          if (diff > 0) {
            await deductStock(
              sale.product,
              sale.batch_no,
              diff,
              sale.stock_category,
              client,
            );
          } else if (diff < 0) {
            await restoreStock(
              sale.product,
              sale.batch_no,
              Math.abs(diff),
              sale.stock_category,
              client,
            );
          }

          updates.ordered_qty = newQty;
          updates.pending_qty = newQty - deliveredQty;
          updates.status = newQty === deliveredQty ? "Delivered" : "Partial";

          // Sync pending challans
          const newPending = newQty - deliveredQty;
          const pChallanRes = await client.query(
            "SELECT * FROM challans WHERE sales_id = $1 AND challan_no LIKE 'P-%' AND is_cancelled = FALSE AND status = 'Pending' LIMIT 1",
            [id],
          );
          if (pChallanRes.rows.length > 0) {
            const pChallan = pChallanRes.rows[0];
            if (newPending > 0) {
              await client.query(
                "UPDATE challans SET quantity = $1 WHERE id = $2",
                [newPending, pChallan.id],
              );
            } else {
              await client.query("DELETE FROM challans WHERE id = $1", [
                pChallan.id,
              ]);
            }
          } else if (newPending > 0) {
            const existingCH = await client.query(
              "SELECT challan_no FROM challans WHERE sales_id = $1 AND (challan_no LIKE 'CH-%' OR challan_no LIKE 'CH%') AND is_cancelled = FALSE ORDER BY id ASC LIMIT 1",
              [id],
            );
            const pChallanNum =
              existingCH.rows.length > 0
                ? existingCH.rows[0].challan_no.replace(/^CH-?/, "P-")
                : await getNextChallanNumber("P-", client);
            await client.query(
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
          (newStockCategory !== null &&
            newStockCategory !== sale.stock_category)
        ) {
          isInventoryChanged = true;
        }

        if (newQty !== null) {
          updates.ordered_qty = newQty;
          updates.pending_qty = newQty;
          if (
            sale.status === "Confirmed" ||
            sale.status === "Delivered" ||
            sale.status === "Partial"
          ) {
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
          const rawBatch =
            req.body.batch_no !== undefined
              ? req.body.batch_no
              : req.body.batchNo !== undefined
                ? req.body.batchNo
                : sale.batch_no;
          const finalBatch = isBatchSpecified(rawBatch)
            ? String(rawBatch).trim()
            : null;
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
            client,
          );

          // 2. Deduct new stock
          const actualBatchNo = await deductStock(
            finalProd,
            finalBatch,
            finalQty,
            finalStockCat,
            client,
          );
          updates.batch_no = actualBatchNo || finalBatch || null;

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

          const activeChallans = await client.query(
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

              await client.query(
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
                  await client.query(
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
                  await client.query("DELETE FROM challans WHERE id = $1", [
                    pCh.id,
                  ]);
                }
              }
            } else if (remainingQty > 0) {
              // No P-draft exists yet but there is extra qty (e.g. user increased ordered qty above CH fulfilled qty)
              // Create a new P-draft challan for the extra unhandled pending quantity
              const existingCH = await client.query(
                "SELECT challan_no FROM challans WHERE sales_id = $1 AND (challan_no LIKE 'CH-%' OR challan_no LIKE 'CH%') AND is_cancelled = FALSE ORDER BY id ASC LIMIT 1",
                [id],
              );
              const pChallanNum =
                existingCH.rows.length > 0
                  ? existingCH.rows[0].challan_no.replace(/^CH-?/, "P-")
                  : await getNextChallanNumber("P-", client);
              await client.query(
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
      if (
        req.body.damage_qty !== undefined ||
        req.body.damageQty !== undefined
      ) {
        updates.damage_qty =
          req.body.damage_qty !== undefined
            ? req.body.damage_qty
            : req.body.damageQty;
      }
      if (req.body.batch_no !== undefined || req.body.batchNo !== undefined) {
        const newBatchNo =
          req.body.batch_no !== undefined
            ? req.body.batch_no
            : req.body.batchNo;
        if (deliveredQty > 0 || !isInventoryChanged) {
          updates.batch_no = newBatchNo;
        }
      }
      if (req.body.status !== undefined) {
        const activeChallanRes = await client.query(
          "SELECT status FROM challans WHERE sales_id = $1 AND is_cancelled = FALSE ORDER BY created_at ASC LIMIT 1",
          [id],
        );
        const existingChallanStatus = activeChallanRes.rows[0]?.status;
        const currentEffectiveStatus = existingChallanStatus || sale.status;

        if (
          req.body.status !== "Pending" ||
          currentEffectiveStatus === "Pending"
        ) {
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
      if (req.body.is_order !== undefined || req.body.isOrder !== undefined) {
        const isOrderVal = Boolean(
          req.body.is_order !== undefined
            ? req.body.is_order
            : req.body.isOrder,
        );
        updates.is_order = isOrderVal;
        await client.query(
          "UPDATE challans SET is_order = $1 WHERE sales_id = $2",
          [isOrderVal, id],
        );
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
          await client.query(
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
        const result = await client.query(
          `UPDATE sales SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = $${values.length + 1} RETURNING *`,
          [...values, id],
        );
        return result.rows[0];
      } else {
        return sale;
      }
    });

    res.json(updatedSale);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/sales/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.withTransaction(async (client) => {
      // Fetch associated non-cancelled challans to restore their stock
      const challansRes = await client.query(
        "SELECT * FROM challans WHERE sales_id = $1 AND is_cancelled = FALSE",
        [id],
      );
      for (const item of challansRes.rows) {
        const stockCategory = item.stock_category || "Available";

        // 1. Get total returns for this client, product and batch
        const returnsRes = await client.query(
          `SELECT COALESCE(SUM(quantity), 0) AS total_returns 
           FROM sales_returns 
           WHERE client_name = $1 AND product_name = $2 AND batch_no = $3`,
          [item.customer, item.product, item.batch_no || "0"],
        );
        const totalReturns = Number(returnsRes.rows[0].total_returns || 0);

        // 2. Get total returns already applied to other cancelled challans
        const appliedRes = await client.query(
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

        if (restoreQty > 0) {
          await restoreStock(
            item.product,
            item.batch_no || "0",
            restoreQty,
            stockCategory,
            client,
          );
        }
      }

      // Delete associated challans first
      await client.query("DELETE FROM challans WHERE sales_id = $1", [id]);
      await client.query("DELETE FROM sales WHERE id = $1", [id]);
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Confirm a sale (Pending → Confirmed) — also updates its pending challan status
app.put("/api/sales/:id/confirm", async (req, res) => {
  const { id } = req.params;
  try {
    await db.withTransaction(async (client) => {
      const saleRes = await client.query("SELECT * FROM sales WHERE id = $1", [
        id,
      ]);
      if (saleRes.rows.length === 0) {
        const err = new Error("Sale not found");
        err.statusCode = 404;
        throw err;
      }
      const sale = saleRes.rows[0];
      if (sale.status !== "Pending") {
        const err = new Error(
          `Cannot confirm a sale with status: ${sale.status}`,
        );
        err.statusCode = 400;
        throw err;
      }
      await client.query(
        "UPDATE sales SET status = 'Confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [id],
      );
      // Also update associated pending challans to Confirmed and refresh updated_at
      await client.query(
        "UPDATE challans SET status = 'Confirmed', updated_at = CURRENT_TIMESTAMP WHERE sales_id = $1 AND status = 'Pending' AND is_cancelled = FALSE",
        [id],
      );
    });
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Deliver a sale directly from the Sales page — deducts stock via its pending/confirmed challan
app.put("/api/sales/:id/deliver", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.withTransaction(async (client) => {
      const saleRes = await client.query("SELECT * FROM sales WHERE id = $1", [
        id,
      ]);
      if (saleRes.rows.length === 0) {
        const err = new Error("Sale not found");
        err.statusCode = 404;
        throw err;
      }
      const sale = saleRes.rows[0];

      if (sale.status === "Delivered" || sale.status === "Cancelled") {
        const err = new Error(`Sale is already ${sale.status}.`);
        err.statusCode = 400;
        throw err;
      }

      // Find the first active (non-cancelled) challan for this sale
      const challanRes = await client.query(
        "SELECT * FROM challans WHERE sales_id = $1 AND is_cancelled = FALSE AND status != 'Delivered' ORDER BY created_at ASC LIMIT 1",
        [id],
      );

      if (challanRes.rows.length === 0) {
        const err = new Error(
          "No active challan found for this sale. Cannot deliver.",
        );
        err.statusCode = 404;
        throw err;
      }
      const challan = challanRes.rows[0];
      const quantityToDeliver = Number(challan.quantity);
      const stockCategory = challan.stock_category || "Available";
      const productName = challan.product;
      const batchNo = challan.batch_no;

      const lastBatchNo = batchNo;

      // Update Sale to Delivered
      const newDeliveredQty =
        Number(sale.delivered_qty || 0) + quantityToDeliver;
      const newPendingQty = Math.max(
        0,
        Number(sale.pending_qty || 0) - quantityToDeliver,
      );
      let newStatus =
        newDeliveredQty >= Number(sale.ordered_qty) ? "Delivered" : "Partial";

      await client.query(
        `UPDATE sales SET delivered_qty = $1, pending_qty = $2, status = $3, delivered_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
        [newDeliveredQty, newPendingQty, newStatus, id],
      );

      // Mark challan as Delivered
      await client.query(
        `UPDATE challans SET status = 'Delivered', batch_no = $1, delivered_at = CURRENT_TIMESTAMP, delivery_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [lastBatchNo || batchNo || "0", challan.id],
      );

      return { success: true, status: newStatus };
    });

    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
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
  const cleanBNo = (batch_no || "0").trim();
  try {
    const createdReturn = await db.withTransaction(async (client) => {
      const result = await client.query(
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

      if (qty > 0) {
        await restoreStock(product_name, cleanBNo, qty, "Available", client);
      }

      // Reconcile stock for this product so available_qty incorporates the sales return
      await reconcileAllProductStocks(product_name, client);
      await resolveNegativeStock(product_name, client);

      return result.rows[0];
    });

    res.json(createdReturn);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
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
    const updatedReturn = await db.withTransaction(async (client) => {
      // 1. Fetch existing return record
      const existingRes = await client.query(
        "SELECT * FROM sales_returns WHERE id = $1",
        [id],
      );
      if (existingRes.rows.length === 0) {
        const err = new Error("Sales return not found");
        err.statusCode = 404;
        throw err;
      }
      const oldReturn = existingRes.rows[0];
      const oldQty = Number(oldReturn.quantity || 0);
      const oldProduct = oldReturn.product_name;
      const oldBatch = isBatchSpecified(oldReturn.batch_no)
        ? String(oldReturn.batch_no).trim()
        : null;

      // 2. Revert the old return's stock restoration
      if (oldQty > 0) {
        await deductStock(oldProduct, oldBatch, oldQty, "Available", client);
      }

      // 3. Apply the new return's stock restoration
      const finalBatchNo =
        batch_no !== undefined ? batch_no : oldReturn.batch_no;
      const finalProduct = product_name || oldProduct;
      const cleanFinalBNo = (finalBatchNo || "0").trim();

      if (newQty > 0) {
        await restoreStock(
          finalProduct,
          cleanFinalBNo,
          newQty,
          "Available",
          client,
        );
      }

      // 4. Update the sales_returns table
      const result = await client.query(
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

      await reconcileAllProductStocks(finalProduct, client);
      if (oldProduct && oldProduct !== finalProduct) {
        await reconcileAllProductStocks(oldProduct, client);
      }
      await resolveNegativeStock(finalProduct, client);

      return result.rows[0];
    });

    res.json(updatedReturn);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete("/api/sales-returns/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.withTransaction(async (client) => {
      const existingRes = await client.query(
        "SELECT * FROM sales_returns WHERE id = $1",
        [id],
      );
      if (existingRes.rows.length === 0) {
        const err = new Error("Sales return not found");
        err.statusCode = 404;
        throw err;
      }
      const oldReturn = existingRes.rows[0];
      const oldQty = Number(oldReturn.quantity || 0);
      const oldProduct = oldReturn.product_name;
      const oldBatch = isBatchSpecified(oldReturn.batch_no)
        ? String(oldReturn.batch_no).trim()
        : null;

      // Deduct stock
      if (oldQty > 0) {
        await deductStock(oldProduct, oldBatch, oldQty, "Available", client);
      }

      await client.query("DELETE FROM sales_returns WHERE id = $1", [id]);
      await reconcileAllProductStocks(oldProduct, client);
    });
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
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
    const createdChallan = await db.withTransaction(async (client) => {
      // Get Sale info
      const saleRes = await client.query("SELECT * FROM sales WHERE id = $1", [
        sales_id,
      ]);
      if (saleRes.rows.length === 0) {
        const err = new Error("Sale record not found");
        err.statusCode = 404;
        throw err;
      }
      const sale = saleRes.rows[0];

      // Generate challan number: CH-xxxx for immediate, P-xxxx for pending
      let challanNo;
      if (status === "Pending") {
        const existingCH = await client.query(
          "SELECT challan_no FROM challans WHERE sales_id = $1 AND (challan_no LIKE 'CH-%' OR challan_no LIKE 'CH%') AND is_cancelled = FALSE ORDER BY id ASC LIMIT 1",
          [sales_id],
        );
        if (existingCH.rows.length > 0) {
          const candidate = existingCH.rows[0].challan_no.replace(/^CH-?/, "P-");
          const candidateExists = await client.query(
            "SELECT 1 FROM challans WHERE challan_no = $1 AND is_cancelled = FALSE",
            [candidate],
          );
          if (candidateExists.rows.length === 0) {
            challanNo = candidate;
          } else {
            challanNo = await getNextChallanNumber("P-", client);
          }
        } else {
          challanNo = await getNextChallanNumber("P-", client);
        }
      } else {
        challanNo = await getNextChallanNumber("CH-", client);
      }

      const result = await client.query(
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

      return result.rows[0];
    });

    res.json(createdChallan);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.put("/api/challans/deliver/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.withTransaction(async (client) => {
      // 1. Fetch Challan
      const challanRes = await client.query(
        "SELECT * FROM challans WHERE id = $1",
        [id],
      );
      if (challanRes.rows.length === 0) {
        const err = new Error("Challan not found");
        err.statusCode = 404;
        throw err;
      }
      const challan = challanRes.rows[0];

      if (challan.status !== "Pending" && challan.status !== "Confirmed") {
        const err = new Error("Challan is already delivered or cancelled.");
        err.statusCode = 400;
        throw err;
      }

      // 2. Fetch Sale
      const saleRes = await client.query("SELECT * FROM sales WHERE id = $1", [
        challan.sales_id,
      ]);
      if (saleRes.rows.length === 0) {
        const err = new Error("Associated Sale record not found.");
        err.statusCode = 404;
        throw err;
      }
      const sale = saleRes.rows[0];

      const quantityToDeliver = Number(challan.quantity || 0);
      if (quantityToDeliver <= 0) {
        await client.query("DELETE FROM challans WHERE id = $1", [id]);
        return { success: true, message: "Removed 0 quantity challan item" };
      }
      const stockCategory = challan.stock_category || "Available";
      const productName = challan.product;
      const batchNo = challan.batch_no;

      const lastBatchNo = batchNo;

      // 4. Update Sale quantities and status
      const newDeliveredQty =
        Number(sale.delivered_qty || 0) + quantityToDeliver;
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

      await client.query(
        `UPDATE sales 
         SET delivered_qty = $1, pending_qty = $2, status = $3, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $4`,
        [newDeliveredQty, newPendingQty, newStatus, sale.id],
      );

      // 5. Update Challan status to Delivered
      await client.query(
        `UPDATE challans SET status = 'Delivered', batch_no = $1 WHERE id = $2`,
        [lastBatchNo || batchNo || "0", id],
      );

      return { success: true };
    });

    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
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
    if (fields.bill_no !== undefined) allowedUpdates.bill_no = fields.bill_no;
    if (fields.billNo !== undefined) allowedUpdates.bill_no = fields.billNo;
    if (fields.is_challan_generated !== undefined)
      allowedUpdates.is_challan_generated = fields.is_challan_generated;
    if (fields.is_order !== undefined || fields.isOrder !== undefined) {
      const isOrderVal = Boolean(
        fields.is_order !== undefined ? fields.is_order : fields.isOrder,
      );
      allowedUpdates.is_order = isOrderVal;
      if (challan.sales_id) {
        await db.query("UPDATE sales SET is_order = $1 WHERE id = $2", [
          isOrderVal,
          challan.sales_id,
        ]);
      }
    }

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

async function handleOrderGroupUpdate(orderIdentifier, body, client) {
  let { customer, client_name, client_phone, date, items = [] } = body;
  const finalCustomer = customer || client_name;

  let salesRes = await client.query(
    "SELECT * FROM sales WHERE order_no = $1 AND status != 'Cancelled' ORDER BY created_at ASC, id ASC",
    [orderIdentifier],
  );

  if (salesRes.rows.length === 0) {
    const pChallanRes = await client.query(
      "SELECT DISTINCT sales_id FROM challans WHERE challan_no = $1 AND is_cancelled = FALSE",
      [orderIdentifier],
    );
    const salesIds = pChallanRes.rows.map((r) => r.sales_id).filter(Boolean);
    if (salesIds.length > 0) {
      salesRes = await client.query(
        "SELECT * FROM sales WHERE id = ANY($1::uuid[]) AND status != 'Cancelled' ORDER BY created_at ASC, id ASC",
        [salesIds],
      );
      if (salesRes.rows.length > 0 && salesRes.rows[0].order_no) {
        const fullOrderRes = await client.query(
          "SELECT * FROM sales WHERE order_no = $1 AND status != 'Cancelled' ORDER BY created_at ASC, id ASC",
          [salesRes.rows[0].order_no],
        );
        if (fullOrderRes.rows.length > 0) {
          salesRes = fullOrderRes;
        }
      }
    }
  }

  if (salesRes.rows.length === 0) {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        orderIdentifier,
      );
    if (isUuid) {
      const saleById = await client.query(
        "SELECT * FROM sales WHERE id = $1",
        [orderIdentifier],
      );
      if (saleById.rows.length > 0 && saleById.rows[0].order_no) {
        salesRes = await client.query(
          "SELECT * FROM sales WHERE order_no = $1 AND status != 'Cancelled' ORDER BY created_at ASC, id ASC",
          [saleById.rows[0].order_no],
        );
        if (salesRes.rows.length === 0) salesRes = saleById;
      }
    }
  }

  if (salesRes.rows.length === 0) {
    salesRes = await client.query(
      "SELECT * FROM sales WHERE order_no = $1 ORDER BY created_at ASC, id ASC",
      [orderIdentifier],
    );
  }

  if (salesRes.rows.length === 0) {
    const err = new Error("Sales order not found");
    err.statusCode = 404;
    throw err;
  }

  const existingSales = salesRes.rows;
  const parentOrderNo = existingSales[0].order_no || orderIdentifier;
  const parentCategory = existingSales[0].category || "Regular";

  if (!items || !Array.isArray(items) || items.length === 0) {
    const err = new Error("At least one product item is required.");
    err.statusCode = 400;
    throw err;
  }

  const normalizedItems = normalizeOrderItems(items, parentCategory);
  if (normalizedItems.length === 0) {
    const err = new Error("At least one valid product item is required.");
    err.statusCode = 400;
    throw err;
  }

  const finalPhone =
    client_phone !== undefined
      ? client_phone
      : existingSales[0].client_phone || "";
  const finalDate =
    date || existingSales[0].order_date || new Date().toISOString().slice(0, 10);

  if (finalCustomer) {
    await client.query(
      "INSERT INTO clients (name, phone, price_category) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET phone = COALESCE(NULLIF(EXCLUDED.phone, ''), clients.phone), price_category = EXCLUDED.price_category",
      [finalCustomer, finalPhone, parentCategory],
    );
  }

  const salesIds = existingSales.map((s) => s.id);
  const allLinkedChallansRes = await client.query(
    "SELECT * FROM challans WHERE sales_id = ANY($1::uuid[]) AND is_cancelled = FALSE ORDER BY created_at ASC, id ASC",
    [salesIds],
  );
  const allLinkedChallans = allLinkedChallansRes.rows;

  const deliveredMap = new Map();
  for (const s of existingSales) {
    const deliveredChallans = allLinkedChallans.filter(
      (c) => c.sales_id === s.id && c.status === "Delivered",
    );
    const sumDelivered = deliveredChallans.reduce(
      (acc, c) => acc + Number(c.quantity || 0),
      0,
    );
    const actualDelivered = Math.max(
      sumDelivered,
      Number(s.delivered_qty || 0),
    );
    deliveredMap.set(s.id, actualDelivered);
  }

  // Validate quantities and product changes
  for (const item of normalizedItems) {
    const prodName = (item.productName || item.product || "").trim();
    let matchedSale = null;
    if (item.salesId) {
      matchedSale = existingSales.find((s) => s.id === item.salesId);
    } else if (item.id) {
      matchedSale = existingSales.find((s) => s.id === item.id);
    }
    if (!matchedSale) {
      matchedSale = existingSales.find(
        (s) =>
          (s.product || "").trim().toLowerCase() === prodName.toLowerCase(),
      );
    }

    if (matchedSale) {
      const deliveredQty = deliveredMap.get(matchedSale.id) || 0;
      const newQty = Number(item.quantity || 0);
      if (newQty < deliveredQty) {
        const err = new Error(
          `Quantity cannot be reduced below the delivered quantity (${deliveredQty}) for ${matchedSale.product}.`,
        );
        err.statusCode = 400;
        throw err;
      }
      if (
        deliveredQty > 0 &&
        prodName.toLowerCase() !==
          (matchedSale.product || "").trim().toLowerCase()
      ) {
        const err = new Error(
          "Cannot change product name on a partially delivered item.",
        );
        err.statusCode = 400;
        throw err;
      }
    }
  }

  // Handle removed items
  const inputSalesIds = new Set();
  const inputProducts = new Set();
  for (const it of normalizedItems) {
    if (it.salesId) inputSalesIds.add(it.salesId);
    if (it.id) inputSalesIds.add(it.id);
    const pName = (it.productName || it.product || "").trim().toLowerCase();
    if (pName) inputProducts.add(pName);
  }

  const updatedSales = [];

  for (const s of existingSales) {
    const pName = (s.product || "").trim().toLowerCase();
    const isKept = inputSalesIds.has(s.id) || inputProducts.has(pName);
    if (!isKept) {
      if (typeof orderIdentifier === "string" && orderIdentifier.startsWith("P-")) {
        const inThisPChallan = allLinkedChallans.some(
          (c) =>
            c.sales_id === s.id &&
            c.challan_no === orderIdentifier &&
            !c.is_cancelled,
        );
        if (!inThisPChallan) {
          // This sibling item was not part of this P- challan; preserve it unchanged.
          updatedSales.push(s);
          continue;
        }
      }
      const deliveredQty = deliveredMap.get(s.id) || 0;
      if (deliveredQty > 0) {
        const oldQty = Number(s.ordered_qty || 0);
        const unfulfilled = oldQty - deliveredQty;
        if (unfulfilled > 0) {
          await restoreStock(
            s.product,
            s.batch_no || "0",
            unfulfilled,
            s.stock_category || "Available",
            client,
          );
          await resolveNegativeStock(s.product, client);
        }
        await client.query(
          "DELETE FROM challans WHERE sales_id = $1 AND status != 'Delivered'",
          [s.id],
        );
        const updRes = await client.query(
          "UPDATE sales SET ordered_qty = $1, pending_qty = 0, status = 'Delivered', updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *",
          [deliveredQty, s.id],
        );
        updatedSales.push(updRes.rows[0]);
      } else {
        const oldQty = Number(s.ordered_qty || 0);
        if (oldQty > 0) {
          await restoreStock(
            s.product,
            s.batch_no || "0",
            oldQty,
            s.stock_category || "Available",
            client,
          );
          await resolveNegativeStock(s.product, client);
        }
        await client.query("DELETE FROM challans WHERE sales_id = $1", [s.id]);
        await client.query("DELETE FROM sales WHERE id = $1", [s.id]);
      }
    }
  }

  // Determine group CH- and P- numbers
  const existingCH =
    allLinkedChallans.find(
      (c) =>
        (c.challan_no.startsWith("CH-") || c.challan_no.startsWith("CH")) &&
        !c.is_cancelled &&
        c.status !== "Delivered",
    ) ||
    allLinkedChallans.find(
      (c) =>
        (c.challan_no.startsWith("CH-") || c.challan_no.startsWith("CH")) &&
        !c.is_cancelled,
    );
  let chGroupNum = existingCH ? existingCH.challan_no : null;

  const existingP = allLinkedChallans.find(
    (c) => c.challan_no.startsWith("P-") && !c.is_cancelled,
  );
  let pGroupNum = existingP ? existingP.challan_no : null;
  if (!pGroupNum) {
    pGroupNum = chGroupNum ? chGroupNum.replace(/^CH-?/, "P-") : null;
  }

  const runningStockMap = new Map();

  for (const item of normalizedItems) {
    const prodName = (item.productName || item.product || "").trim();
    if (!prodName) continue;

    const rawBatch =
      item.batchNo !== undefined ? item.batchNo : item.batch_no;
    const isSpecified = isBatchSpecified(rawBatch);
    const batchNo = isSpecified ? String(rawBatch).trim() : null;
    const stockCat =
      item.stockCategory || item.stock_category || "Available";
    const notes =
      item.notes !== undefined ? item.notes : item.remarks || "";
    const newRequestedQty = Number(item.quantity || 0);

    let matchedSale = null;
    if (item.salesId)
      matchedSale = existingSales.find((s) => s.id === item.salesId);
    else if (item.id)
      matchedSale = existingSales.find((s) => s.id === item.id);
    if (!matchedSale) {
      matchedSale = existingSales.find(
        (s) =>
          (s.product || "").trim().toLowerCase() === prodName.toLowerCase(),
      );
    }

    if (matchedSale) {
      const deliveredQty = deliveredMap.get(matchedSale.id) || 0;
      const oldOrderedQty = Number(matchedSale.ordered_qty || 0);
      const diff = newRequestedQty - oldOrderedQty;

      if (diff > 0) {
        await deductStock(
          prodName,
          batchNo || matchedSale.batch_no,
          diff,
          stockCat,
          client,
        );
      } else if (diff < 0) {
        await restoreStock(
          prodName,
          batchNo || matchedSale.batch_no,
          Math.abs(diff),
          stockCat,
          client,
        );
      }
      if (diff !== 0) {
        await resolveNegativeStock(prodName, client);
      }

      const newPendingQty = Math.max(0, newRequestedQty - deliveredQty);
      let newStatus = "Pending";
      if (newRequestedQty === deliveredQty) {
        newStatus = "Delivered";
      } else if (deliveredQty > 0) {
        newStatus = "Partial";
      }

      const rate = Number(matchedSale.rate || 0);
      const totalPrice = newRequestedQty * rate;

      const updateSaleRes = await client.query(
        `UPDATE sales SET 
          customer = $1, client_phone = $2, product = $3, 
          ordered_qty = $4, pending_qty = $5, total_price = $6, 
          batch_no = COALESCE($7, batch_no), stock_category = $8, 
          remarks = $9, status = $10, order_date = $11, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $12 RETURNING *`,
        [
          finalCustomer,
          finalPhone,
          prodName,
          newRequestedQty,
          newPendingQty,
          totalPrice,
          batchNo,
          stockCat,
          notes || matchedSale.remarks || "",
          newStatus,
          finalDate,
          matchedSale.id,
        ],
      );
      updatedSales.push(updateSaleRes.rows[0]);

      // Synchronize P- draft challan for this sale
      const activeCHForSale = await client.query(
        `SELECT COALESCE(SUM(quantity), 0) as ch_sum FROM challans 
         WHERE sales_id = $1 AND (challan_no LIKE 'CH-%' OR challan_no LIKE 'CH%') 
           AND is_cancelled = FALSE AND status != 'Delivered'`,
        [matchedSale.id],
      );
      const activeCHQty = Number(activeCHForSale.rows[0].ch_sum || 0);
      const unhandledPending = Math.max(0, newPendingQty - activeCHQty);

      const existingDraftP = await client.query(
        `SELECT * FROM challans 
         WHERE sales_id = $1 AND challan_no LIKE 'P-%' 
           AND is_cancelled = FALSE AND status = 'Pending' 
         ORDER BY created_at ASC, id ASC`,
        [matchedSale.id],
      );

      if (unhandledPending > 0) {
        if (!pGroupNum) {
          pGroupNum = await getNextChallanNumber("P-", client);
        }
        if (existingDraftP.rows.length > 0) {
          const primaryP = existingDraftP.rows[0];
          await client.query(
            `UPDATE challans SET 
              customer = $1, client_phone = $2, product = $3, 
              quantity = $4, notes = $5, stock_category = $6, 
              batch_no = COALESCE($7, batch_no), updated_at = CURRENT_TIMESTAMP 
             WHERE id = $8`,
            [
              finalCustomer,
              finalPhone,
              prodName,
              unhandledPending,
              notes,
              stockCat,
              batchNo,
              primaryP.id,
            ],
          );
          for (let d = 1; d < existingDraftP.rows.length; d++) {
            await client.query("DELETE FROM challans WHERE id = $1", [
              existingDraftP.rows[d].id,
            ]);
          }
        } else {
          await client.query(
            `INSERT INTO challans 
            (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', CURRENT_DATE, $8, $9, FALSE, FALSE, FALSE)`,
            [
              pGroupNum,
              matchedSale.id,
              finalCustomer,
              finalPhone,
              prodName,
              batchNo || matchedSale.batch_no || "0",
              unhandledPending,
              notes,
              stockCat,
            ],
          );
        }
      } else {
        for (const pRow of existingDraftP.rows) {
          await client.query("DELETE FROM challans WHERE id = $1", [pRow.id]);
        }
      }
    } else {
      // New item added (or re-added) to order: determine fulfillment from eligible available stock
      let updateCol = "available_qty";
      if (stockCat === "Damage") updateCol = "damage_qty";
      else if (stockCat === "Display") updateCol = "display_qty";

      const poolKey = `${prodName.trim().toLowerCase()}||${(batchNo || "0").trim().toLowerCase()}||${updateCol}`;

      let totalAvailable;
      if (runningStockMap.has(poolKey)) {
        totalAvailable = runningStockMap.get(poolKey);
      } else {
        let bQuery =
          "SELECT id, batch_number, available_qty, display_qty, damage_qty FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))";
        let bParams = [prodName];
        if (isSpecified) {
          bQuery += " AND LOWER(TRIM(batch_number)) = LOWER(TRIM($2))";
          bParams.push(batchNo);
        }
        bQuery += " ORDER BY date ASC, id ASC";

        const batchesResult = await client.query(bQuery, bParams);
        totalAvailable = batchesResult.rows.reduce(
          (sum, b) => sum + Number(b[updateCol] || 0),
          0,
        );
      }

      const fulfillableQty = Math.min(
        newRequestedQty,
        Math.max(0, totalAvailable),
      );
      const pendingRemaining = newRequestedQty - fulfillableQty;

      runningStockMap.set(
        poolKey,
        Math.max(0, totalAvailable - fulfillableQty),
      );

      // Deduct stock transactionally exactly once
      const actualBatchNo = await deductStock(
        prodName,
        batchNo,
        newRequestedQty,
        stockCat,
        client,
      );
      await resolveNegativeStock(prodName, client);

      const rate = Number(item.rate || 0);
      const GST = Number(item.GST || 0);
      const totalPrice = newRequestedQty * rate;

      let saleStatus = "Pending";
      if (pendingRemaining > 0 && fulfillableQty > 0) {
        saleStatus = "Partial";
      }

      const newSaleRes = await client.query(
        `INSERT INTO sales 
        (order_no, customer, client_phone, product, category, ordered_qty, delivered_qty, pending_qty, rate, "GST", total_price, order_date, value_category, batch_no, remarks, status, stock_category, damage_qty, created_at, updated_at) 
        VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, $11, 'Standard', $12, $13, $14, $15, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
        [
          parentOrderNo,
          finalCustomer,
          finalPhone,
          prodName,
          parentCategory,
          newRequestedQty,
          pendingRemaining,
          rate,
          GST,
          totalPrice,
          finalDate,
          actualBatchNo || batchNo || null,
          notes,
          saleStatus,
          stockCat,
        ],
      );
      const newSale = newSaleRes.rows[0];
      updatedSales.push(newSale);

      // Case A & B: Allocate fulfillable stock to active CH- challan
      if (fulfillableQty > 0) {
        if (!chGroupNum) {
          chGroupNum = await getNextChallanNumber("CH-", client);
        }
        await client.query(
          `INSERT INTO challans 
          (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', CURRENT_DATE, $8, $9, FALSE, FALSE, FALSE)`,
          [
            chGroupNum,
            newSale.id,
            finalCustomer,
            finalPhone,
            prodName,
            actualBatchNo || batchNo || "0",
            fulfillableQty,
            notes,
            stockCat,
          ],
        );
      }

      // Case B & C: Allocate unfulfilled remainder to P- pending challan
      if (pendingRemaining > 0) {
        if (!pGroupNum) {
          if (chGroupNum) {
            pGroupNum = chGroupNum.replace(/^CH-?/, "P-");
          } else {
            pGroupNum = await getNextChallanNumber("P-", client);
          }
        }
        await client.query(
          `INSERT INTO challans 
          (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', CURRENT_DATE, $8, $9, FALSE, FALSE, FALSE)`,
          [
            pGroupNum,
            newSale.id,
            finalCustomer,
            finalPhone,
            prodName,
            actualBatchNo || batchNo || "0",
            pendingRemaining,
            notes,
            stockCat,
          ],
        );
      }
    }
  }

  return { success: true, orderNo: parentOrderNo, items: updatedSales };
}

app.put("/api/orders/group/:orderNo", async (req, res) => {
  const { orderNo } = req.params;
  try {
    const result = await db.withTransaction(async (client) => {
      return await handleOrderGroupUpdate(orderNo, req.body, client);
    });
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.put("/api/challans/group/:challanNumber", async (req, res) => {
  let { challanNumber } = req.params;
  let { customer, client_name, client_phone, date, items = [] } = req.body;
  const finalCustomer = customer || client_name;
  try {
    const result = await db.withTransaction(async (client) => {
      // If challanNumber is an orderNo (ORD-), route to dedicated order update logic
      if (challanNumber.startsWith("ORD-")) {
        return await handleOrderGroupUpdate(challanNumber, req.body, client);
      }

      let existingRes = await client.query(
        "SELECT * FROM challans WHERE challan_no = $1",
        [challanNumber],
      );
      let existingItems = existingRes.rows;
      let salesResRows = [];

      // If challanNumber is a draft P- challan and there are NO active un-delivered CH- challans being edited, route to order update logic
      if (
        challanNumber.startsWith("P-") &&
        !existingItems.some((c) => c.status === "Confirmed")
      ) {
        return await handleOrderGroupUpdate(challanNumber, req.body, client);
      }

      if (existingItems.length > 0) {
        const salesIds = Array.from(
          new Set(existingItems.map((ei) => ei.sales_id).filter(Boolean)),
        );
        if (salesIds.length > 0) {
          const sRes = await client.query(
            "SELECT * FROM sales WHERE id = ANY($1::uuid[])",
            [salesIds],
          );
          salesResRows = sRes.rows;
        }
      } else {
        const salesRes = await client.query(
          "SELECT * FROM sales WHERE order_no = $1",
          [challanNumber],
        );
        if (salesRes.rows.length === 0) {
          const isUuid =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              challanNumber,
            );
          if (isUuid) {
            const saleByIdRes = await client.query(
              "SELECT * FROM sales WHERE id = $1",
              [challanNumber],
            );
            if (saleByIdRes.rows.length > 0) {
              const ordNo = saleByIdRes.rows[0].order_no;
              const sRes = await client.query(
                "SELECT * FROM sales WHERE order_no = $1",
                [ordNo],
              );
              salesResRows =
                sRes.rows.length > 0 ? sRes.rows : saleByIdRes.rows;
            }
          }
          if (salesResRows.length === 0) {
            const err = new Error("Challan or Order not found");
            err.statusCode = 404;
            throw err;
          }
        } else {
          salesResRows = salesRes.rows;
        }

        const activeChallans = await client.query(
          "SELECT * FROM challans WHERE sales_id = ANY($1::uuid[]) AND is_cancelled = FALSE ORDER BY created_at ASC, id ASC",
          [salesResRows.map((s) => s.id)],
        );
        existingItems = activeChallans.rows;
      }

      if (
        challanNumber.startsWith("CH-") &&
        existingItems.some((item) => item.status === "Delivered")
      ) {
        const err = new Error("Delivered challans are read-only.");
        err.statusCode = 400;
        throw err;
      }

      if (!items || !Array.isArray(items) || items.length === 0) {
        const err = new Error("At least one product item is required.");
        err.statusCode = 400;
        throw err;
      }

      const parentSale = salesResRows.length > 0 ? salesResRows[0] : null;
      items = normalizeOrderItems(
        items,
        parentSale ? parentSale.category : "Regular",
      );

      if (items.length === 0) {
        const err = new Error("At least one valid product item is required.");
        err.statusCode = 400;
        throw err;
      }

      const parentOrderNo = parentSale
        ? parentSale.order_no
        : challanNumber.startsWith("ORD-")
          ? challanNumber
          : `ORD-${Date.now().toString(36).toUpperCase()}`;

      // Determine group prefix / numbers & target status
      let chGroupNum = null;
      let pGroupNum = null;
      let targetStatus = "Confirmed";

      const existingCH = existingItems.find(
        (c) =>
          (c.challan_no.startsWith("CH-") || c.challan_no.startsWith("CH")) &&
          c.status !== "Delivered" &&
          !c.is_cancelled,
      );
      if (existingCH) {
        chGroupNum = existingCH.challan_no;
        targetStatus = existingCH.status || "Confirmed";
      } else if (
        challanNumber.startsWith("CH-") ||
        challanNumber.startsWith("CH")
      ) {
        chGroupNum = challanNumber;
        targetStatus = "Confirmed";
      } else if (
        challanNumber.startsWith("P-") &&
        existingItems.some((c) => c.status === "Confirmed")
      ) {
        chGroupNum = challanNumber;
        targetStatus = "Confirmed";
      }

      // If chGroupNum is not yet found, check if the parent order or associated sales already have an active CH- delivery challan
      const salesIdsForOrder = Array.from(
        new Set(
          salesResRows
            .map((s) => s.id)
            .concat(existingItems.map((ei) => ei.sales_id))
            .filter(Boolean),
        ),
      );
      if (!chGroupNum) {
        const orderCHRes = await client.query(
          `SELECT challan_no, status FROM challans 
           WHERE (sales_id = ANY($1::uuid[]) OR ($2 <> '' AND sales_id IN (SELECT id FROM sales WHERE order_no = $2)))
             AND (challan_no LIKE 'CH-%' OR challan_no LIKE 'CH%') 
             AND is_cancelled = FALSE 
             AND status != 'Delivered' 
           ORDER BY created_at ASC, id ASC LIMIT 1`,
          [
            salesIdsForOrder.length > 0
              ? salesIdsForOrder
              : ["00000000-0000-0000-0000-000000000000"],
            parentOrderNo || "",
          ],
        );
        if (orderCHRes.rows.length > 0) {
          chGroupNum = orderCHRes.rows[0].challan_no;
          targetStatus = orderCHRes.rows[0].status || "Confirmed";
        } else if (challanNumber.startsWith("P-")) {
          chGroupNum = challanNumber.replace(/^P-?/, "CH-");
        }
      }

      const existingP = existingItems.find(
        (c) =>
          c.challan_no.startsWith("P-") &&
          c.status === "Pending" &&
          !c.is_cancelled,
      );
      if (existingP) {
        pGroupNum = existingP.challan_no;
      } else if (
        challanNumber.startsWith("P-") &&
        !existingItems.some((c) => c.status === "Confirmed")
      ) {
        pGroupNum = challanNumber;
      }

      if (!pGroupNum) {
        const orderPRes = await client.query(
          `SELECT challan_no FROM challans 
           WHERE (sales_id = ANY($1::uuid[]) OR ($2 <> '' AND sales_id IN (SELECT id FROM sales WHERE order_no = $2)))
             AND challan_no LIKE 'P-%' 
             AND is_cancelled = FALSE 
             AND status != 'Delivered' 
           ORDER BY created_at ASC, id ASC LIMIT 1`,
          [
            salesIdsForOrder.length > 0
              ? salesIdsForOrder
              : ["00000000-0000-0000-0000-000000000000"],
            parentOrderNo || "",
          ],
        );
        if (orderPRes.rows.length > 0) {
          pGroupNum = orderPRes.rows[0].challan_no;
        } else if (chGroupNum) {
          pGroupNum = chGroupNum.replace(/^CH-?/, "P-");
        } else if (challanNumber.startsWith("P-")) {
          pGroupNum = challanNumber;
        }
      }

      // 1. Restore stock accurately for all existing items upfront
      const restoredSalesIds = new Set();
      for (const ei of existingItems) {
        if (ei.sales_id && !restoredSalesIds.has(ei.sales_id)) {
          restoredSalesIds.add(ei.sales_id);
          const sale = salesResRows.find((s) => s.id === ei.sales_id);
          if (sale && Number(sale.ordered_qty || 0) > 0) {
            await restoreStock(
              sale.product,
              sale.batch_no || "0",
              Number(sale.ordered_qty),
              sale.stock_category || "Available",
              client,
            );
          }
        } else if (!ei.sales_id && Number(ei.quantity || 0) > 0) {
          await restoreStock(
            ei.product,
            ei.batch_no || "0",
            Number(ei.quantity),
            ei.stock_category || "Available",
            client,
          );
        }
      }

      // 2. Handle deletion of removed items from group
      const inputItemIds = items.map((i) => i.id).filter(Boolean);
      const inputSalesIds = items.map((i) => i.salesId).filter(Boolean);
      const inputProducts = items
        .map((i) => (i.productName || i.product || "").trim().toLowerCase())
        .filter(Boolean);
      const handledRemovedSalesIds = new Set();

      for (const ei of existingItems) {
        const isKept =
          (ei.id && inputItemIds.includes(ei.id)) ||
          (ei.sales_id && inputSalesIds.includes(ei.sales_id)) ||
          (!ei.id &&
            !ei.sales_id &&
            inputProducts.includes((ei.product || "").trim().toLowerCase()));

        if (!isKept) {
          if (ei.sales_id && !handledRemovedSalesIds.has(ei.sales_id)) {
            handledRemovedSalesIds.add(ei.sales_id);
            const sale = salesResRows.find((s) => s.id === ei.sales_id);
            const targetProd = (sale?.product || ei.product || "").trim();

            if (
              sale &&
              (sale.order_no === parentOrderNo ||
                challanNumber.startsWith("P-") ||
                challanNumber.startsWith("CH-") ||
                challanNumber.startsWith("CH") ||
                challanNumber.startsWith("ORD-"))
            ) {
              const allLinked = await client.query(
                "SELECT * FROM challans WHERE sales_id = $1",
                [ei.sales_id],
              );
              const deliveredChallans = allLinked.rows.filter(
                (c) => c.status === "Delivered" && !c.is_cancelled,
              );

              // Delete all non-delivered challans for this product/sale in this order
              await client.query(
                "DELETE FROM challans WHERE sales_id = $1 AND LOWER(TRIM(product)) = LOWER(TRIM($2)) AND status != 'Delivered'",
                [ei.sales_id, targetProd],
              );

              if (deliveredChallans.length === 0) {
                await client.query("DELETE FROM challans WHERE sales_id = $1", [
                  ei.sales_id,
                ]);
                await client.query("DELETE FROM sales WHERE id = $1", [
                  ei.sales_id,
                ]);
              } else {
                const totalDelivered = deliveredChallans.reduce(
                  (sum, c) => sum + Number(c.quantity || 0),
                  0,
                );
                if (totalDelivered > 0) {
                  await deductStock(
                    sale.product,
                    sale.batch_no || "0",
                    totalDelivered,
                    sale.stock_category || "Available",
                    client,
                  );
                  await resolveNegativeStock(sale.product, client);
                }
                const rate = Number(sale.rate || 0);
                await client.query(
                  "UPDATE sales SET ordered_qty = $1, delivered_qty = $1, pending_qty = 0, status = 'Delivered', total_price = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
                  [totalDelivered, totalDelivered * rate, ei.sales_id],
                );
              }
            } else {
              await client.query("DELETE FROM challans WHERE id = $1", [ei.id]);
            }
          } else if (!ei.sales_id) {
            await client.query("DELETE FROM challans WHERE id = $1", [ei.id]);
          }
        }
      }

      for (const item of items) {
        const targetProdName = (item.productName || item.product || "").trim();
        if (!targetProdName) continue;

        let salesId = item.salesId;
        if (!salesId && item.id) {
          const foundEi = existingItems.find((ei) => ei.id === item.id);
          if (foundEi) salesId = foundEi.sales_id;
          else {
            const foundSale = salesResRows.find((s) => s.id === item.id);
            if (foundSale) salesId = foundSale.id;
          }
        }

        const stockCategory =
          item.stockCategory || item.stock_category || "Available";
        const rawBatchNo =
          item.batchNo !== undefined ? item.batchNo : item.batch_no;
        const isSpecified = isBatchSpecified(rawBatchNo);
        const batchNo = isSpecified ? String(rawBatchNo).trim() : null;
        const notes =
          item.notes !== undefined
            ? item.notes
            : item.remarks !== undefined
              ? item.remarks
              : "";
        const newRequestedQty = Number(item.quantity || 0);

        let saleRecord = null;
        let deliveredQty = 0;
        let rate = 0;

        if (salesId) {
          const saleRes = await client.query(
            "SELECT * FROM sales WHERE id = $1",
            [salesId],
          );
          if (saleRes.rows.length > 0) {
            saleRecord = saleRes.rows[0];
            deliveredQty = Number(saleRecord.delivered_qty || 0);
            rate = Number(saleRecord.rate || 0);

            if (deliveredQty > 0) {
              if (newRequestedQty < deliveredQty) {
                const err = new Error(
                  `Quantity cannot be reduced below the delivered quantity (${deliveredQty}).`,
                );
                err.statusCode = 400;
                throw err;
              }
              if (
                targetProdName.toLowerCase() !==
                (saleRecord.product || "").trim().toLowerCase()
              ) {
                const err = new Error(
                  "Cannot change product name on a partially delivered sale.",
                );
                err.statusCode = 400;
                throw err;
              }
            }
          }
        }

        let stockCol = "available_qty";
        if (stockCategory === "Damage") stockCol = "damage_qty";
        else if (stockCategory === "Display") stockCol = "display_qty";

        // Check available stock (positive only)
        const currentBatches = await client.query(
          `SELECT "${stockCol}" FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))`,
          [targetProdName],
        );
        const tempAvail = currentBatches.rows.reduce(
          (acc, r) => acc + Math.max(0, Number(r[stockCol] || 0)),
          0,
        );

        const remainingToDistribute = Math.max(
          0,
          newRequestedQty - deliveredQty,
        );
        const fulfillableQty = Math.min(
          remainingToDistribute,
          Math.max(0, tempAvail),
        );
        const pDraftQty = Math.max(0, remainingToDistribute - fulfillableQty);

        // Deduct the new stock
        const actualBatchNo = await deductStock(
          targetProdName,
          batchNo,
          newRequestedQty,
          stockCategory,
          client,
        );
        await resolveNegativeStock(targetProdName, client);

        // Create or Update Sales Record
        if (!salesId || !saleRecord) {
          const newSaleRes = await client.query(
            `INSERT INTO sales 
            (order_no, customer, client_phone, product, category, ordered_qty, delivered_qty, pending_qty, rate, "GST", total_price, order_date, value_category, batch_no, remarks, status, stock_category, damage_qty, created_at, updated_at) 
            VALUES ($1, $2, $3, $4, $5, $6, 0, $6, 0, 0, 0, $7, 'Standard', $8, $9, 'Pending', $10, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
            [
              parentOrderNo,
              finalCustomer,
              client_phone || (parentSale ? parentSale.client_phone : ""),
              targetProdName,
              parentSale ? parentSale.category : "Regular",
              newRequestedQty,
              date || new Date().toISOString().slice(0, 10),
              actualBatchNo || batchNo || null,
              notes || (parentSale ? parentSale.remarks : ""),
              stockCategory,
            ],
          );
          salesId = newSaleRes.rows[0].id;
          saleRecord = newSaleRes.rows[0];
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
            targetProdName,
            newRequestedQty,
            newPendingQtyForSale,
            newRequestedQty * rate,
            actualBatchNo || batchNo || null,
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

          await client.query(updateSalesQuery, updateParams);
        }

        // Synchronize delivery challan for this sale
        if (fulfillableQty > 0 && !chGroupNum) {
          chGroupNum = await getNextChallanNumber("CH-", client);
        }

        const existingCHChallans = await client.query(
          `SELECT * FROM challans WHERE sales_id = $1 AND (challan_no = $2 OR challan_no LIKE 'CH-%' OR challan_no LIKE 'CH%') AND is_cancelled = FALSE AND status != 'Delivered' ORDER BY created_at ASC, id ASC`,
          [salesId, chGroupNum || ""],
        );

        if (fulfillableQty > 0) {
          if (existingCHChallans.rows.length > 0) {
            const primaryCH = existingCHChallans.rows[0];
            await client.query(
              `UPDATE challans SET challan_no = $1, customer = $2, client_phone = $3, product = $4, batch_no = $5, quantity = $6, notes = $7, stock_category = $8, status = $9, created_at = $10, updated_at = CURRENT_TIMESTAMP WHERE id = $11`,
              [
                chGroupNum,
                finalCustomer,
                client_phone || "",
                targetProdName,
                actualBatchNo || batchNo || null,
                fulfillableQty,
                notes,
                stockCategory,
                targetStatus,
                date || new Date().toISOString().slice(0, 10),
                primaryCH.id,
              ],
            );
            for (let k = 1; k < existingCHChallans.rows.length; k++) {
              await client.query("DELETE FROM challans WHERE id = $1", [
                existingCHChallans.rows[k].id,
              ]);
            }
          } else {
            await client.query(
              `INSERT INTO challans
               (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, is_cancelled, stock_category, is_printed, is_built)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, $11, FALSE, FALSE)`,
              [
                chGroupNum,
                salesId,
                finalCustomer,
                client_phone || "",
                targetProdName,
                actualBatchNo || batchNo || null,
                fulfillableQty,
                targetStatus,
                date || new Date().toISOString().slice(0, 10),
                notes,
                stockCategory,
              ],
            );
          }
        } else {
          for (const ch of existingCHChallans.rows) {
            await client.query("DELETE FROM challans WHERE id = $1", [ch.id]);
          }
        }

        // Synchronize P- (draft pending) challan for this sale
        if (pDraftQty > 0 && !pGroupNum) {
          pGroupNum = chGroupNum
            ? chGroupNum.replace(/^CH-?/, "P-")
            : await getNextChallanNumber("P-", client);
        }

        if (pDraftQty > 0) {
          const existingPChallans = await client.query(
            `SELECT * FROM challans WHERE sales_id = $1 AND challan_no LIKE 'P-%' AND challan_no != $2 AND is_cancelled = FALSE AND status != 'Delivered' ORDER BY created_at ASC, id ASC`,
            [salesId, chGroupNum || ""],
          );

          if (existingPChallans.rows.length > 0) {
            const primaryP = existingPChallans.rows[0];
            await client.query(
              `UPDATE challans SET challan_no = $1, customer = $2, client_phone = $3, product = $4, batch_no = $5, quantity = $6, notes = $7, stock_category = $8, status = 'Pending', created_at = $9, updated_at = CURRENT_TIMESTAMP WHERE id = $10`,
              [
                pGroupNum,
                finalCustomer,
                client_phone || "",
                targetProdName,
                actualBatchNo || batchNo || null,
                pDraftQty,
                notes,
                stockCategory,
                date || new Date().toISOString().slice(0, 10),
                primaryP.id,
              ],
            );
            for (let k = 1; k < existingPChallans.rows.length; k++) {
              await client.query("DELETE FROM challans WHERE id = $1", [
                existingPChallans.rows[k].id,
              ]);
            }
          } else {
            await client.query(
              `INSERT INTO challans
               (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, is_cancelled, stock_category, is_printed, is_built)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', $8, $9, FALSE, $10, FALSE, FALSE)`,
              [
                pGroupNum,
                salesId,
                finalCustomer,
                client_phone || "",
                targetProdName,
                actualBatchNo || batchNo || null,
                pDraftQty,
                date || new Date().toISOString().slice(0, 10),
                notes,
                stockCategory,
              ],
            );
          }
        } else {
          // If pDraftQty is 0, delete all P- challans for this sale (except if chGroupNum itself is named P-)
          await client.query(
            `DELETE FROM challans WHERE sales_id = $1 AND challan_no LIKE 'P-%' AND challan_no != $2 AND status != 'Delivered'`,
            [salesId, chGroupNum || ""],
          );
        }

        // Clean up any other active challans for this salesId not in [chGroupNum, pGroupNum]
        await client.query(
          `DELETE FROM challans WHERE sales_id = $1 AND challan_no NOT IN ($2, $3) AND status != 'Delivered'`,
          [salesId, chGroupNum || "", pDraftQty > 0 ? pGroupNum || "" : ""],
        );
      }
    });

    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

async function handleCancelChallanGroup(challanNumber, res) {
  try {
    await db.withTransaction(async (client) => {
      const existingRes = await client.query(
        "SELECT * FROM challans WHERE challan_no = $1",
        [challanNumber],
      );
      const existingItems = existingRes.rows;
      if (existingItems.length === 0) {
        const err = new Error("Challan not found");
        err.statusCode = 404;
        throw err;
      }

      // 1. Restore stock ONLY for all non-cancelled items in this specific challan
      for (const item of existingItems) {
        if (!item.is_cancelled && item.status !== "Cancelled") {
          const stockCategory = item.stock_category || "Available";
          const restoreQty = Number(item.quantity || 0);

          if (restoreQty > 0) {
            await restoreStock(
              item.product,
              item.batch_no || "0",
              restoreQty,
              stockCategory,
              client,
            );
          }

          await client.query(
            "UPDATE challans SET is_cancelled = TRUE, status = 'Cancelled', restored_qty = $1, cancelled_at = CURRENT_TIMESTAMP WHERE id = $2",
            [restoreQty, item.id],
          );
        }
      }

      // Mark target challan as cancelled
      await client.query(
        `UPDATE challans SET is_cancelled = TRUE, status = 'Cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE challan_no = $1`,
        [challanNumber],
      );

      // 2. Identify linked pending records safely for each sales item
      const directSalesIds = Array.from(
        new Set(existingItems.map((it) => it.sales_id).filter(Boolean)),
      );

      for (const sId of directSalesIds) {
        const saleRes = await client.query(
          "SELECT * FROM sales WHERE id = $1",
          [sId],
        );
        if (saleRes.rows.length === 0) continue;

        // Check if other active confirmed/delivered delivery challans remain for this sales_id
        const existingIds = existingItems.map((it) => it.id);
        const otherDeliveryRes = await client.query(
          `SELECT id, challan_no, quantity FROM challans 
           WHERE sales_id = $1 
             AND id != ALL($2::uuid[]) 
             AND is_cancelled = FALSE 
             AND status != 'Delivered' 
             AND (challan_no LIKE 'CH-%' OR challan_no LIKE 'CH%' OR status = 'Confirmed')`,
          [sId, existingIds],
        );
        const hasOtherDeliveryChallans = otherDeliveryRes.rows.length > 0;

        // Determine which linked P- challans should be cancelled:
        // - If no other delivery challans remain, all active P- draft challans for this sale are unfulfilled remnants of this order.
        // - If other delivery challans remain, only cancel a P- draft that is specifically paired with this challan number.
        const pairedPNo =
          challanNumber.startsWith("CH-") || challanNumber.startsWith("CH")
            ? challanNumber.replace(/^CH-?/, "P-")
            : null;

        let linkedPendingQuery = `SELECT * FROM challans WHERE sales_id = $1 AND is_cancelled = FALSE AND challan_no LIKE 'P-%'`;
        const linkedPendingParams = [sId];

        if (hasOtherDeliveryChallans) {
          if (pairedPNo) {
            linkedPendingQuery += ` AND challan_no = $2`;
            linkedPendingParams.push(pairedPNo);
          } else {
            linkedPendingQuery += ` AND FALSE`;
          }
        }

        const linkedPendingRes = await client.query(
          linkedPendingQuery,
          linkedPendingParams,
        );

        for (const pItem of linkedPendingRes.rows) {
          if (!pItem.is_cancelled && pItem.status !== "Cancelled") {
            const pStockCat = pItem.stock_category || "Available";
            const pRestoreQty = Number(pItem.quantity || 0);

            if (pRestoreQty > 0) {
              await restoreStock(
                pItem.product,
                pItem.batch_no || "0",
                pRestoreQty,
                pStockCat,
                client,
              );
            }

            await client.query(
              "UPDATE challans SET is_cancelled = TRUE, status = 'Cancelled', restored_qty = $1, cancelled_at = CURRENT_TIMESTAMP WHERE id = $2",
              [pRestoreQty, pItem.id],
            );
          }
        }

        // 3. Synchronize sales records:
        // Sum of delivered quantities from non-cancelled delivered challans for this sale
        const delRes = await client.query(
          "SELECT COALESCE(SUM(quantity), 0) as del_sum FROM challans WHERE sales_id = $1 AND status = 'Delivered' AND is_cancelled = FALSE",
          [sId],
        );
        const actualDelivered = Number(delRes.rows[0].del_sum || 0);

        // Sum of remaining active (non-cancelled, non-delivered) challans for this sale
        const otherActiveRes = await client.query(
          "SELECT COALESCE(SUM(quantity), 0) as active_sum FROM challans WHERE sales_id = $1 AND status != 'Delivered' AND is_cancelled = FALSE",
          [sId],
        );
        const otherActiveQty = Number(otherActiveRes.rows[0].active_sum || 0);

        if (otherActiveQty === 0) {
          if (actualDelivered > 0) {
            await client.query(
              "UPDATE sales SET ordered_qty = $1, delivered_qty = $1, pending_qty = 0, status = 'Delivered', updated_at = CURRENT_TIMESTAMP WHERE id = $2",
              [actualDelivered, sId],
            );
          } else {
            await client.query(
              "UPDATE sales SET delivered_qty = 0, pending_qty = 0, status = 'Cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
              [sId],
            );
          }
        } else {
          const newStatus = actualDelivered > 0 ? "Partial" : "Pending";
          await client.query(
            "UPDATE sales SET delivered_qty = $1, pending_qty = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4",
            [actualDelivered, otherActiveQty, newStatus, sId],
          );
        }
      }
    });

    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
}

app.put("/api/challans/group/:challanNumber/cancel", async (req, res) => {
  await handleCancelChallanGroup(req.params.challanNumber, res);
});

app.put("/api/challans/cancel/:challanNumber", async (req, res) => {
  await handleCancelChallanGroup(req.params.challanNumber, res);
});

// Cancel a pending delivery group (from the Pending Deliveries page)
app.put("/api/pending-orders/group/:groupKey/cancel", async (req, res) => {
  const { groupKey } = req.params;
  try {
    await db.withTransaction(async (client) => {
      // 1. Check if groupKey is an active P- challan
      const pChallanRes = await client.query(
        "SELECT * FROM challans WHERE challan_no = $1 AND is_cancelled = FALSE",
        [groupKey],
      );

      if (pChallanRes.rows.length > 0) {
        for (const item of pChallanRes.rows) {
          const stockCategory = item.stock_category || "Available";
          const restoreQty = Number(item.quantity || 0);
          if (restoreQty > 0) {
            await restoreStock(
              item.product,
              item.batch_no || "0",
              restoreQty,
              stockCategory,
              client,
            );
          }
          await client.query(
            "UPDATE challans SET is_cancelled = TRUE, status = 'Cancelled', restored_qty = $1, cancelled_at = CURRENT_TIMESTAMP WHERE id = $2",
            [restoreQty, item.id],
          );

          if (item.sales_id) {
            const sId = item.sales_id;
            const delRes = await client.query(
              "SELECT COALESCE(SUM(quantity), 0) as del_sum FROM challans WHERE sales_id = $1 AND status = 'Delivered' AND is_cancelled = FALSE",
              [sId],
            );
            const actualDelivered = Number(delRes.rows[0].del_sum || 0);

            const otherActiveRes = await client.query(
              "SELECT COALESCE(SUM(quantity), 0) as active_sum FROM challans WHERE sales_id = $1 AND status != 'Delivered' AND is_cancelled = FALSE",
              [sId],
            );
            const otherActiveQty = Number(
              otherActiveRes.rows[0].active_sum || 0,
            );

            if (otherActiveQty === 0) {
              if (actualDelivered > 0) {
                await client.query(
                  "UPDATE sales SET ordered_qty = $1, delivered_qty = $1, pending_qty = 0, status = 'Delivered', updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                  [actualDelivered, sId],
                );
              } else {
                await client.query(
                  "UPDATE sales SET delivered_qty = 0, pending_qty = 0, status = 'Cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
                  [sId],
                );
              }
            } else {
              const newStatus = actualDelivered > 0 ? "Partial" : "Pending";
              await client.query(
                "UPDATE sales SET delivered_qty = $1, pending_qty = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4",
                [actualDelivered, otherActiveQty, newStatus, sId],
              );
            }
          }
        }
        return;
      }

      // 2. If not found by challan_no, search sales by order_no or ID
      const salesRes = await client.query(
        "SELECT * FROM sales WHERE (order_no = $1 OR id::text = $1) AND status != 'Cancelled'",
        [groupKey],
      );

      if (salesRes.rows.length === 0) {
        const err = new Error("Pending order not found.");
        err.statusCode = 404;
        throw err;
      }

      for (const sale of salesRes.rows) {
        const pItems = await client.query(
          "SELECT * FROM challans WHERE sales_id = $1 AND challan_no LIKE 'P-%' AND is_cancelled = FALSE",
          [sale.id],
        );

        let pendingQtyToRestore = Number(sale.pending_qty || 0);

        if (pItems.rows.length > 0) {
          for (const pi of pItems.rows) {
            const restoreQty = Number(pi.quantity || 0);
            if (restoreQty > 0) {
              await restoreStock(
                pi.product,
                pi.batch_no || "0",
                restoreQty,
                pi.stock_category || "Available",
                client,
              );
            }
            await client.query(
              "UPDATE challans SET is_cancelled = TRUE, status = 'Cancelled', restored_qty = $1, cancelled_at = CURRENT_TIMESTAMP WHERE id = $2",
              [restoreQty, pi.id],
            );
          }
        } else if (pendingQtyToRestore > 0) {
          await restoreStock(
            sale.product,
            sale.batch_no || "0",
            pendingQtyToRestore,
            sale.stock_category || "Available",
            client,
          );
        }

        const delRes = await client.query(
          "SELECT COALESCE(SUM(quantity), 0) as del_sum FROM challans WHERE sales_id = $1 AND status = 'Delivered' AND is_cancelled = FALSE",
          [sale.id],
        );
        const actualDelivered = Number(delRes.rows[0].del_sum || 0);

        const otherActiveRes = await client.query(
          "SELECT COALESCE(SUM(quantity), 0) as active_sum FROM challans WHERE sales_id = $1 AND status != 'Delivered' AND is_cancelled = FALSE",
          [sale.id],
        );
        const otherActiveQty = Number(otherActiveRes.rows[0].active_sum || 0);

        if (otherActiveQty === 0) {
          if (actualDelivered > 0) {
            await client.query(
              "UPDATE sales SET ordered_qty = $1, delivered_qty = $1, pending_qty = 0, status = 'Delivered', updated_at = CURRENT_TIMESTAMP WHERE id = $2",
              [actualDelivered, sale.id],
            );
          } else {
            await client.query(
              "UPDATE sales SET delivered_qty = 0, pending_qty = 0, status = 'Cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
              [sale.id],
            );
          }
        } else {
          const newStatus = actualDelivered > 0 ? "Partial" : "Pending";
          await client.query(
            "UPDATE sales SET delivered_qty = $1, pending_qty = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4",
            [actualDelivered, otherActiveQty, newStatus, sale.id],
          );
        }
      }
    });

    res.json({ success: true });
  } catch (err) {
    console.error("PUT /api/pending-orders/group/:groupKey/cancel error:", err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Update an already-delivered order by replacing products and adjusting stock directly
app.put("/api/delivered-orders/group/:challanNumber", async (req, res) => {
  const { challanNumber } = req.params;
  const {
    customer,
    client_name,
    client_phone,
    date,
    items = [],
    reopenPending = false,
    preserveOrderedQty = false,
    narration,
    notes: bodyNotes,
    remarks: bodyRemarks,
  } = req.body;
  const finalCustomer = customer || client_name;

  try {
    await db.withTransaction(async (client) => {
      // 1. Fetch existing delivered challans and sales (supporting both CH- and P- challans)
      let existingRes = await client.query(
        "SELECT * FROM challans WHERE LOWER(TRIM(challan_no)) = LOWER(TRIM($1)) AND is_cancelled = FALSE",
        [challanNumber],
      );
      let existingItems = existingRes.rows;
      let salesResRows = [];

      if (existingItems.length > 0) {
        const salesIds = Array.from(
          new Set(existingItems.map((ei) => ei.sales_id).filter(Boolean)),
        );
        if (salesIds.length > 0) {
          const sRes = await client.query(
            "SELECT * FROM sales WHERE id = ANY($1::uuid[])",
            [salesIds],
          );
          salesResRows = sRes.rows;
        }
      } else {
        const salesRes = await client.query(
          "SELECT * FROM sales WHERE order_no = $1",
          [challanNumber],
        );
        if (salesRes.rows.length === 0) {
          const err = new Error("Delivered Order / Challan not found.");
          err.statusCode = 404;
          throw err;
        }
        salesResRows = salesRes.rows;
        const chRes = await client.query(
          "SELECT * FROM challans WHERE sales_id = ANY($1::uuid[]) AND is_cancelled = FALSE",
          [salesResRows.map((s) => s.id)],
        );
        existingItems = chRes.rows;
      }

      if (!items || !Array.isArray(items) || items.length === 0) {
        const err = new Error("At least one product item is required.");
        err.statusCode = 400;
        throw err;
      }

      for (const item of items) {
        const pName = (item.productName || item.product || "").trim();
        const q = Number(item.quantity || 0);
        if (!pName) {
          const err = new Error("Product name is required for all items.");
          err.statusCode = 400;
          throw err;
        }
        if (isNaN(q) || q <= 0) {
          const err = new Error(
            `Quantity must be greater than 0 for "${pName}".`,
          );
          err.statusCode = 400;
          throw err;
        }
      }

      const parentOrderNo =
        salesResRows.find((s) => s.order_no)?.order_no ||
        existingItems.find((ei) => ei.challan_no)?.challan_no;

      // 2. Restore stock for all old delivered items in this document using each row's own quantity
      for (const ei of existingItems) {
        const qtyToRestore = Number(ei.quantity || 0);
        if (qtyToRestore > 0) {
          await restoreStock(
            ei.product,
            ei.batch_no || "0",
            qtyToRestore,
            ei.stock_category || "Available",
            client,
          );
        }
      }

      // 2b. Validate batch availability for new items before modifying data
      for (const item of items) {
        const targetProdName = (item.productName || item.product || "").trim();
        const newRequestedQty = Number(item.quantity || 0);
        const stockCategory =
          item.stockCategory || item.stock_category || "Available";
        const rawBatchNo =
          item.batchNo !== undefined ? item.batchNo : item.batch_no;
        const isSpecified = isBatchSpecified(rawBatchNo);
        const batchNo = isSpecified ? String(rawBatchNo).trim() : null;

        let stockCol = "available_qty";
        if (stockCategory === "Damage") stockCol = "damage_qty";
        else if (stockCategory === "Display") stockCol = "display_qty";

        let bCheckQuery = `SELECT id, batch_number, "${stockCol}" FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))`;
        let bCheckParams = [targetProdName];
        if (isSpecified) {
          bCheckQuery += " AND LOWER(TRIM(batch_number)) = LOWER(TRIM($2))";
          bCheckParams.push(batchNo);
        }
        bCheckQuery += " ORDER BY date ASC, id ASC";

        const bRes = await client.query(bCheckQuery, bCheckParams);
        if (bRes.rows.length === 0) {
          const err = new Error(
            isSpecified
              ? `Batch "${batchNo}" does not exist for product "${targetProdName}".`
              : `No stock batches found for product "${targetProdName}".`,
          );
          err.statusCode = 400;
          throw err;
        }

        // Edits to delivered challans allow negative stock for the matching batch.
        // Batch existence is validated above; insufficient stock is permitted and results in negative available stock.
      }

      // 2c. Delete any removed items from this challan group
      const inputItemIds = items.map((i) => i.id).filter(Boolean);
      for (const ei of existingItems) {
        if (ei.id && !inputItemIds.includes(ei.id)) {
          await client.query("DELETE FROM challans WHERE id = $1", [ei.id]);
        }
      }

      // 3. For each item: deduct new stock and update challans & sales records
      const affectedSalesIds = Array.from(
        new Set(
          existingItems
            .map((ei) => ei.sales_id)
            .concat(items.map((i) => i.salesId))
            .filter(Boolean),
        ),
      );
      const swappedAwaySaleIds = new Set();

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const targetProdName = (item.productName || item.product || "").trim();
        const newRequestedQty = Number(item.quantity || 0);
        const stockCategory =
          item.stockCategory || item.stock_category || "Available";
        const rawBatchNo =
          item.batchNo !== undefined ? item.batchNo : item.batch_no;
        const isSpecified = isBatchSpecified(rawBatchNo);
        const batchNo = isSpecified ? String(rawBatchNo).trim() : null;
        const notes =
          item.notes !== undefined
            ? item.notes
            : item.narration !== undefined
              ? item.narration
              : item.remarks !== undefined
                ? item.remarks
                : narration !== undefined
                  ? narration
                  : bodyNotes !== undefined
                    ? bodyNotes
                    : bodyRemarks || "";

        // Deduct the new stock
        const actualBatchNo = await deductStock(
          targetProdName,
          batchNo,
          newRequestedQty,
          stockCategory,
          client,
        );
        await resolveNegativeStock(targetProdName, client);

        // Lookup category of new product
        const productLookup = await client.query(
          "SELECT category FROM products WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1",
          [targetProdName],
        );
        const prodCategory =
          productLookup.rows.length > 0
            ? productLookup.rows[0].category
            : "Other";

        let existingChallanItem =
          existingItems.find((ei) => ei.id === item.id) || existingItems[idx];
        let existingSaleItem = existingChallanItem?.sales_id
          ? salesResRows.find((s) => s.id === existingChallanItem.sales_id)
          : salesResRows.find((s) => s.id === item.salesId) ||
            salesResRows[idx];

        let isSharedSale = false;
        if (existingSaleItem) {
          const otherChRes = await client.query(
            "SELECT id FROM challans WHERE sales_id = $1 AND id != $2 AND is_cancelled = FALSE",
            [existingSaleItem.id, existingChallanItem?.id || 0],
          );
          isSharedSale = otherChRes.rows.length > 0;
        }

        if (
          existingSaleItem &&
          (!isSharedSale || targetProdName === existingSaleItem.product)
        ) {
          const shouldUpdateBatchOnSale =
            !isSharedSale ||
            existingSaleItem.batch_no === (actualBatchNo || batchNo || null);
          const updateBatchVal = shouldUpdateBatchOnSale
            ? actualBatchNo || batchNo || null
            : existingSaleItem.batch_no;
          const updateStockCatVal = shouldUpdateBatchOnSale
            ? stockCategory
            : existingSaleItem.stock_category;

          await client.query(
            `UPDATE sales SET 
               product = $1, 
               category = $2, 
               batch_no = $3, 
               stock_category = $4, 
               remarks = $5, 
               customer = COALESCE($6, customer), 
               client_phone = COALESCE($7, client_phone), 
               order_date = COALESCE($8, order_date), 
               updated_at = CURRENT_TIMESTAMP 
             WHERE id = $9`,
            [
              targetProdName,
              prodCategory,
              updateBatchVal,
              updateStockCatVal,
              notes,
              finalCustomer,
              client_phone,
              date,
              existingSaleItem.id,
            ],
          );
        } else if (
          existingSaleItem &&
          isSharedSale &&
          targetProdName !== existingSaleItem.product
        ) {
          // Product was swapped on a shared sale item: create or link to sale row for targetProdName
          swappedAwaySaleIds.add(existingSaleItem.id);

          const targetSaleRes = await client.query(
            "SELECT * FROM sales WHERE order_no = $1 AND LOWER(TRIM(product)) = LOWER(TRIM($2))",
            [parentOrderNo, targetProdName],
          );
          let targetSaleId = null;
          if (targetSaleRes.rows.length > 0) {
            targetSaleId = targetSaleRes.rows[0].id;
          } else {
            const newSaleRes = await client.query(
              `INSERT INTO sales 
                 (order_no, customer, client_phone, product, category, ordered_qty, delivered_qty, pending_qty, rate, "GST", total_price, order_date, value_category, batch_no, remarks, status, stock_category, damage_qty, created_at, updated_at) 
               VALUES ($1, $2, $3, $4, $5, $6, $6, 0, $7, 0, $8, $9, 'Standard', $10, $11, 'Delivered', $12, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id`,
              [
                parentOrderNo,
                finalCustomer,
                client_phone || existingSaleItem.client_phone || "",
                targetProdName,
                prodCategory,
                newRequestedQty,
                Number(existingSaleItem.rate || 0),
                newRequestedQty * Number(existingSaleItem.rate || 0),
                date || existingSaleItem.order_date || new Date().toISOString().slice(0, 10),
                actualBatchNo || batchNo || null,
                notes,
                stockCategory,
              ],
            );
            targetSaleId = newSaleRes.rows[0].id;
          }

          if (existingChallanItem) {
            existingChallanItem.sales_id = targetSaleId;
          }
          affectedSalesIds.push(targetSaleId);
        }

        if (existingChallanItem) {
          await client.query(
            `UPDATE challans SET 
               product = $1, 
               batch_no = $2, 
               quantity = $3, 
               stock_category = $4, 
               notes = $5, 
               customer = COALESCE($6, customer), 
               client_phone = COALESCE($7, client_phone), 
               sales_id = $8, 
               status = 'Delivered', 
               updated_at = CURRENT_TIMESTAMP 
             WHERE id = $9`,
            [
              targetProdName,
              actualBatchNo || batchNo || null,
              newRequestedQty,
              stockCategory,
              notes,
              finalCustomer,
              client_phone,
              existingChallanItem.sales_id,
              existingChallanItem.id,
            ],
          );
        } else {
          // Newly added item to delivered challan group
          await client.query(
            `INSERT INTO challans 
               (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'Delivered', $8, $9, $10, FALSE, FALSE, FALSE)`,
            [
              challanNumber,
              item.salesId || null,
              finalCustomer,
              client_phone || "",
              targetProdName,
              actualBatchNo || batchNo || null,
              newRequestedQty,
              date || new Date().toISOString().slice(0, 10),
              notes,
              stockCategory,
            ],
          );
        }
      }

      // 4. Synchronize sales records (delivered_qty, pending_qty, ordered_qty, status, total_price)
      for (const sId of Array.from(new Set(affectedSalesIds))) {
        const saleRes = await client.query(
          "SELECT * FROM sales WHERE id = $1",
          [sId],
        );
        if (saleRes.rows.length === 0) continue;
        const sale = saleRes.rows[0];

        // Sum of delivered quantities from all non-cancelled delivered challans for this sale
        const delRes = await client.query(
          "SELECT COALESCE(SUM(quantity), 0) as del_sum FROM challans WHERE sales_id = $1 AND status = 'Delivered' AND is_cancelled = FALSE",
          [sId],
        );
        const actualDelivered = Number(delRes.rows[0].del_sum || 0);

        // Sum of pending quantities from all active (non-cancelled, non-delivered) challans for this sale
        const pendingChRes = await client.query(
          "SELECT COALESCE(SUM(quantity), 0) as pending_sum FROM challans WHERE sales_id = $1 AND status != 'Delivered' AND is_cancelled = FALSE",
          [sId],
        );
        const activePendingChallansQty = Number(
          pendingChRes.rows[0].pending_sum || 0,
        );

        const shouldPreserveOrdered =
          preserveOrderedQty ||
          reopenPending ||
          items.some(
            (it) =>
              (it.salesId === sId || it.id === sId) &&
              (it.preserveOrderedQty || it.reopenPending),
          );

        let newOrderedQty;
        let newPendingQty;

        if (shouldPreserveOrdered) {
          const origOrdered = Number(sale.ordered_qty || 0);
          newOrderedQty = Math.max(
            origOrdered,
            actualDelivered + activePendingChallansQty,
          );
          newPendingQty = Math.max(
            activePendingChallansQty,
            Math.max(0, newOrderedQty - actualDelivered),
          );
        } else {
          // When editing delivered orders, the fulfilled order quantity is synchronized to actualDelivered plus any active pending drafts
          newOrderedQty = actualDelivered + activePendingChallansQty;
          newPendingQty = activePendingChallansQty;
        }

        let newStatus = "Pending";
        if (
          actualDelivered >= newOrderedQty &&
          activePendingChallansQty === 0
        ) {
          newStatus = "Delivered";
        } else if (actualDelivered > 0) {
          newStatus = "Partial";
        } else if (newPendingQty === 0 && actualDelivered === 0) {
          newStatus = "Cancelled";
        }

        const rate = Number(sale.rate || 0);
        const totalPrice = newOrderedQty * rate;

        await client.query(
          `UPDATE sales SET 
             ordered_qty = $1, 
             delivered_qty = $2, 
             pending_qty = $3, 
             status = $4, 
             total_price = $5, 
             updated_at = CURRENT_TIMESTAMP 
           WHERE id = $6`,
          [newOrderedQty, actualDelivered, newPendingQty, newStatus, totalPrice, sId],
        );
      }
    });

    res.json({ success: true });
  } catch (err) {
    console.error("PUT /api/delivered-orders/group error:", err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Generate a single P-xxxx draft challan for an entire pending order group
app.post("/api/challans/group/generate-pending", async (req, res) => {
  const { orderNo, salesIds } = req.body;
  try {
    const result = await db.withTransaction(async (client) => {
      let salesRows = [];
      if (salesIds && Array.isArray(salesIds) && salesIds.length > 0) {
        const validIds = salesIds.filter((id) => Boolean(id));
        if (validIds.length > 0) {
          const salesRes = await client.query(
            "SELECT * FROM sales WHERE id = ANY($1::uuid[]) AND status != 'Cancelled' AND pending_qty > 0",
            [validIds],
          );
          salesRows = salesRes.rows;
        }
      }

      if (salesRows.length === 0 && orderNo) {
        const salesRes = await client.query(
          "SELECT * FROM sales WHERE order_no = $1 AND status != 'Cancelled' AND pending_qty > 0",
          [orderNo],
        );
        salesRows = salesRes.rows;
      }

      if (salesRows.length === 0) {
        const err = new Error("No pending sales found for this order.");
        err.statusCode = 404;
        throw err;
      }

      // Check if a P- draft challan already exists for any of these sales
      const existingPChallans = await client.query(
        `SELECT * FROM challans WHERE sales_id = ANY($1::uuid[]) AND challan_no LIKE 'P-%' AND is_cancelled = FALSE AND status = 'Pending'`,
        [salesRows.map((s) => s.id)],
      );

      if (existingPChallans.rows.length > 0) {
        return existingPChallans.rows;
      }

      // Generate a single P- draft challan number for all pending items in this order
      const existingCH = await client.query(
        `SELECT challan_no FROM challans WHERE (sales_id = ANY($1::uuid[]) OR ($2 <> '' AND sales_id IN (SELECT id FROM sales WHERE order_no = $2))) AND (challan_no LIKE 'CH-%' OR challan_no LIKE 'CH%') AND is_cancelled = FALSE AND status != 'Delivered' ORDER BY id ASC LIMIT 1`,
        [salesRows.map((s) => s.id), orderNo || salesRows[0]?.order_no || ""],
      );
      let pGroupNum;
      if (existingCH.rows.length > 0) {
        const candidate = existingCH.rows[0].challan_no.replace(/^CH-?/, "P-");
        const candidateExists = await client.query(
          "SELECT 1 FROM challans WHERE challan_no = $1 AND is_cancelled = FALSE",
          [candidate],
        );
        if (candidateExists.rows.length === 0) {
          pGroupNum = candidate;
        } else {
          pGroupNum = await getNextChallanNumber("P-", client);
        }
      } else {
        pGroupNum = await getNextChallanNumber("P-", client);
      }
      const createdChallans = [];

      for (const sale of salesRows) {
        // Calculate covered qty by active (non-delivered, non-cancelled) challans
        const coveredRes = await client.query(
          `SELECT SUM(quantity) as sum FROM challans WHERE sales_id = $1 AND is_cancelled = FALSE AND status != 'Delivered'`,
          [sale.id],
        );
        const coveredQty = Number(coveredRes.rows[0]?.sum || 0);
        const unhandledQty = Math.max(
          0,
          Number(sale.pending_qty || 0) - coveredQty,
        );

        if (unhandledQty > 0) {
          const insRes = await client.query(
            `INSERT INTO challans 
            (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled, is_order) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', CURRENT_DATE, $8, $9, FALSE, FALSE, FALSE, $10) RETURNING *`,
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
              Boolean(sale.is_order),
            ],
          );
          createdChallans.push(insRes.rows[0]);
        }
      }

      return createdChallans;
    });

    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Confirm an entire challan group (Pending → Confirmed, no stock deduction)
app.put("/api/challans/group/:challanNumber/confirm", async (req, res) => {
  const { challanNumber } = req.params;
  try {
    await db.withTransaction(async (client) => {
      const challanRes = await client.query(
        "SELECT * FROM challans WHERE challan_no = $1 AND is_cancelled = FALSE AND status != 'Delivered'",
        [challanNumber],
      );
      if (challanRes.rows.length === 0) {
        const err = new Error("No confirmable challan items found.");
        err.statusCode = 404;
        throw err;
      }
      // Update all items to Confirmed and refresh updated_at
      await client.query(
        "UPDATE challans SET status = 'Confirmed', updated_at = CURRENT_TIMESTAMP WHERE challan_no = $1 AND is_cancelled = FALSE AND status = 'Pending'",
        [challanNumber],
      );
      // Update related sales to Confirmed (if Pending) and refresh updated_at on all related sales
      const salesIds = [
        ...new Set(challanRes.rows.map((c) => c.sales_id).filter(Boolean)),
      ];
      for (const sid of salesIds) {
        await client.query(
          "UPDATE sales SET status = CASE WHEN status = 'Pending' THEN 'Confirmed' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
          [sid],
        );
      }
    });

    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Deliver an entire challan group — FIFO stock deduction for every item
app.put("/api/challans/group/:challanNumber/deliver", async (req, res) => {
  const { challanNumber } = req.params;
  const { deliveryDate, deliveredAt } = req.body || {};
  const effectiveDeliveredAt = deliveredAt ? new Date(deliveredAt) : new Date();
  const effectiveDeliveryDate = deliveryDate ? String(deliveryDate).slice(0, 10) : effectiveDeliveredAt.toISOString().slice(0, 10);

  try {
    await db.withTransaction(async (client) => {
      const challanRes = await client.query(
        "SELECT * FROM challans WHERE challan_no = $1 AND is_cancelled = FALSE AND status != 'Delivered'",
        [challanNumber],
      );
      if (challanRes.rows.length === 0) {
        const err = new Error("No deliverable challan items found.");
        err.statusCode = 404;
        throw err;
      }

      for (const challan of challanRes.rows) {
        const quantityToDeliver = Number(challan.quantity || 0);
        if (quantityToDeliver <= 0) {
          await client.query("DELETE FROM challans WHERE id = $1", [
            challan.id,
          ]);
          continue;
        }
        const stockCategory = challan.stock_category || "Available";
        const productName = challan.product;
        const batchNo = challan.batch_no;

        const lastBatchNo = batchNo;

        // Update related sale
        if (challan.sales_id) {
          const saleRes = await client.query(
            "SELECT * FROM sales WHERE id = $1",
            [challan.sales_id],
          );
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
            await client.query(
              "UPDATE sales SET delivered_qty = $1, pending_qty = $2, status = $3, delivered_at = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5",
              [newDeliveredQty, newPendingQty, newStatus, effectiveDeliveredAt, challan.sales_id],
            );
          }
        }

        // Mark challan item as Delivered
        await client.query(
          "UPDATE challans SET status = 'Delivered', batch_no = $1, delivered_at = $2, delivery_date = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4",
          [lastBatchNo || batchNo || "0", effectiveDeliveredAt, effectiveDeliveryDate, challan.id],
        );
      }
    });

    res.json({ success: true, deliveryDate: effectiveDeliveryDate });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Update bill_no for an entire challan group
app.put("/api/challans/group/:challanNumber/bill", async (req, res) => {
  const { challanNumber } = req.params;
  const { billNo, bill_no } = req.body;
  const finalBillNo = (billNo !== undefined ? billNo : bill_no) ?? null;
  try {
    await db.query("UPDATE challans SET bill_no = $1 WHERE challan_no = $2", [
      finalBillNo,
      challanNumber,
    ]);
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
    // Also delete any linked P-xxx drafts for ALL sales in this challan/order
    const allSalesIds = Array.from(
      new Set(existing.rows.map((r) => r.sales_id).filter(Boolean)),
    );
    const isCancelled = existing.rows.some(
      (r) => r.is_cancelled || r.status === "Cancelled",
    );
    if (allSalesIds.length > 0) {
      if (isCancelled) {
        // If deleting a cancelled challan, delete all cancelled challans for all sales in this order (both CH- and P-)
        await db.query(
          "DELETE FROM challans WHERE sales_id = ANY($1::uuid[]) AND is_cancelled = TRUE",
          [allSalesIds],
        );
      }
      await db.query(
        "DELETE FROM challans WHERE sales_id = ANY($1::uuid[]) AND challan_no LIKE 'P-%'",
        [allSalesIds],
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
    await db.withTransaction(async (client) => {
      const challanRes = await client.query(
        "SELECT * FROM challans WHERE id = $1",
        [id],
      );

      if (challanRes.rows.length > 0) {
        const challan = challanRes.rows[0];

        if (challan.status === "Delivered" && !challan.is_cancelled) {
          const stockCategory = challan.stock_category || "Available";
          const restoreQty = Number(challan.quantity || 0);
          if (restoreQty > 0) {
            await restoreStock(
              challan.product,
              challan.batch_no || "0",
              restoreQty,
              stockCategory,
              client,
            );
          }

          // Update Sale quantities and status
          const saleRes = await client.query(
            "SELECT * FROM sales WHERE id = $1",
            [challan.sales_id],
          );
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
            await client.query(
              "UPDATE sales SET delivered_qty = $1, pending_qty = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4",
              [newDelivered, newPending, newStatus, sale.id],
            );
          }
        }

        await client.query("DELETE FROM challans WHERE id = $1", [id]);
      }
    });

    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
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
  const nameGujaratiTrimmed =
    name_gujarati || nameGujarati
      ? String(name_gujarati || nameGujarati).trim()
      : null;
  const phoneTrimmed = phone ? String(phone).trim() : "";

  if (!nameTrimmed) {
    return res.status(400).json({ error: "Client name is required" });
  }

  try {
    // Check duplicate name
    const existingName = await db.query(
      "SELECT id, name FROM clients WHERE LOWER(TRIM(name)) = LOWER($1)",
      [nameTrimmed],
    );
    if (existingName.rows.length > 0) {
      return res
        .status(400)
        .json({ error: `Client "${nameTrimmed}" already exists in DB` });
    }

    // Check duplicate phone
    if (phoneTrimmed) {
      const existingPhone = await db.query(
        "SELECT id, name FROM clients WHERE TRIM(phone) = $1",
        [phoneTrimmed],
      );
      if (existingPhone.rows.length > 0) {
        return res.status(400).json({
          error: `Phone number "${phoneTrimmed}" is already registered to "${existingPhone.rows[0].name}"`,
        });
      }
    }

    const result = await db.query(
      "INSERT INTO clients (name, name_gujarati, phone, price_category) VALUES ($1, $2, $3, $4) RETURNING *",
      [
        nameTrimmed,
        nameGujaratiTrimmed,
        phoneTrimmed,
        price_category || "Regular",
      ],
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
    const responsePayload = await db.withTransaction(async (client) => {
      // Fetch existing clients to check for duplicate names and phone numbers
      const existingDbClients = await client.query(
        "SELECT id, name, phone FROM clients",
      );

      const existingNames = new Map(); // nameLower -> row
      const existingPhones = new Map(); // phoneTrimmed -> row

      for (const row of existingDbClients.rows) {
        if (row.name) existingNames.set(row.name.trim().toLowerCase(), row);
        if (row.phone && row.phone.trim())
          existingPhones.set(row.phone.trim(), row);
      }

      const inserted = [];
      const skipped = [];

      for (const c of clients) {
        const nameTrimmed = c.name ? String(c.name).trim() : "";
        const phoneTrimmed = c.phone ? String(c.phone).trim() : "";
        const nameGujaratiTrimmed =
          c.name_gujarati || c.nameGujarati
            ? String(c.name_gujarati || c.nameGujarati).trim()
            : null;
        const nameLower = nameTrimmed.toLowerCase();

        if (!nameTrimmed) {
          skipped.push({ ...c, reason: "Missing client name" });
          continue;
        }

        const nameMatch = existingNames.get(nameLower);
        const phoneMatch = phoneTrimmed
          ? existingPhones.get(phoneTrimmed)
          : null;

        if (nameMatch && phoneMatch) {
          const phoneOwner = phoneMatch.name;
          const reason =
            phoneOwner.toLowerCase() !== nameLower
              ? `Name & Phone exist (Phone used by "${phoneOwner}")`
              : `Client "${nameTrimmed}" already exists in DB`;
          skipped.push({ ...c, reason });
          continue;
        }

        if (nameMatch) {
          skipped.push({
            ...c,
            reason: `Client name "${nameTrimmed}" already exists in DB`,
          });
          continue;
        }

        if (phoneMatch) {
          skipped.push({
            ...c,
            reason: `Phone number "${phoneTrimmed}" already belongs to "${phoneMatch.name}"`,
          });
          continue;
        }

        const result = await client.query(
          `INSERT INTO clients (name, name_gujarati, phone, price_category)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [
            nameTrimmed,
            nameGujaratiTrimmed,
            phoneTrimmed,
            c.price_category ? String(c.price_category).trim() : "Regular",
          ],
        );

        const newRow = result.rows[0];
        inserted.push(newRow);
        existingNames.set(nameLower, newRow);
        if (phoneTrimmed) {
          existingPhones.set(phoneTrimmed, newRow);
        }
      }

      return {
        success: true,
        count: inserted.length,
        skippedCount: skipped.length,
        clients: inserted,
        skipped,
      };
    });

    res.json(responsePayload);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.put("/api/clients/:id", async (req, res) => {
  const { id } = req.params;
  const { name, name_gujarati, nameGujarati, phone, price_category } = req.body;
  const nameTrimmed = name ? String(name).trim() : "";
  const nameGujaratiRaw =
    name_gujarati !== undefined ? name_gujarati : nameGujarati;
  const nameGujaratiTrimmed =
    nameGujaratiRaw !== undefined
      ? nameGujaratiRaw
        ? String(nameGujaratiRaw).trim()
        : null
      : undefined;
  const phoneTrimmed = phone ? String(phone).trim() : "";

  try {
    if (nameTrimmed) {
      const existingName = await db.query(
        "SELECT id, name FROM clients WHERE LOWER(TRIM(name)) = LOWER($1) AND id != $2",
        [nameTrimmed, id],
      );
      if (existingName.rows.length > 0) {
        return res
          .status(400)
          .json({
            error: `Another client named "${nameTrimmed}" already exists`,
          });
      }
    }

    if (phoneTrimmed) {
      const existingPhone = await db.query(
        "SELECT id, name FROM clients WHERE TRIM(phone) = $1 AND id != $2",
        [phoneTrimmed, id],
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

async function allocateHoldStock(
  productName,
  batchNo,
  quantityToHold,
  client = null,
) {
  const q = client || db;
  const qty = Number(quantityToHold || 0);
  const cleanProduct = (productName || "").trim();
  const specified = isBatchSpecified(batchNo);
  const cleanBatch = specified ? String(batchNo).trim() : null;

  if (qty <= 0 || !cleanProduct) return { heldQty: 0, batchNo: cleanBatch };

  // 1. Query matching batches
  let bQuery = `SELECT id, batch_number, available_qty FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))`;
  let bParams = [cleanProduct];
  if (specified) {
    bQuery += " AND LOWER(TRIM(batch_number)) = LOWER(TRIM($2))";
    bParams.push(cleanBatch);
  }
  bQuery += " ORDER BY date ASC, id ASC";

  const batchesResult = await q.query(bQuery, bParams);

  if (batchesResult.rows.length === 0) {
    if (specified) {
      const err = new Error(
        `Batch "${cleanBatch}" does not exist for product "${cleanProduct}".`,
      );
      err.statusCode = 400;
      throw err;
    } else {
      const err = new Error(
        `No stock batches found for product "${cleanProduct}".`,
      );
      err.statusCode = 400;
      throw err;
    }
  }

  let remainingToHold = qty;
  let lastBatchNo = cleanBatch;

  // Allocate across batches with positive available_qty first (FIFO)
  for (const b of batchesResult.rows) {
    if (remainingToHold <= 0) break;
    const avail = Number(b.available_qty || 0);
    if (avail > 0) {
      const canHold = Math.min(remainingToHold, avail);
      await q.query(
        "UPDATE batches SET available_qty = available_qty - $1, hold_qty = COALESCE(hold_qty, 0) + $1 WHERE id = $2",
        [canHold, b.id],
      );
      remainingToHold -= canHold;
      lastBatchNo = b.batch_number;
    }
  }

  // If remainingToHold > 0 (insufficient stock), deduct deficit into negative available_qty on designated batch without stealing
  if (remainingToHold > 0) {
    const designatedBatch = batchesResult.rows[0];
    await q.query(
      "UPDATE batches SET available_qty = available_qty - $1, hold_qty = COALESCE(hold_qty, 0) + $1 WHERE id = $2",
      [remainingToHold, designatedBatch.id],
    );
    lastBatchNo = designatedBatch.batch_number;
    remainingToHold = 0;
  }

  return { heldQty: qty, batchNo: lastBatchNo || cleanBatch };
}

async function revertHoldStock(
  productName,
  batchNo,
  quantityToRevert,
  client = null,
) {
  const q = client || db;
  const qty = Number(quantityToRevert || 0);
  const cleanProduct = (productName || "").trim();
  const specified = isBatchSpecified(batchNo);
  const cleanBatch = specified ? String(batchNo).trim() : null;

  if (qty <= 0 || !cleanProduct) return;

  // Revert hold_qty and restore available_qty on specific lots by ID in reverse order (LIFO)
  let hQuery =
    "SELECT id, hold_qty FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))";
  let hParams = [cleanProduct];
  if (specified) {
    hQuery += " AND LOWER(TRIM(batch_number)) = LOWER(TRIM($2))";
    hParams.push(cleanBatch);
  }
  hQuery += " AND hold_qty > 0 ORDER BY date DESC, id DESC";

  const heldLots = await q.query(hQuery, hParams);
  let remToRevert = qty;

  for (const lot of heldLots.rows) {
    if (remToRevert <= 0) break;
    const inLot = Number(lot.hold_qty || 0);
    const canRevert = Math.min(remToRevert, inLot);
    if (canRevert > 0) {
      await q.query(
        "UPDATE batches SET hold_qty = GREATEST(0, COALESCE(hold_qty, 0) - $1), available_qty = available_qty + $1 WHERE id = $2",
        [canRevert, lot.id],
      );
      remToRevert -= canRevert;
    }
  }

  // Fallback if hold_qty was already 0 on lot rows: restoreStock
  if (remToRevert > 0) {
    await restoreStock(cleanProduct, cleanBatch, remToRevert, "Available", q);
  }
}

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
    const rawBatchNo =
      batch_no !== undefined
        ? batch_no
        : req.body.batchNo !== undefined
          ? req.body.batchNo
          : null;
    const qtyVal = Number(quantity || 0);
    if (qtyVal <= 0 || isNaN(qtyVal)) {
      const err = new Error("Quantity must be greater than 0");
      err.statusCode = 400;
      throw err;
    }

    const result = await db.withTransaction(async (client) => {
      const alloc = await allocateHoldStock(
        product_name,
        rawBatchNo,
        qtyVal,
        client,
      );

      const insertRes = await client.query(
        `INSERT INTO holds (client_name, client_phone, product_name, category, quantity, batch_no, hold_date, held_qty, status) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Active') RETURNING *`,
        [
          client_name,
          client_phone,
          product_name,
          category || "Regular",
          qtyVal,
          alloc.batchNo || null,
          hold_date || new Date().toISOString().split("T")[0],
          alloc.heldQty,
        ],
      );

      return insertRes.rows[0];
    });

    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.put("/api/holds/group", async (req, res) => {
  const { holdIds, clientName, clientPhone, category, holdDate, items } =
    req.body;
  try {
    const rawIds = Array.isArray(holdIds)
      ? holdIds
      : String(holdIds || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

    if (rawIds.length === 0) {
      const err = new Error("Invalid or missing hold IDs");
      err.statusCode = 400;
      throw err;
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      const err = new Error("Hold items cannot be empty");
      err.statusCode = 400;
      throw err;
    }

    // Normalize duplicate items upfront before transactional changes
    const normalizedItems = normalizeOrderItems(items, category || "Regular");

    const result = await db.withTransaction(async (client) => {
      // 1. Fetch existing holds by IDs
      const holdRes = await client.query(
        "SELECT * FROM holds WHERE id = ANY($1)",
        [rawIds],
      );

      if (holdRes.rows.length === 0) {
        const err = new Error(
          "No existing hold records found for the provided IDs",
        );
        err.statusCode = 404;
        throw err;
      }

      if (holdRes.rows.length !== rawIds.length) {
        const err = new Error("One or more hold records not found");
        err.statusCode = 404;
        throw err;
      }

      // Verify all hold rows belong to the same client/order group
      const firstCustomer = (holdRes.rows[0].client_name || "")
        .trim()
        .toLowerCase();
      const allSameCustomer = holdRes.rows.every(
        (h) => (h.client_name || "").trim().toLowerCase() === firstCustomer,
      );
      if (!allSameCustomer) {
        const err = new Error("Provided hold IDs belong to different clients");
        err.statusCode = 400;
        throw err;
      }

      const effectiveClientName = clientName || holdRes.rows[0].client_name;
      const effectiveClientPhone =
        clientPhone !== undefined ? clientPhone : holdRes.rows[0].client_phone;
      const effectiveCategory =
        category || holdRes.rows[0].category || "Regular";
      const effectiveHoldDate =
        holdDate ||
        holdRes.rows[0].hold_date ||
        new Date().toISOString().split("T")[0];

      // 2. Revert existing hold quantities to batches
      for (const oldHold of holdRes.rows) {
        const qtyToRevert = Number(
          oldHold.held_qty !== null && oldHold.held_qty !== undefined
            ? oldHold.held_qty
            : oldHold.quantity || 0,
        );
        if (qtyToRevert > 0) {
          await revertHoldStock(
            oldHold.product_name,
            oldHold.batch_no,
            qtyToRevert,
            client,
          );
        }
      }

      // 3. Delete old holds
      await client.query("DELETE FROM holds WHERE id = ANY($1)", [rawIds]);

      // 4. Allocate stock and insert new hold items
      const createdHolds = [];
      for (const item of normalizedItems) {
        const qtyToHold = Number(item.quantity || 0);
        const alloc = await allocateHoldStock(
          item.productName,
          item.batchNo,
          qtyToHold,
          client,
        );

        const insertRes = await client.query(
          `INSERT INTO holds (client_name, client_phone, product_name, category, quantity, batch_no, hold_date, held_qty, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Active') RETURNING *`,
          [
            effectiveClientName,
            effectiveClientPhone,
            item.productName,
            effectiveCategory,
            qtyToHold,
            alloc.batchNo || null,
            effectiveHoldDate,
            alloc.heldQty,
          ],
        );
        createdHolds.push(insertRes.rows[0]);
      }

      return createdHolds;
    });

    res.json({ success: true, holds: result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete("/api/holds/cancel/:id", async (req, res) => {
  const { id } = req.params;
  const ids = id.split(",");
  try {
    await db.withTransaction(async (client) => {
      const holdRes = await client.query(
        "SELECT * FROM holds WHERE id = ANY($1)",
        [ids],
      );
      if (holdRes.rows.length > 0) {
        for (const hold of holdRes.rows) {
          const qtyToRestore = Number(
            hold.held_qty !== null && hold.held_qty !== undefined
              ? hold.held_qty
              : hold.quantity || 0,
          );
          if (qtyToRestore > 0) {
            await revertHoldStock(
              hold.product_name,
              hold.batch_no,
              qtyToRestore,
              client,
            );
          }
        }

        await client.query("DELETE FROM holds WHERE id = ANY($1)", [ids]);
      }
    });

    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete("/api/holds/:id", async (req, res) => {
  const { id } = req.params;
  const ids = (id || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    return res.status(400).json({ error: "Invalid or missing hold ID" });
  }

  try {
    const result = await db.withTransaction(async (client) => {
      // 1. Lock and fetch holds to ensure atomic, single execution
      const holdRes = await client.query(
        "SELECT * FROM holds WHERE id = ANY($1) FOR UPDATE",
        [ids],
      );

      if (holdRes.rows.length === 0) {
        const err = new Error("No active holds found for the provided IDs.");
        err.statusCode = 404;
        throw err;
      }

      const holdsToRelease = holdRes.rows;

      // 2. Pre-calculate pool availability per (product, batch) across all releasing items.
      // Pool key is normalized product and batch.
      const poolTotals = new Map();
      for (const hold of holdsToRelease) {
        const heldQty =
          hold.held_qty !== null && hold.held_qty !== undefined
            ? Number(hold.held_qty)
            : Number(hold.quantity || 0);
        const rawBatch = hold.batch_no;
        const isSpecified = isBatchSpecified(rawBatch);
        const bNo = isSpecified ? String(rawBatch).trim().toLowerCase() : "";
        const poolKey = `${(hold.product_name || "").toLowerCase().trim()}|${bNo}`;
        poolTotals.set(poolKey, (poolTotals.get(poolKey) || 0) + heldQty);
      }

      const poolRunningStock = new Map();
      for (const [poolKey, totalHeldInRelease] of poolTotals.entries()) {
        const [prodName, bNo] = poolKey.split("|");
        const isSpecified = Boolean(bNo);

        let bQuery =
          "SELECT id, batch_number, available_qty, hold_qty FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))";
        let bParams = [prodName];
        if (isSpecified) {
          bQuery += " AND LOWER(TRIM(batch_number)) = LOWER(TRIM($2))";
          bParams.push(bNo);
        }
        bQuery += " ORDER BY date ASC, id ASC";

        const batchesRes = await client.query(bQuery, bParams);
        const currentAvail = batchesRes.rows.reduce(
          (sum, b) => sum + Number(b.available_qty || 0),
          0,
        );

        // Physical on-hand stock available to satisfy the items in this release:
        // currentAvail is net available after all holds. Adding totalHeldInRelease restores
        // the physical stock that these specific releasing holds reserved.
        const physicalStockForRelease = Math.max(
          0,
          currentAvail + totalHeldInRelease,
        );
        poolRunningStock.set(poolKey, physicalStockForRelease);
      }

      // 3. Determine fulfillable vs pending shortage for each item
      let hasCH = false;
      let hasP = false;

      const itemsDetails = holdsToRelease.map((hold) => {
        const heldQty =
          hold.held_qty !== null && hold.held_qty !== undefined
            ? Number(hold.held_qty)
            : Number(hold.quantity || 0);
        const requestedQty = Number(hold.quantity || 0);

        const rawBatch = hold.batch_no;
        const isSpecified = isBatchSpecified(rawBatch);
        const bNo = isSpecified ? String(rawBatch).trim().toLowerCase() : "";
        const poolKey = `${(hold.product_name || "").toLowerCase().trim()}|${bNo}`;

        const poolAvail = poolRunningStock.get(poolKey) || 0;
        const fulfillableQty = Math.min(requestedQty, poolAvail);
        const pendingQty = Math.max(0, requestedQty - fulfillableQty);

        // Update running physical stock for subsequent items sharing this poolKey
        poolRunningStock.set(poolKey, Math.max(0, poolAvail - fulfillableQty));

        if (fulfillableQty > 0) hasCH = true;
        if (pendingQty > 0) hasP = true;

        return {
          hold,
          heldQty,
          fulfillableQty,
          pendingQty,
        };
      });

      // 4. Generate document numbers
      const orderNum = `ORD-${Date.now().toString(36).toUpperCase()}`;
      let challanNum = null;
      let pChallanNum = null;

      if (hasCH) {
        challanNum = await getNextChallanNumber("CH-", client);
      }
      if (hasP) {
        if (hasCH && challanNum) {
          pChallanNum = challanNum.replace(/^CH-?/, "P-");
        } else {
          pChallanNum = await getNextChallanNumber("P-", client);
        }
      }

      // 5. Process each item: decrement hold_qty from batches, insert sale, insert challan(s)
      for (const details of itemsDetails) {
        const { hold, heldQty, fulfillableQty, pendingQty } = details;
        const quantityVal = Number(hold.quantity || 0);

        // Subtract hold_qty from the batches that actually have hold_qty for this product/batch
        if (heldQty > 0) {
          const rawBatch = hold.batch_no;
          const isSpecified = isBatchSpecified(rawBatch);
          const bNo = isSpecified ? String(rawBatch).trim() : null;

          let hQuery =
            "SELECT id, hold_qty FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))";
          let hParams = [hold.product_name];
          if (isSpecified) {
            hQuery += " AND LOWER(TRIM(batch_number)) = LOWER(TRIM($2))";
            hParams.push(bNo);
          }
          hQuery += " AND hold_qty > 0 ORDER BY date ASC, id ASC";

          const heldLots = await client.query(hQuery, hParams);
          let remToDeduct = heldQty;
          for (const lot of heldLots.rows) {
            if (remToDeduct <= 0) break;
            const inLot = Number(lot.hold_qty || 0);
            const canDeduct = Math.min(remToDeduct, inLot);
            if (canDeduct > 0) {
              await client.query(
                "UPDATE batches SET hold_qty = GREATEST(0, COALESCE(hold_qty, 0) - $1) WHERE id = $2",
                [canDeduct, lot.id],
              );
              remToDeduct -= canDeduct;
            }
          }
        }

        // Insert into sales table sharing the same order number
        const saleInsertRes = await client.query(
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
            hold.batch_no || null,
            "Pending",
          ],
        );

        const createdSale = saleInsertRes.rows[0];

        // Insert into delivery challans using the shared challan number
        if (fulfillableQty > 0 && challanNum) {
          await client.query(
            `INSERT INTO challans 
            (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'Confirmed', CURRENT_DATE, 'Release from stock', 'Available', FALSE, FALSE, FALSE)`,
            [
              challanNum,
              createdSale.id,
              hold.client_name,
              hold.client_phone,
              hold.product_name,
              hold.batch_no || null,
              fulfillableQty,
            ],
          );
        }

        // Insert into pending challans for the shortage
        if (pendingQty > 0 && pChallanNum) {
          await client.query(
            `INSERT INTO challans 
            (challan_no, sales_id, customer, client_phone, product, batch_no, quantity, status, created_at, notes, stock_category, is_printed, is_built, is_cancelled) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', CURRENT_DATE, 'Release from stock', 'Available', FALSE, FALSE, FALSE)`,
            [
              pChallanNum,
              createdSale.id,
              hold.client_name,
              hold.client_phone,
              hold.product_name,
              hold.batch_no || null,
              pendingQty,
            ],
          );
        }
      }

      // Delete the released holds
      await client.query("DELETE FROM holds WHERE id = ANY($1)", [ids]);

      return {
        success: true,
        orderNo: orderNum,
        challanNo: challanNum,
        pChallanNo: pChallanNum,
      };
    });

    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
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

if (require.main === module) {
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
}

module.exports = {
  app,
  isBatchSpecified,
  deductStock,
  restoreStock,
  resolveNegativeStock,
  reconcileAllProductStocks,
  normalizeOrderItems,
  allocateHoldStock,
  revertHoldStock,
  handleOrderGroupUpdate,
};
