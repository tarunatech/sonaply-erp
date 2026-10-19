const { Pool, types } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Parse DATE (OID 1082) as a string directly to prevent timezone shifts
types.setTypeParser(1082, val => val);

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'plywood_erp',
  password: process.env.DB_PASSWORD || 'password',
  port: process.env.DB_PORT || 5432,
  max: 25,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
});

/**
 * Executes a callback within a managed database transaction on a dedicated client.
 * Handles client checkout, BEGIN, COMMIT, ROLLBACK, and client release.
 * Supports nesting: if an existing transaction client is passed, it executes
 * within that transaction without re-issuing BEGIN or COMMIT.
 *
 * @param {Function|object} arg1 - Callback function (client) => Promise<any> or existing client
 * @param {Function|object} [arg2] - Callback function if client was passed as arg1, or existing client
 * @returns {Promise<any>}
 */
async function withTransaction(arg1, arg2) {
  let fn = null;
  let existingClient = null;

  if (typeof arg1 === 'function') {
    fn = arg1;
    existingClient = arg2;
  } else if (typeof arg2 === 'function') {
    existingClient = arg1;
    fn = arg2;
  } else {
    throw new Error('withTransaction requires a callback function');
  }

  // If already inside an existing transaction, reuse the client directly
  if (existingClient && typeof existingClient.query === 'function') {
    return await fn(existingClient);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Failed to rollback transaction:', rollbackErr.message);
    }
    // Always preserve and throw the original error
    throw err;
  } finally {
    // Client must always be released back to the pool
    client.release();
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  withTransaction,
};
