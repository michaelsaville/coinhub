import pg from 'pg';
import 'dotenv/config';

const { Client } = pg;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS coin_types (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  denomination_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS coin_series (
  id          SERIAL PRIMARY KEY,
  type_id     INTEGER NOT NULL REFERENCES coin_types(id),
  name        TEXT NOT NULL UNIQUE,
  start_year  INTEGER,
  end_year    INTEGER
);

CREATE TABLE IF NOT EXISTS mints (
  id       SERIAL PRIMARY KEY,
  code     TEXT NOT NULL UNIQUE,
  name     TEXT NOT NULL,
  location TEXT
);

CREATE TABLE IF NOT EXISTS conditions (
  id             SERIAL PRIMARY KEY,
  grade          TEXT NOT NULL UNIQUE,
  sheldon_value  INTEGER,
  category       TEXT
);

CREATE TABLE IF NOT EXISTS coins (
  id              SERIAL PRIMARY KEY,
  serial          TEXT NOT NULL UNIQUE,
  series_id       INTEGER REFERENCES coin_series(id),
  year            INTEGER,
  mint_id         INTEGER REFERENCES mints(id),
  condition_id    INTEGER REFERENCES conditions(id),
  paid            NUMERIC(10,2),
  book_value      NUMERIC(10,2),
  qty             INTEGER DEFAULT 1,
  comment_1       TEXT,
  comment_2       TEXT,
  verified        BOOLEAN DEFAULT FALSE,
  photo_filename  TEXT,
  country_code    CHAR(2) DEFAULT 'US',
  slab_serial     TEXT,
  grading_service TEXT,
  grade_detail    TEXT,
  acquired_date   DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coins_year_idx ON coins(year);
CREATE INDEX IF NOT EXISTS coins_series_idx ON coins(series_id);
CREATE INDEX IF NOT EXISTS coins_mint_idx ON coins(mint_id);

CREATE TABLE IF NOT EXISTS mintage_reference (
  id            SERIAL PRIMARY KEY,
  series_id     INTEGER NOT NULL REFERENCES coin_series(id),
  year          INTEGER NOT NULL,
  mint_id       INTEGER REFERENCES mints(id),
  mintage_count BIGINT,
  is_key_date   BOOLEAN DEFAULT FALSE,
  notes         TEXT,
  UNIQUE (series_id, year, mint_id)
);

CREATE TABLE IF NOT EXISTS photos (
  id          SERIAL PRIMARY KEY,
  coin_id     INTEGER NOT NULL REFERENCES coins(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  caption     TEXT,
  is_primary  BOOLEAN DEFAULT FALSE,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-purchase history. One row per acquisition event for a coin. The
-- existing coins.acquired_date / coins.paid stay as the "first acquired"
-- snapshot; coin_purchases is the source of truth for full purchase
-- history, P&L, and re-entry vs. duplicate-purchase resolution.
CREATE TABLE IF NOT EXISTS coin_purchases (
  id            SERIAL PRIMARY KEY,
  coin_id       INTEGER NOT NULL REFERENCES coins(id) ON DELETE CASCADE,
  purchase_date DATE,
  price         NUMERIC(10,2),
  qty           INTEGER NOT NULL DEFAULT 1,
  source        TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coin_purchases_coin_idx ON coin_purchases(coin_id);
CREATE INDEX IF NOT EXISTS coin_purchases_date_idx ON coin_purchases(purchase_date);

-- Custom fields registry. coin_attribute_defs is the operator-defined
-- list of attributes ("Metal", "Weight (g)", "Current spot value"…);
-- coin_attributes holds the per-coin value for each definition.
-- Splitting them this way means adding a new field is a single INSERT
-- on the defs table — no schema change, no UI redeploy. Values stay
-- TEXT for storage simplicity; the def type column lets the UI pick
-- the right input + format (NUMBER → numeric input, DATE → date picker).
CREATE TABLE IF NOT EXISTS coin_attribute_defs (
  id          SERIAL PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'TEXT',  -- TEXT | NUMBER | DATE
  unit        TEXT,
  hint        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coin_attributes (
  id          SERIAL PRIMARY KEY,
  coin_id     INTEGER NOT NULL REFERENCES coins(id) ON DELETE CASCADE,
  def_id      INTEGER NOT NULL REFERENCES coin_attribute_defs(id) ON DELETE CASCADE,
  value       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (coin_id, def_id)
);
CREATE INDEX IF NOT EXISTS coin_attributes_coin_idx ON coin_attributes(coin_id);
`;

// Seed common attribute definitions so the UI has examples on first
// boot. Idempotent — ON CONFLICT (key) DO NOTHING preserves any custom
// labels/units the operator has already set.
const SEED_ATTRIBUTE_DEFS = [
  ['metal',          'Metal',                'TEXT',   null,  'e.g. Silver, Copper, Cu-Ni',   10],
  ['metal_purity',   'Metal purity',         'TEXT',   null,  'e.g. .900, .999',              20],
  ['weight_grams',   'Weight',               'NUMBER', 'g',   'in grams',                     30],
  ['metal_value',    'Melt value (estimate)', 'NUMBER', 'USD', 'current melt value',           40],
];

const SEED_TYPES = [
  ['Penny', 1],
  ['Nickel', 5],
  ['Dime', 10],
  ['Quarter', 25],
  ['Half Dollar', 50],
  ['Dollar', 100],
];

const SEED_MINTS = [
  ['P', 'Philadelphia', 'Philadelphia, PA'],
  ['D', 'Denver', 'Denver, CO'],
  ['S', 'San Francisco', 'San Francisco, CA'],
  ['W', 'West Point', 'West Point, NY'],
  ['CC', 'Carson City', 'Carson City, NV'],
  ['O', 'New Orleans', 'New Orleans, LA'],
  ['?', 'Unknown', 'Unknown / flagged during import'],
];

const SEED_CONDITIONS = [
  ['PO-1', 1, 'Poor'],
  ['FR-2', 2, 'Fair'],
  ['AG-3', 3, 'About Good'],
  ['G-4', 4, 'Good'],
  ['G-6', 6, 'Good'],
  ['VG-8', 8, 'Very Good'],
  ['VG-10', 10, 'Very Good'],
  ['F-12', 12, 'Fine'],
  ['F-15', 15, 'Fine'],
  ['VF-20', 20, 'Very Fine'],
  ['VF-25', 25, 'Very Fine'],
  ['VF-30', 30, 'Very Fine'],
  ['VF-35', 35, 'Very Fine'],
  ['XF-40', 40, 'Extremely Fine'],
  ['XF-45', 45, 'Extremely Fine'],
  ['AU-50', 50, 'About Uncirculated'],
  ['AU-53', 53, 'About Uncirculated'],
  ['AU-55', 55, 'About Uncirculated'],
  ['AU-58', 58, 'About Uncirculated'],
  ['MS-60', 60, 'Mint State'],
  ['MS-62', 62, 'Mint State'],
  ['MS-63', 63, 'Mint State'],
  ['MS-64', 64, 'Mint State'],
  ['MS-65', 65, 'Mint State'],
  ['MS-66', 66, 'Mint State'],
  ['MS-67', 67, 'Mint State'],
  ['MS-68', 68, 'Mint State'],
  ['MS-69', 69, 'Mint State'],
  ['MS-70', 70, 'Mint State'],
  ['PR-60', 60, 'Proof'],
  ['PR-63', 63, 'Proof'],
  ['PR-65', 65, 'Proof'],
  ['PR-67', 67, 'Proof'],
  ['PR-69', 69, 'Proof'],
  ['PR-70', 70, 'Proof'],
  ['UNG', null, 'Ungraded'],
];

const SEED_SERIES = [
  ['Penny', 'Indian Head Penny', 1859, 1909],
  ['Penny', 'Lincoln Cent', 1909, null],
  ['Penny', 'Flying Eagle Cent', 1856, 1858],
  ['Nickel', 'Liberty V Nickel', 1883, 1913],
  ['Nickel', 'Buffalo Nickel', 1913, 1938],
  ['Nickel', 'Jefferson Nickel', 1938, null],
  ['Nickel', 'Shield Nickel', 1866, 1883],
  ['Dime', 'Mercury Dime', 1916, 1945],
  ['Dime', 'Roosevelt Dime', 1946, null],
  ['Dime', 'Barber Dime', 1892, 1916],
  ['Quarter', 'Washington Quarter', 1932, null],
  ['Quarter', 'Barber Quarter', 1892, 1916],
  ['Quarter', 'Standing Liberty Quarter', 1916, 1930],
  ['Half Dollar', 'Walking Liberty Half', 1916, 1947],
  ['Half Dollar', 'Franklin Half', 1948, 1963],
  ['Half Dollar', 'Kennedy Half', 1964, null],
  ['Half Dollar', 'Barber Half', 1892, 1915],
  ['Dollar', 'Morgan Dollar', 1878, 1921],
  ['Dollar', 'Peace Dollar', 1921, 1935],
  ['Dollar', 'Eisenhower Dollar', 1971, 1978],
  ['Dollar', 'Susan B. Anthony Dollar', 1979, 1999],
  ['Dollar', 'Sacagawea Dollar', 2000, null],
  ['Dollar', 'Presidential Dollar', 2007, 2016],
  ['Dollar', 'Silver Eagle Dollar', 1986, null],
  ['Dollar', 'Trade Dollar', 1873, 1885],
  ['Dollar', 'Seated Liberty Dollar', 1840, 1873],
  // Catch-all series for items that don't fit the standard type/series model.
  ['Dollar', 'Commemorative', null, null],
  ['Dollar', 'Mint Set', null, null],
  ['Penny', 'Bulk Lot', null, null],
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set — copy .env.example to .env');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    console.log('Applying schema…');
    await client.query(SCHEMA);

    console.log('Seeding coin_types…');
    for (const [name, cents] of SEED_TYPES) {
      await client.query(
        'INSERT INTO coin_types (name, denomination_cents) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
        [name, cents],
      );
    }

    console.log('Seeding mints…');
    for (const [code, name, loc] of SEED_MINTS) {
      await client.query(
        'INSERT INTO mints (code, name, location) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING',
        [code, name, loc],
      );
    }

    console.log('Seeding conditions…');
    for (const [grade, sheldon, category] of SEED_CONDITIONS) {
      await client.query(
        'INSERT INTO conditions (grade, sheldon_value, category) VALUES ($1, $2, $3) ON CONFLICT (grade) DO NOTHING',
        [grade, sheldon, category],
      );
    }

    console.log('Seeding coin_series…');
    for (const [typeName, seriesName, startYear, endYear] of SEED_SERIES) {
      const { rows } = await client.query('SELECT id FROM coin_types WHERE name = $1', [typeName]);
      if (!rows[0]) throw new Error(`Type not found: ${typeName}`);
      await client.query(
        `INSERT INTO coin_series (type_id, name, start_year, end_year)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (name) DO NOTHING`,
        [rows[0].id, seriesName, startYear, endYear],
      );
    }

    console.log('Seeding default attribute definitions…');
    for (const [key, label, type, unit, hint, sortOrder] of SEED_ATTRIBUTE_DEFS) {
      await client.query(
        `INSERT INTO coin_attribute_defs (key, label, type, unit, hint, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (key) DO NOTHING`,
        [key, label, type, unit, hint, sortOrder],
      );
    }

    // Backfill: synthesize one coin_purchases row per existing coin so all
    // history lives in one place from now on. Only fires the first time
    // (idempotent — looks at whether ANY coin still has zero purchase rows).
    const { rows: needBackfill } = await client.query(
      `SELECT COUNT(*)::int AS n FROM coins c
       WHERE NOT EXISTS (SELECT 1 FROM coin_purchases p WHERE p.coin_id = c.id)`,
    );
    if (needBackfill[0]?.n > 0) {
      console.log(`Backfilling coin_purchases for ${needBackfill[0].n} coins…`);
      await client.query(
        `INSERT INTO coin_purchases (coin_id, purchase_date, price, qty, source, notes)
         SELECT c.id, c.acquired_date, c.paid, COALESCE(c.qty, 1),
                'initial_import', 'Auto-backfilled from coins row at migration time'
         FROM coins c
         WHERE NOT EXISTS (SELECT 1 FROM coin_purchases p WHERE p.coin_id = c.id)`,
      );
    }

    await client.query('COMMIT');
    console.log('Migration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
