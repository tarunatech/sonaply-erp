const db = require('./db');

const COMMON_TRADE_MAP = {
  THE: 'ધ',
  HONEST: 'ઓનેસ્ટ',
  SALES: 'સેલ્સ',
  SELECT: 'સિલેક્ટ',
  LIMITLESS: 'લિમિટલેસ',
  LUXURY: 'લક્ઝરી',
  HARDWARE: 'હાર્ડવેર',
  HARDWARES: 'હાર્ડવેર્સ',
  ENTERPRISE: 'એન્ટરપ્રાઈઝ',
  ENTERPRISES: 'એન્ટરપ્રાઈઝીસ',
  TOUCH: 'ટચ',
  PLY: 'પ્લાય',
  PLYWOOD: 'પ્લાયવુડ',
  WOOD: 'વુડ',
  INTERIOR: 'ઇન્ટિરિયર',
  INTERIORS: 'ઇન્ટિરિયર્સ',
  ASSOCIATES: 'એસોસિએટ્સ',
  TRADERS: 'ટ્રેડર્સ',
  TRADER: 'ટ્રેડર',
  TRADING: 'ટ્રેડિંગ',
  TIMBER: 'ટીમ્બર',
  DOOR: 'ડોર',
  DOORS: 'ડોર્સ',
  LAMINATE: 'લેમિનેટ',
  LAMINATES: 'લેમિનેટ્સ',
  FURNITURE: 'ફર્નિચર',
  GLASS: 'ગ્લાસ',
  KITCHEN: 'કિચન',
  ALUMINIUM: 'એલ્યુમિનિયમ',
  DECOR: 'ડેકોર',
  DECORS: 'ડેકોર્સ',
  WORLD: 'વર્લ્ડ',
  HOUSE: 'હાઉસ',
  HOME: 'હોમ',
  CENTER: 'સેન્ટર',
  CENTRE: 'સેન્ટર',
  MART: 'માર્ટ',
  STORE: 'સ્ટોર',
  STORES: 'સ્ટોર્સ',
  AGENCY: 'એજન્સી',
  AGENCIES: 'એજન્સીસ',
  COMPANY: 'કંપની',
  CORP: 'કોર્પ',
  CORPORATION: 'કોર્પોરેશન',
  AND: 'એન્ડ',
  '&': '&',
};

async function transliterateSingleWord(word) {
  const upper = word.toUpperCase();
  if (COMMON_TRADE_MAP[upper]) return COMMON_TRADE_MAP[upper];
  if (/^[\u0A80-\u0AFF]+$/.test(word)) return word;
  if (/^[^a-zA-Z0-9]+$/.test(word)) return word;

  try {
    const url = `https://inputtools.google.com/request?text=${encodeURIComponent(word)}&itc=gu-t-i0-und&num=5&cp=0&cs=1&ie=utf-8&oe=utf-8&app=test`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && data[0] === 'SUCCESS' && Array.isArray(data[1]) && data[1].length > 0) {
        const cand = data[1][0];
        if (cand && Array.isArray(cand[1]) && cand[1].length > 0) {
          return cand[1][0];
        }
      }
    }
  } catch (err) {
    console.error(`Transliteration error for "${word}":`, err.message);
  }
  return word;
}

async function transliterateText(text) {
  if (!text || !text.trim()) return '';
  const tokens = text.trim().split(/(\s+|\(|\)|\/|\-|\,|\&)/);
  const results = [];
  for (const token of tokens) {
    if (!token) continue;
    if (/^\s+$/.test(token) || /^[\(\)\/\-\,\&]+$/.test(token)) {
      results.push(token);
    } else {
      results.push(await transliterateSingleWord(token));
    }
  }
  return results
    .join('')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

async function migrateGujaratiClientNames() {
  const isForce = process.argv.includes('--force') || process.argv.includes('--all');
  console.log(`🚀 Starting Gujarati client names migration (${isForce ? 'UPDATING ALL CLIENTS' : 'updating missing names only'})...`);
  try {
    // 1. Ensure column exists
    await db.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS name_gujarati TEXT');

    // 2. Fetch clients
    const query = isForce
      ? 'SELECT id, name FROM clients ORDER BY created_at ASC'
      : "SELECT id, name FROM clients WHERE name_gujarati IS NULL OR TRIM(name_gujarati) = '' ORDER BY created_at ASC";

    const clientsRes = await db.query(query);
    const clients = clientsRes.rows;
    console.log(`Found ${clients.length} client(s) to transliterate.`);

    if (clients.length === 0) {
      console.log('✅ All clients already have Gujarati names populated.');
      return;
    }

    let updatedCount = 0;
    for (let i = 0; i < clients.length; i++) {
      const client = clients[i];
      const gujaratiName = await transliterateText(client.name);

      if (gujaratiName) {
        await db.query('UPDATE clients SET name_gujarati = $1 WHERE id = $2', [
          gujaratiName,
          client.id,
        ]);
        updatedCount++;
        console.log(`[${i + 1}/${clients.length}] "${client.name}" ➔ "${gujaratiName}"`);
      } else {
        console.log(`[${i + 1}/${clients.length}] Could not convert "${client.name}"`);
      }

      // Small delay between requests
      await new Promise((resolve) => setTimeout(resolve, 80));
    }

    console.log(`\n✅ Gujarati client names migration complete! Updated ${updatedCount} of ${clients.length} client(s).`);
  } catch (err) {
    console.error('❌ Gujarati client names migration failed:', err);
  } finally {
    if (db.pool) {
      await db.pool.end();
      console.log('Disconnected from database.');
    }
    process.exit(0);
  }
}

migrateGujaratiClientNames();
