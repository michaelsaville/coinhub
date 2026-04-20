import XLSX from 'xlsx';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKBOOK = resolve(__dirname, '../data/source/Coin_Collection_v1_8.xlsm');

const wb = XLSX.readFile(WORKBOOK, { cellDates: true });

console.log('SHEETS:', wb.SheetNames);
console.log('');

for (const name of wb.SheetNames) {
  const sheet = wb.Sheets[name];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  console.log(`=== ${name} ===`);
  console.log(`  dimensions: ${sheet['!ref']}  (${range.e.r - range.s.r + 1} rows x ${range.e.c - range.s.c + 1} cols)`);
  if (rows.length > 0) {
    console.log(`  columns: ${Object.keys(rows[0]).join(' | ')}`);
    console.log(`  first row: ${JSON.stringify(rows[0])}`);
    if (rows.length > 1) console.log(`  second row: ${JSON.stringify(rows[1])}`);
  }
  console.log('');
}

// Deeper look at CoinCollection
const coinSheet = wb.Sheets['CoinCollection'];
if (coinSheet) {
  const rows = XLSX.utils.sheet_to_json(coinSheet, { defval: null, raw: true });
  console.log('=== CoinCollection deep ===');
  console.log(`  total rows: ${rows.length}`);

  const mintDist = {};
  const descDist = {};
  const condDist = {};
  const countryLike = new Set();
  let photoColName = null;

  // find the photo-looking column
  for (const k of Object.keys(rows[0] || {})) {
    if (/photo|image|jpg/i.test(k)) photoColName = k;
  }

  for (const r of rows) {
    const m = r.Mint === null ? '<null>' : JSON.stringify(r.Mint);
    mintDist[m] = (mintDist[m] || 0) + 1;
    const d = r.DESC || r.Desc || r.description || '<null>';
    descDist[d] = (descDist[d] || 0) + 1;
    const c = r.Condition || r.condition || '<null>';
    condDist[c] = (condDist[c] || 0) + 1;
    const desc = String(d).toLowerCase();
    if (/canad|marshall|korea|olympic|foreign|mexic|british|euro/.test(desc)) {
      countryLike.add(d);
    }
  }

  console.log(`  photo-ish column: ${photoColName}`);
  console.log(`  Mint distribution:`);
  for (const [k, v] of Object.entries(mintDist).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k}: ${v}`);
  }
  console.log(`  Condition distribution (${Object.keys(condDist).length} unique):`);
  for (const [k, v] of Object.entries(condDist).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${JSON.stringify(k)}: ${v}`);
  }
  console.log(`  DESC unique count: ${Object.keys(descDist).length}`);
  console.log(`  top 25 DESC values:`);
  for (const [k, v] of Object.entries(descDist).sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`    ${JSON.stringify(k)}: ${v}`);
  }
  console.log(`  foreign-looking DESC values (${countryLike.size}):`);
  for (const k of countryLike) console.log(`    ${JSON.stringify(k)}`);
}
