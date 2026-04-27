// Populate mintage_reference from the workbook's four *Mintage sheets.
// The sheets are messy — mixed layouts, junk columns, some rows with
// `PROOF` or `SILVER` tags — so this script is deliberately lenient: it
// only extracts {year, mint} combos for standard circulation strikes
// and skips anything it can't confidently parse. Mintage counts are
// NOT imported (inconsistent presence across sheets; gaps view doesn't
// need them for v1).
//
// Runs idempotently — inserts use ON CONFLICT DO NOTHING keyed on
// (series_id, year, mint_id). Re-run at any time after editing the
// source workbook.

import pg from 'pg';
import XLSX from 'xlsx';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import 'dotenv/config';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKBOOK = resolve(__dirname, '../data/source/Coin_Collection_v1_8.xlsm');

// Each sheet's layout is unique — driver for the parser.
const SHEET_CONFIGS = [
  {
    sheet: 'NickelMintage',
    series: 'Jefferson Nickel',
    yearCol: 0, // column A
    // Header row at 0, actual data starts row 1. Skip any row where col A
    // isn't a year or year+mint.
    skipRows: 1,
  },
  {
    sheet: 'DimeMintage',
    // Series comes from column D ("MAKE") — MERCURY DIMES or ROOSEVELT
    series: null,
    seriesFromCol: 3,
    seriesMap: {
      'MERCURY DIMES': 'Mercury Dime',
      ROOSEVELT: 'Roosevelt Dime',
    },
    yearCol: 0,
    // Skip proof/silver rows — those aren't circulation strikes.
    proofCol: 1,
    typeCol: 2,
    skipRows: 1,
  },
  {
    sheet: 'QuarterMintage',
    series: 'Washington Quarter',
    yearCol: 0,
    skipRows: 1,
  },
  {
    sheet: 'HalfMintage',
    series: 'Kennedy Half',
    yearCol: 0,
    skipRows: 1,
  },
];

// "1938", "1938-D", "1938 D", "1938D" all become {year, mint}.
// Returns null when the cell isn't parseable as a year.
function parseYearMint(cell) {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'number' && cell >= 1700 && cell <= 2100) {
    return { year: Math.floor(cell), mint: 'P' };
  }
  const s = String(cell).trim();
  if (!s) return null;
  const m = s.match(/^(1[7-9]\d{2}|20\d{2})[\s\-]*([A-Z]{1,2})?$/i);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  let mint = (m[2] || 'P').toUpperCase();
  // CC (Carson City) + O (New Orleans) are real; accept ordinary P/D/S/W too.
  if (!['P', 'D', 'S', 'W', 'CC', 'O'].includes(mint)) return null;
  return { year, mint };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set — copy .env.example to .env');
  const client = new Client({ connectionString: url });
  await client.connect();

  // Cache lookups
  const seriesCache = new Map();
  async function seriesId(name) {
    if (seriesCache.has(name)) return seriesCache.get(name);
    const { rows } = await client.query('SELECT id FROM coin_series WHERE name = $1', [name]);
    if (!rows[0]) throw new Error(`Series not found in DB: ${name}`);
    seriesCache.set(name, rows[0].id);
    return rows[0].id;
  }
  const mintCache = new Map();
  async function mintId(code) {
    if (mintCache.has(code)) return mintCache.get(code);
    const { rows } = await client.query('SELECT id FROM mints WHERE code = $1', [code]);
    if (!rows[0]) throw new Error(`Mint not found in DB: ${code}`);
    mintCache.set(code, rows[0].id);
    return rows[0].id;
  }

  const wb = XLSX.readFile(WORKBOOK, { cellDates: true });
  const summary = [];

  try {
    await client.query('BEGIN');
    for (const cfg of SHEET_CONFIGS) {
      const sheet = wb.Sheets[cfg.sheet];
      if (!sheet) {
        console.warn(`skip ${cfg.sheet} — sheet missing`);
        continue;
      }
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: false });
      let inserted = 0;
      let skipped = 0;
      let skippedProof = 0;
      let skippedUnparseable = 0;

      for (let i = cfg.skipRows; i < aoa.length; i++) {
        const row = aoa[i];

        // Filter proof/silver rows (DimeMintage)
        if (cfg.proofCol !== undefined && row[cfg.proofCol]) {
          skippedProof++;
          continue;
        }
        if (cfg.typeCol !== undefined && row[cfg.typeCol] && /silver/i.test(String(row[cfg.typeCol]))) {
          skippedProof++;
          continue;
        }

        const yrMint = parseYearMint(row[cfg.yearCol]);
        if (!yrMint) {
          if (row[cfg.yearCol] !== null && row[cfg.yearCol] !== undefined && String(row[cfg.yearCol]).trim()) {
            skippedUnparseable++;
          } else {
            skipped++;
          }
          continue;
        }

        // Resolve series
        let seriesName = cfg.series;
        if (!seriesName && cfg.seriesFromCol !== undefined) {
          const raw = row[cfg.seriesFromCol];
          if (!raw) { skipped++; continue; }
          seriesName = cfg.seriesMap[String(raw).trim().toUpperCase()];
          if (!seriesName) { skipped++; continue; }
        }

        const sid = await seriesId(seriesName);
        const mid = await mintId(yrMint.mint);
        const res = await client.query(
          `INSERT INTO mintage_reference (series_id, year, mint_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (series_id, year, mint_id) DO NOTHING
           RETURNING id`,
          [sid, yrMint.year, mid],
        );
        if (res.rowCount === 1) inserted++;
      }
      summary.push({
        sheet: cfg.sheet,
        series: cfg.series || `(from col ${cfg.seriesFromCol})`,
        inserted,
        blankSkipped: skipped,
        proofSkipped: skippedProof,
        unparseable: skippedUnparseable,
      });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }

  console.log('\nMintage import summary:');
  console.table(summary);
  const { rows: counts } = await (async () => {
    const c = new Client({ connectionString: url });
    await c.connect();
    const r = await c.query(`
      SELECT s.name, COUNT(m.id)::int AS mintage_rows
      FROM coin_series s
      LEFT JOIN mintage_reference m ON m.series_id = s.id
      GROUP BY s.name
      HAVING COUNT(m.id) > 0
      ORDER BY 2 DESC
    `);
    await c.end();
    return r;
  })();
  console.log('\nmintage_reference row counts:');
  console.table(counts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
