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
    console.error(`Transliteration error for "${text}":`, err.message);
  }
  return "";
}

async function migrateGujaratiClientNames() {
  console.log("🚀 Starting Gujarati client names migration...");
  try {
    // 1. Ensure column exists
    await db.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS name_gujarati TEXT");

    // 2. Fetch clients missing Gujarati name
    const clientsRes = await db.query(
      "SELECT id, name FROM clients WHERE name_gujarati IS NULL OR TRIM(name_gujarati) = '' ORDER BY created_at ASC"
    );

    const clients = clientsRes.rows;
    console.log(`Found ${clients.length} client(s) needing Gujarati transliteration.`);

    if (clients.length === 0) {
      console.log("✅ All clients already have Gujarati names populated.");
      return;
    }

    let updatedCount = 0;
    for (let i = 0; i < clients.length; i++) {
      const client = clients[i];
      const gujaratiName = await transliterateText(client.name);

      if (gujaratiName) {
        await db.query("UPDATE clients SET name_gujarati = $1 WHERE id = $2", [
          gujaratiName,
          client.id,
        ]);
        updatedCount++;
        console.log(`[${i + 1}/${clients.length}] "${client.name}" ➔ "${gujaratiName}"`);
      } else {
        console.log(`[${i + 1}/${clients.length}] Could not convert "${client.name}"`);
      }

      // Small delay between API requests to respect rate limits
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    console.log(`\n✅ Gujarati client names migration complete! Updated ${updatedCount} of ${clients.length} client(s).`);
  } catch (err) {
    console.error("❌ Gujarati client names migration failed:", err);
  } finally {
    if (db.pool) {
      await db.pool.end();
      console.log("Disconnected from database.");
    }
    process.exit(0);
  }
}

migrateGujaratiClientNames();
