import pg from 'pg';
import XLSX from 'xlsx';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import 'dotenv/config';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKBOOK = resolve(__dirname, '../data/source/Coin_Collection_v1_8.xlsm');
const OUT_DIR = resolve(__dirname, '../data/output');
const REPORT_PATH = resolve(OUT_DIR, 'import-report.md');

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const DRY_RUN = args.has('--dry-run') || !APPLY;

// ────────────────────────────────────────────────────────────────────────
// Normalization tables — EDIT HERE after reviewing the dry-run report.
// ────────────────────────────────────────────────────────────────────────

const MINT_MAP = {
  '': 'P',
  ' ': 'P',
  'p': 'P',
  'P': 'P',
  'd': 'D',
  'D': 'D',
  's': 'S',
  'S': 'S',
  'w': 'W',
  'W': 'W',
  'cc': 'CC',
  'CC': 'CC',
  'o': 'O',
  'O': 'O',
  // Special markers in source — not real mint marks
  'VDB': 'P',     // 1909 VDB designer initial, Philadelphia
  'SET': 'P',     // marks a multi-coin product; canonical anchor = P
  'D & P': 'P',   // mint set containing both; anchor = P
  '9': 'P',       // likely a data-entry slip
};

// Freeform → canonical grade.  Unknown values fall through to 'UNG' and are
// listed in the report so you can add mappings here before --apply.
const CONDITION_MAP = {
  'poor': 'PO-1',
  'fair': 'FR-2',
  'about good': 'AG-3',
  'ag': 'AG-3',
  'good': 'G-4',
  'g': 'G-4',
  'very good': 'VG-8',
  'vg': 'VG-8',
  'fine': 'F-12',
  'f': 'F-12',
  'very fine': 'VF-20',
  'vf': 'VF-20',
  'extremely fine': 'XF-40',
  'extra fine': 'XF-40',
  'xf': 'XF-40',
  'ef': 'XF-40',
  'about uncirculated': 'AU-50',
  'au': 'AU-50',
  'uncirculated': 'MS-60',
  'unciculated': 'MS-60', // typo seen in source
  'unc': 'MS-60',
  'mint state': 'MS-63',
  'ms': 'MS-63',
  'select uncirculated': 'MS-63',
  'choice uncirculated': 'MS-64',
  'gem uncirculated': 'MS-65',
  'gem': 'MS-65',
  'superb gem': 'MS-67',
  'brilliant uncirculated': 'MS-63',
  'brilliant unciculated': 'MS-63', // typo seen in source
  'bu': 'MS-63',
  'proof': 'PR-65',
  'pr': 'PR-65',
  'pf': 'PR-65',
  'ungraded': 'UNG',
  '': 'UNG',
};

// Maps sheldon grades that appear inline (e.g. 'MS-63', 'AU-55', 'F-12 Fine')
// straight through — accepts trailing descriptive text.
function tryDirectGrade(value) {
  const raw = String(value).trim().toUpperCase();
  const m = raw.match(/^(MS|AU|XF|EF|VF|F|VG|G|AG|FR|PO|PR|PF)-?(\d{1,2})\b/);
  if (!m) return null;
  const prefix = m[1].replace(/^EF$/, 'XF').replace(/^PF$/, 'PR');
  return `${prefix}-${m[2]}`;
}

// Series mapping: DESC (lowercased, trimmed) → canonical series name.
// Covers typos ('murcury dime', 'morgan doller', 'washinton', etc.) seen in source.
// All Lincoln varieties (Wheat 1909-58, Steel 1943, Memorial 1959-2008,
// Bicentennial/Shield 2010-) are the same base "Lincoln Cent" series;
// the year picks the design out.  Proof variants collapse too since
// the Condition field already carries Proof.
const SERIES_MAP = {
  'indian head penny': 'Indian Head Penny',
  'indian head cent': 'Indian Head Penny',
  'lincoln cent': 'Lincoln Cent',
  'lincoln penny': 'Lincoln Cent',
  'lincoln wheat cent': 'Lincoln Cent',
  'lincoln memorial cent': 'Lincoln Cent',
  'wheat penny': 'Lincoln Cent',
  'memorial penny': 'Lincoln Cent',
  'memorial penny proof': 'Lincoln Cent',
  'shield penny': 'Lincoln Cent',
  'shield penny proof': 'Lincoln Cent',
  'shield penny roll': 'Lincoln Cent',
  'steel penny': 'Lincoln Cent',
  'bicentennial penny': 'Lincoln Cent',
  'jefferson nickel proof': 'Jefferson Nickel',
  'kennedy half dollar proof': 'Kennedy Half',
  'morgan dollar proof': 'Morgan Dollar',
  'peace dollar proof': 'Peace Dollar',
  'american eagle unc': 'Silver Eagle Dollar',
  'american eagle proof': 'Silver Eagle Dollar',
  'standing liberty half': 'Walking Liberty Half', // mislabel in source — no "standing liberty half" exists
  'susan b anthony': 'Susan B. Anthony Dollar',
  'susan b anthony souvenir set': 'Susan B. Anthony Dollar',
  // 2004–2005 Westward Journey Jefferson Nickel variants collapse to base series.
  'jefferson nickel peace medal': 'Jefferson Nickel',
  'jefferson nickel peace medal proof': 'Jefferson Nickel',
  'jefferson nickel keelboat': 'Jefferson Nickel',
  'jefferson nickel keelboat proof': 'Jefferson Nickel',
  'jefferson nickel bison proof': 'Jefferson Nickel',
  'jefferson nickel roll ocean in view': 'Jefferson Nickel',
  // Presidential Dollar: one series, president name is captured in comment/year.
  'presidential dollar george washington': 'Presidential Dollar',
  'presidential dollar john tyler': 'Presidential Dollar',
  'presidential dollar james garfield': 'Presidential Dollar',
  'presidential dollar ulysses s. grant': 'Presidential Dollar',
  // Eisenhower variety → base.
  'eisenhower dollar variety i*': 'Eisenhower Dollar',
  'flying eagle cent': 'Flying Eagle Cent',
  'flying eagle': 'Flying Eagle Cent',
  'liberty v nickel': 'Liberty V Nickel',
  'liberty nickel': 'Liberty V Nickel',
  'v nickel': 'Liberty V Nickel',
  'buffalo nickel': 'Buffalo Nickel',
  'jefferson nickel': 'Jefferson Nickel',
  'shield nickel': 'Shield Nickel',
  'mercury dime': 'Mercury Dime',
  'murcury dime': 'Mercury Dime', // typo
  'roosevelt dime': 'Roosevelt Dime',
  'barber dime': 'Barber Dime',
  'washington quarter': 'Washington Quarter',
  'washinton quarter': 'Washington Quarter', // typo
  'barber quarter': 'Barber Quarter',
  'standing liberty quarter': 'Standing Liberty Quarter',
  'walking liberty half': 'Walking Liberty Half',
  'walking liberty half dollar': 'Walking Liberty Half',
  'franklin half': 'Franklin Half',
  'franklin half dollar': 'Franklin Half',
  'kennedy half': 'Kennedy Half',
  'kennedy half dollar': 'Kennedy Half',
  'liberty halp dollar': 'Walking Liberty Half', // typo
  'barber half': 'Barber Half',
  'morgan dollar': 'Morgan Dollar',
  'morgan doller': 'Morgan Dollar', // typo
  'peace dollar': 'Peace Dollar',
  'eisenhower dollar': 'Eisenhower Dollar',
  'ike dollar': 'Eisenhower Dollar',
  'susan b. anthony dollar': 'Susan B. Anthony Dollar',
  'susan b anthony dollar': 'Susan B. Anthony Dollar',
  'sba dollar': 'Susan B. Anthony Dollar',
  'sacagawea dollar': 'Sacagawea Dollar',
  'presidential dollar': 'Presidential Dollar',
  'silver eagle dollar': 'Silver Eagle Dollar',
  'silver eagle': 'Silver Eagle Dollar',
  'eagle dollar': 'Silver Eagle Dollar',
  'american eagle': 'Silver Eagle Dollar',
  'trade dollar': 'Trade Dollar',
  'seated liberty dollar': 'Seated Liberty Dollar',
};

// Fallback prefix match (checked only if SERIES_MAP misses) — lets us collapse
// "Presidential Dollar <anything>" style variants without enumerating every name.
const SERIES_PREFIX_MAP = [
  ['presidential dollar ', 'Presidential Dollar'],
  ['jefferson nickel ', 'Jefferson Nickel'],
  ['kennedy half dollar', 'Kennedy Half'],
];

// Keyword-based series detection for commemoratives, mint sets, and bulk lots.
// Order matters — first hit wins.
const SERIES_KEYWORDS = [
  [/mint set|proof set|uncirculated set|over the years set|collector set|president set|state quarter set/i, 'Mint Set'],
  [/tube|roll\b|penney book|quarters book/i, 'Bulk Lot'],
  [/commem|constitution|uso silver|mt rushmore|stormin|desert storm|heros of|liberty silver dollar|first day cover/i, 'Commemorative'],
];

// When DESC is missing/blank, fall back to the Serial prefix.
const SERIAL_PREFIX_TO_SERIES = {
  'IND': 'Indian Head Penny',
  'WHT': 'Lincoln Cent',
  'SLD': 'Lincoln Cent',
  'MEM': 'Lincoln Cent',
  'LIB': 'Liberty V Nickel',
  'BUF': 'Buffalo Nickel',
  'JEF': 'Jefferson Nickel',
  'MRC': 'Mercury Dime',
  'ROO': 'Roosevelt Dime',
  'WAS': 'Washington Quarter',
  'WAL': 'Walking Liberty Half',
  'FRA': 'Franklin Half',
  'KEN': 'Kennedy Half',
  'MOR': 'Morgan Dollar',
  'PEA': 'Peace Dollar',
  'EIS': 'Eisenhower Dollar',
  'SBA': 'Susan B. Anthony Dollar',
  'SAC': 'Sacagawea Dollar',
  'PRE': 'Presidential Dollar',
  'AEU': 'Silver Eagle Dollar',
};

// Foreign country detection — DESC keyword → ISO country code.
const FOREIGN_KEYWORDS = [
  [/canad/i, 'CA'],
  [/marshaa?l/i, 'MH'], // covers 'Marshall' and the 'Marshaal' typo in source
  [/korea/i, 'KR'],
  [/mexic/i, 'MX'],
  [/british|great britain|uk\b/i, 'GB'],
  [/olympic/i, 'XX'], // placeholder — many nations; flag for review
];

// ────────────────────────────────────────────────────────────────────────

function normalizeMint(raw) {
  if (raw === null || raw === undefined) return 'P';
  const key = String(raw).trim();
  if (MINT_MAP[key] !== undefined) return MINT_MAP[key];
  return null; // unknown → flag
}

function normalizeCondition(raw) {
  if (raw === null || raw === undefined) return 'UNG';
  const direct = tryDirectGrade(raw);
  if (direct) return direct;
  const key = String(raw).trim().toLowerCase();
  if (CONDITION_MAP[key] !== undefined) return CONDITION_MAP[key];
  return null;
}

function normalizeSeries(desc, serial) {
  const key = desc ? String(desc).trim().toLowerCase().replace(/\s+/g, ' ') : '';
  if (key) {
    if (SERIES_MAP[key]) return SERIES_MAP[key];
    for (const [prefix, series] of SERIES_PREFIX_MAP) {
      if (key.startsWith(prefix)) return series;
    }
    for (const [re, series] of SERIES_KEYWORDS) {
      if (re.test(key)) return series;
    }
  }
  // Fall back to the Serial prefix (e.g. PRE2011DOL-AA → Presidential Dollar).
  if (serial) {
    const m = String(serial).match(/^([A-Z]{3})/);
    if (m && SERIAL_PREFIX_TO_SERIES[m[1]]) return SERIAL_PREFIX_TO_SERIES[m[1]];
  }
  return null;
}

function detectCountry(desc) {
  if (!desc) return 'US';
  for (const [re, code] of FOREIGN_KEYWORDS) if (re.test(desc)) return code;
  return 'US';
}

function normalizeYear(raw) {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
  if (Number.isFinite(n) && n >= 1700 && n <= 2100) return n;
  return null;
}

function detectPhotoFilename(row) {
  // __EMPTY_9 sometimes holds the old UNC path prefix '\\coins1\\PHOTOS\\';
  // the Serial is what uniquely identifies the file.
  const hasPhoto = row[' Photos '] === 'Photo' || row.Photos === 'Photo';
  if (!hasPhoto) return null;
  const serial = row.Serial;
  return serial ? `${serial}.JPG` : null;
}

function escapeMd(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

async function main() {
  console.log(`Reading ${WORKBOOK}…`);
  const wb = XLSX.readFile(WORKBOOK, { cellDates: true });
  const sheet = wb.Sheets['CoinCollection'];
  if (!sheet) throw new Error('CoinCollection sheet not found');
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  console.log(`  ${rows.length} source rows`);

  const mintDist = new Map();
  const condDist = new Map();
  const descDist = new Map();
  const unknownConds = new Map();
  const unknownSeries = new Map();
  const unknownMints = new Map();
  const foreignRows = [];
  const flagged = [];
  const serialSeen = new Map();
  const clean = [];

  const paperCurrency = [];
  let emptyRowsSkipped = 0;

  rows.forEach((r, idx) => {
    // Skip truly-empty trailing rows — spreadsheet padding, not real data.
    if (!r.Serial && !r.Date && !r.Mint && !r.Type && !r.DESC && !r.Condition && !r.Paid) {
      emptyRowsSkipped++;
      return;
    }

    const desc = r.DESC ?? r.Desc ?? null;
    // Paper currency (Dollar Bill / Two Dollar Bill) — out of scope for a coin app.
    // Surface separately so user decides whether to split into its own table later.
    if (desc && /dollar bill/i.test(desc)) {
      paperCurrency.push({ row: idx + 2, serial: r.Serial, desc, year: r.Date, series_letter: r.Mint });
      return;
    }

    const serial = r.Serial ? String(r.Serial).trim() : null;
    const year = normalizeYear(r.Date);
    const mintCode = normalizeMint(r.Mint);
    const gradeKey = r.Condition ?? null;
    const grade = normalizeCondition(gradeKey);
    const seriesName = normalizeSeries(desc, serial);
    const country = detectCountry(desc);

    // distributions
    const mintKey = r.Mint === null ? '<null>' : JSON.stringify(r.Mint);
    mintDist.set(mintKey, (mintDist.get(mintKey) || 0) + 1);
    const condKey = gradeKey === null ? '<null>' : JSON.stringify(gradeKey);
    condDist.set(condKey, (condDist.get(condKey) || 0) + 1);
    const descKey = desc === null ? '<null>' : String(desc);
    descDist.set(descKey, (descDist.get(descKey) || 0) + 1);

    const issues = [];
    if (!serial) issues.push('missing Serial');
    if (!year) issues.push(`invalid year: ${JSON.stringify(r.Date)}`);
    if (mintCode === null) {
      issues.push(`unknown mint: ${JSON.stringify(r.Mint)}`);
      unknownMints.set(mintKey, (unknownMints.get(mintKey) || 0) + 1);
    }
    if (grade === null) {
      issues.push(`unknown condition: ${JSON.stringify(gradeKey)}`);
      unknownConds.set(condKey, (unknownConds.get(condKey) || 0) + 1);
    }
    if (country === 'US' && seriesName === null) {
      issues.push(`unmapped series: ${JSON.stringify(desc)}`);
      unknownSeries.set(descKey, (unknownSeries.get(descKey) || 0) + 1);
    }

    if (serial) {
      const prev = serialSeen.get(serial);
      if (prev !== undefined) issues.push(`duplicate Serial (also at row ${prev + 2})`);
      else serialSeen.set(serial, idx);
    }

    if (country !== 'US') foreignRows.push({ row: idx + 2, serial, desc, country });

    if (issues.length > 0) {
      flagged.push({ row: idx + 2, serial, desc, year: r.Date, mint: r.Mint, condition: gradeKey, issues });
      return;
    }

    clean.push({
      serial,
      series: seriesName,
      year,
      mint: mintCode,
      condition: grade,
      paid: r.Paid ?? null,
      book: r.Book ?? null,
      qty: r.Qty ?? 1,
      comment1: r.Comment1 ?? null,
      comment2: r[' Comment2 '] ?? r.Comment2 ?? null,
      verified: r.Verified != null && r.Verified !== '',
      photo: detectPhotoFilename(r),
      country,
    });
  });

  // Report
  mkdirSync(OUT_DIR, { recursive: true });
  const lines = [];
  const p = (s) => lines.push(s);
  p(`# CoinHub Import Dry-Run Report`);
  p(``);
  p(`Generated: ${new Date().toISOString()}`);
  p(`Source: \`data/source/Coin_Collection_v1_8.xlsm\` (sheet: CoinCollection)`);
  p(``);
  p(`## Summary`);
  p(`- Source rows: **${rows.length}** (${emptyRowsSkipped} empty trailing rows skipped silently)`);
  p(`- Clean coin rows ready to import: **${clean.length}**`);
  p(`- Paper-currency rows (out of scope — see §6): **${paperCurrency.length}**`);
  p(`- Flagged coin rows (will NOT import): **${flagged.length}**`);
  p(`- Unique mint values: ${mintDist.size}`);
  p(`- Unique condition values: ${condDist.size}`);
  p(`- Unique DESC values: ${descDist.size}`);
  p(`- Foreign / non-US rows: ${foreignRows.length}`);
  p(``);
  p(`> Review this report. If mappings look wrong, edit the tables at the top of`);
  p(`> \`scripts/import.js\` (MINT_MAP, CONDITION_MAP, SERIES_MAP) and re-run`);
  p(`> \`npm run import:dry\` until clean. Then \`npm run import:apply\`.`);
  p(``);

  p(`## 1. Mint normalization`);
  p(``);
  p(`| Source | Count | → Canonical |`);
  p(`|---|---|---|`);
  for (const [k, v] of [...mintDist.entries()].sort((a, b) => b[1] - a[1])) {
    const parsed = k === '<null>' ? null : JSON.parse(k);
    const mapped = normalizeMint(parsed);
    p(`| ${escapeMd(k)} | ${v} | ${mapped ?? '**UNKNOWN**'} |`);
  }
  p(``);

  p(`## 2. Condition normalization`);
  p(``);
  p(`| Source | Count | → Canonical grade |`);
  p(`|---|---|---|`);
  for (const [k, v] of [...condDist.entries()].sort((a, b) => b[1] - a[1])) {
    const parsed = k === '<null>' ? null : JSON.parse(k);
    const mapped = normalizeCondition(parsed);
    p(`| ${escapeMd(k)} | ${v} | ${mapped ?? '**UNKNOWN**'} |`);
  }
  p(``);

  if (unknownConds.size > 0) {
    p(`### ⚠ Unknown conditions — add to CONDITION_MAP before --apply`);
    p(``);
    p(`| Source | Count |`);
    p(`|---|---|`);
    for (const [k, v] of [...unknownConds.entries()].sort((a, b) => b[1] - a[1])) {
      p(`| ${escapeMd(k)} | ${v} |`);
    }
    p(``);
  }

  if (unknownMints.size > 0) {
    p(`### ⚠ Unknown mints — add to MINT_MAP before --apply`);
    p(``);
    p(`| Source | Count |`);
    p(`|---|---|`);
    for (const [k, v] of [...unknownMints.entries()].sort((a, b) => b[1] - a[1])) {
      p(`| ${escapeMd(k)} | ${v} |`);
    }
    p(``);
  }

  p(`## 3. Series (DESC) mapping — top 40`);
  p(``);
  p(`| Source DESC | Count | → Canonical series |`);
  p(`|---|---|---|`);
  const descSorted = [...descDist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  for (const [k, v] of descSorted) {
    const mapped = k === '<null>' ? null : normalizeSeries(k);
    p(`| ${escapeMd(k)} | ${v} | ${mapped ?? '**UNMAPPED**'} |`);
  }
  p(``);

  if (unknownSeries.size > 0) {
    p(`### ⚠ Unmapped DESC values (US-only; foreign rows handled separately)`);
    p(``);
    p(`These ${unknownSeries.size} DESC values are not in SERIES_MAP. Either add a mapping, or mark them foreign via FOREIGN_KEYWORDS.`);
    p(``);
    p(`| DESC | Count |`);
    p(`|---|---|`);
    for (const [k, v] of [...unknownSeries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50)) {
      p(`| ${escapeMd(k)} | ${v} |`);
    }
    if (unknownSeries.size > 50) p(`| … ${unknownSeries.size - 50} more … | |`);
    p(``);
  }

  if (foreignRows.length > 0) {
    p(`## 4. Foreign / non-US items (first 50)`);
    p(``);
    p(`| Row | Serial | DESC | Proposed country |`);
    p(`|---|---|---|---|`);
    for (const f of foreignRows.slice(0, 50)) {
      p(`| ${f.row} | ${escapeMd(f.serial)} | ${escapeMd(f.desc)} | ${f.country} |`);
    }
    if (foreignRows.length > 50) p(`| … ${foreignRows.length - 50} more … | | | |`);
    p(``);
  }

  if (paperCurrency.length > 0) {
    p(`## 6. Paper currency (excluded from import)`);
    p(``);
    p(`${paperCurrency.length} rows are dollar / two-dollar bills — paper, not coins. `);
    p(`The "Mint" column for these holds the Federal Reserve Bank letter (A=Boston, B=NY, C=Philly, D=Cleveland, E=Richmond, F=Atlanta, G=Chicago, etc.), not a coin mint mark.`);
    p(``);
    p(`**Decision needed:** keep them out, give them their own table, or add a \`PaperCurrency\` series and import anyway?`);
    p(``);
    p(`| Row | Serial | Date | DESC | FRB letter |`);
    p(`|---|---|---|---|---|`);
    for (const f of paperCurrency.slice(0, 30)) {
      p(`| ${f.row} | ${escapeMd(f.serial)} | ${escapeMd(f.year)} | ${escapeMd(f.desc)} | ${escapeMd(f.series_letter)} |`);
    }
    if (paperCurrency.length > 30) p(`| … ${paperCurrency.length - 30} more … | | | | |`);
    p(``);
  }

  p(`## 5. Flagged rows (will be SKIPPED on --apply)`);
  p(``);
  if (flagged.length === 0) {
    p(`_none_`);
  } else {
    p(`| Row | Serial | Date | DESC | Mint | Condition | Issues |`);
    p(`|---|---|---|---|---|---|---|`);
    for (const f of flagged.slice(0, 200)) {
      p(`| ${f.row} | ${escapeMd(f.serial)} | ${escapeMd(f.year)} | ${escapeMd(f.desc)} | ${escapeMd(f.mint)} | ${escapeMd(f.condition)} | ${escapeMd(f.issues.join('; '))} |`);
    }
    if (flagged.length > 200) p(`| … ${flagged.length - 200} more … | | | | | | |`);
  }
  p(``);

  writeFileSync(REPORT_PATH, lines.join('\n'));
  console.log(`Report → ${REPORT_PATH}`);
  console.log(`  clean:   ${clean.length}`);
  console.log(`  flagged: ${flagged.length}`);

  if (DRY_RUN) {
    console.log('\nDry run only. No database writes. Re-run with --apply when mappings look right.');
    return;
  }

  // ─── APPLY ────────────────────────────────────────────────────────────
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not set — copy .env.example to .env');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Lookups
    const { rows: seriesRows } = await client.query('SELECT id, name FROM coin_series');
    const seriesByName = new Map(seriesRows.map((r) => [r.name, r.id]));
    const { rows: mintRows } = await client.query('SELECT id, code FROM mints');
    const mintByCode = new Map(mintRows.map((r) => [r.code, r.id]));
    const { rows: condRows } = await client.query('SELECT id, grade FROM conditions');
    const condByGrade = new Map(condRows.map((r) => [r.grade, r.id]));

    const missingSeries = new Set();
    for (const c of clean) {
      if (c.series && !seriesByName.has(c.series)) missingSeries.add(c.series);
    }
    if (missingSeries.size > 0) {
      throw new Error(`Series missing from coin_series table (add to migrate.js SEED_SERIES and re-migrate): ${[...missingSeries].join(', ')}`);
    }

    console.log(`Applying ${clean.length} rows…`);
    await client.query('BEGIN');
    let inserted = 0;
    let updated = 0;
    for (const c of clean) {
      const seriesId = c.series ? seriesByName.get(c.series) : null;
      const mintId = mintByCode.get(c.mint) ?? mintByCode.get('?');
      const condId = condByGrade.get(c.condition) ?? condByGrade.get('UNG');
      const res = await client.query(
        `INSERT INTO coins
           (serial, series_id, year, mint_id, condition_id, paid, book_value, qty,
            comment_1, comment_2, verified, photo_filename, country_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (serial) DO UPDATE SET
           series_id = EXCLUDED.series_id,
           year = EXCLUDED.year,
           mint_id = EXCLUDED.mint_id,
           condition_id = EXCLUDED.condition_id,
           paid = EXCLUDED.paid,
           book_value = EXCLUDED.book_value,
           qty = EXCLUDED.qty,
           comment_1 = EXCLUDED.comment_1,
           comment_2 = EXCLUDED.comment_2,
           verified = EXCLUDED.verified,
           photo_filename = EXCLUDED.photo_filename,
           country_code = EXCLUDED.country_code,
           updated_at = NOW()
         RETURNING (xmax = 0) AS inserted`,
        [
          c.serial, seriesId, c.year, mintId, condId, c.paid, c.book, c.qty,
          c.comment1, c.comment2, c.verified, c.photo, c.country,
        ],
      );
      if (res.rows[0].inserted) inserted++;
      else updated++;
    }
    await client.query('COMMIT');
    console.log(`Done. inserted=${inserted}, updated=${updated}, skipped(flagged)=${flagged.length}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
