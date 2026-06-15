const db = require('./db');

async function run() {
  try {
    await db.query('ALTER TABLE batches ADD COLUMN is_nil BOOLEAN DEFAULT false');
    console.log('Added is_nil to batches');
  } catch (e) { console.error('is_nil:', e.message) }

  try {
    await db.query('ALTER TABLE batches ADD COLUMN is_cancelled BOOLEAN DEFAULT false');
    console.log('Added is_cancelled to batches');
  } catch (e) { console.error('is_cancelled:', e.message) }
  
  process.exit();
}

run();
