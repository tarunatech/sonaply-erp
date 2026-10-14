const db = require("./db");

async function checkMismatches() {
  const fromDate = process.argv[2] || "2026-08-08";
  const toDate = process.argv[3] || new Date().toISOString().split("T")[0];

  console.log(`Checking stock discrepancies from ${fromDate} to ${toDate}...`);

  const query = `
    WITH prod_stock AS (
      SELECT 
        LOWER(TRIM(product_name)) AS norm_name,
        MAX(product_name) AS product_name,
        MAX(category) AS category,
        SUM(COALESCE(available_qty, 0)) AS current_available,
        SUM(COALESCE(hold_qty, 0)) AS current_hold,
        SUM(COALESCE(display_qty, 0)) AS current_display,
        SUM(COALESCE(damage_qty, 0)) AS current_damage,
        SUM(COALESCE(available_qty, 0) + COALESCE(hold_qty, 0) + COALESCE(display_qty, 0) + COALESCE(damage_qty, 0)) AS current_total_stock
      FROM batches
      GROUP BY LOWER(TRIM(product_name))
    ),
    purchases_agg AS (
      SELECT 
        LOWER(TRIM(product_name)) AS norm_name,
        SUM(COALESCE(quantity, 0)) AS purchase_qty
      FROM purchases
      WHERE date >= $1 AND date <= $2
      GROUP BY LOWER(TRIM(product_name))
    ),
    manual_batches_agg AS (
      SELECT 
        LOWER(TRIM(b.product_name)) AS norm_name,
        SUM(COALESCE(b.quantity, 0)) AS manual_batch_qty
      FROM batches b
      WHERE b.date >= $1 AND b.date <= $2
        AND NOT EXISTS (
          SELECT 1 FROM purchases p
          WHERE LOWER(TRIM(p.product_name)) = LOWER(TRIM(b.product_name))
            AND TRIM(COALESCE(p.batch_number, '0')) = TRIM(COALESCE(b.batch_number, '0'))
        )
      GROUP BY LOWER(TRIM(b.product_name))
    ),
    returns_agg AS (
      SELECT 
        LOWER(TRIM(product_name)) AS norm_name,
        SUM(COALESCE(quantity, 0)) AS return_qty
      FROM sales_returns
      WHERE receive_date >= $1 AND receive_date <= $2
      GROUP BY LOWER(TRIM(product_name))
    ),
    cancelled_sales_agg AS (
      SELECT 
        LOWER(TRIM(product)) AS norm_name,
        SUM(COALESCE(ordered_qty, 0)) AS cancelled_sale_qty
      FROM sales
      WHERE status = 'Cancelled'
        AND COALESCE(DATE(updated_at), order_date) >= $1
        AND COALESCE(DATE(updated_at), order_date) <= $2
      GROUP BY LOWER(TRIM(product))
    ),
    sales_agg AS (
      SELECT 
        LOWER(TRIM(product)) AS norm_name,
        SUM(COALESCE(ordered_qty, 0)) AS sold_qty
      FROM sales
      WHERE COALESCE(order_date, estimated_delivery_date, DATE(created_at)) >= $1
        AND COALESCE(order_date, estimated_delivery_date, DATE(created_at)) <= $2
      GROUP BY LOWER(TRIM(product))
    )
    SELECT 
      ps.product_name,
      ps.category,
      COALESCE(p.purchase_qty, 0) AS purchases,
      COALESCE(mb.manual_batch_qty, 0) AS manual_batches,
      COALESCE(r.return_qty, 0) AS returns,
      COALESCE(cs.cancelled_sale_qty, 0) AS restored_cancelled,
      (COALESCE(p.purchase_qty, 0) + COALESCE(mb.manual_batch_qty, 0) + COALESCE(r.return_qty, 0) + COALESCE(cs.cancelled_sale_qty, 0)) AS total_additions,
      COALESCE(s.sold_qty, 0) AS total_subtractions,
      ((COALESCE(p.purchase_qty, 0) + COALESCE(mb.manual_batch_qty, 0) + COALESCE(r.return_qty, 0) + COALESCE(cs.cancelled_sale_qty, 0)) - COALESCE(s.sold_qty, 0)) AS net_change,
      ps.current_total_stock AS closing_stock,
      ps.current_available AS available_stock,
      (((COALESCE(p.purchase_qty, 0) + COALESCE(mb.manual_batch_qty, 0) + COALESCE(r.return_qty, 0) + COALESCE(cs.cancelled_sale_qty, 0)) - COALESCE(s.sold_qty, 0)) - ps.current_total_stock) AS difference
    FROM prod_stock ps
    LEFT JOIN purchases_agg p ON ps.norm_name = p.norm_name
    LEFT JOIN manual_batches_agg mb ON ps.norm_name = mb.norm_name
    LEFT JOIN returns_agg r ON ps.norm_name = r.norm_name
    LEFT JOIN cancelled_sales_agg cs ON ps.norm_name = cs.norm_name
    LEFT JOIN sales_agg s ON ps.norm_name = s.norm_name
    WHERE ((COALESCE(p.purchase_qty, 0) + COALESCE(mb.manual_batch_qty, 0) + COALESCE(r.return_qty, 0) + COALESCE(cs.cancelled_sale_qty, 0)) - COALESCE(s.sold_qty, 0)) != ps.current_total_stock
    ORDER BY ABS(((COALESCE(p.purchase_qty, 0) + COALESCE(mb.manual_batch_qty, 0) + COALESCE(r.return_qty, 0) + COALESCE(cs.cancelled_sale_qty, 0)) - COALESCE(s.sold_qty, 0)) - ps.current_total_stock) DESC;
  `;

  try {
    const result = await db.query(query, [fromDate, toDate]);
    console.log(`\nFound ${result.rowCount} products with calculation mismatch:\n`);
    console.table(
      result.rows.slice(0, 25).map((r) => ({
        Product: r.product_name,
        Category: r.category,
        "+Add": r.total_additions,
        "-Sub": r.total_subtractions,
        "Net Change": r.net_change,
        "Closing Stock": r.closing_stock,
        "Diff (Net-Close)": r.difference,
      }))
    );

    if (result.rowCount > 25) {
      console.log(`... and ${result.rowCount - 25} more products.`);
    }

    console.log("\n--- Detailed Breakdown of Top Mismatches ---");
    for (const r of result.rows.slice(0, 5)) {
      console.log(`\nProduct: "${r.product_name}" (Category: ${r.category})`);
      const bRes = await db.query(
        "SELECT batch_number, quantity, available_qty, hold_qty, display_qty, damage_qty, date FROM batches WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))",
        [r.product_name]
      );
      const pRes = await db.query(
        "SELECT batch_number, quantity, date FROM purchases WHERE LOWER(TRIM(product_name)) = LOWER(TRIM($1))",
        [r.product_name]
      );
      const sRes = await db.query(
        "SELECT order_no, customer, ordered_qty, delivered_qty, pending_qty, status, order_date FROM sales WHERE LOWER(TRIM(product)) = LOWER(TRIM($1))",
        [r.product_name]
      );
      console.log("  Batches:", bRes.rows);
      console.log("  Purchases:", pRes.rows);
      console.log("  Sales:", sRes.rows);
    }

    return result.rows;
  } catch (err) {
    console.error("Query failed:", err);
  } finally {
    process.exit(0);
  }
}

checkMismatches();
