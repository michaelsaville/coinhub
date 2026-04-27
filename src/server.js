import express from 'express';
import compression from 'compression';
import basicAuth from 'express-basic-auth';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { pool } from './db.js';
import { createWizardRouter } from './import/wizard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();
app.set('trust proxy', true);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(compression());
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use('/public', express.static(PUBLIC_DIR, { maxAge: '7d' }));
app.get('/manifest.webmanifest', (_req, res) => {
  res.type('application/manifest+json');
  res.sendFile(path.join(PUBLIC_DIR, 'manifest.webmanifest'));
});
app.get('/sw.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('application/javascript');
  res.sendFile(path.join(PUBLIC_DIR, 'sw.js'));
});
app.get('/health', (_req, res) => res.json({ ok: true }));

const password = process.env.COINHUB_PASSWORD;
if (!password) {
  console.error('COINHUB_PASSWORD must be set');
  process.exit(1);
}
const user = process.env.COINHUB_USER || 'michael';
app.use(basicAuth({ users: { [user]: password }, challenge: true, realm: 'CoinHub' }));

app.get('/', async (_req, res, next) => {
  try {
    const [{ rows: totals }, { rows: bySeries }] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM coins) AS total_coins,
          (SELECT COUNT(DISTINCT series_id)::int FROM coins WHERE series_id IS NOT NULL) AS active_series,
          (SELECT COALESCE(SUM(paid), 0)::numeric(12,2) FROM coins) AS total_paid,
          (SELECT COALESCE(SUM(book_value), 0)::numeric(12,2) FROM coins) AS total_book
      `),
      pool.query(`
        SELECT s.id, s.name, t.name AS type_name, COUNT(c.id)::int AS count
        FROM coin_series s
        JOIN coin_types t ON t.id = s.type_id
        LEFT JOIN coins c ON c.series_id = s.id
        GROUP BY s.id, s.name, t.name
        HAVING COUNT(c.id) > 0
        ORDER BY COUNT(c.id) DESC
      `),
    ]);
    res.render('home', { totals: totals[0], bySeries, title: 'CoinHub' });
  } catch (e) { next(e); }
});

app.get('/search', async (req, res, next) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.redirect('/');
  try {
    const pattern = `%${q}%`;
    const yearAsNum = /^\d{4}$/.test(q) ? parseInt(q, 10) : null;
    const { rows } = await pool.query(`
      SELECT c.id, c.serial, c.year, s.name AS series, m.code AS mint, cond.grade
      FROM coins c
      LEFT JOIN coin_series s ON s.id = c.series_id
      LEFT JOIN mints m ON m.id = c.mint_id
      LEFT JOIN conditions cond ON cond.id = c.condition_id
      WHERE c.serial ILIKE $1
         OR s.name ILIKE $1
         OR c.comment_1 ILIKE $1
         OR c.comment_2 ILIKE $1
         OR ($2::int IS NOT NULL AND c.year = $2::int)
      ORDER BY c.year NULLS LAST, s.name, c.serial
      LIMIT 500
    `, [pattern, yearAsNum]);
    res.render('search', { q, results: rows, title: `Search: ${q}` });
  } catch (e) { next(e); }
});

// Numeric-id constraint so /coins/new (and any future /coins/<word>
// route) doesn't get swallowed by this handler.
app.get('/coins/:id(\\d+)', async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.sendStatus(400);
  try {
    const [{ rows }, { rows: purchases }, { rows: attrs }] = await Promise.all([
      pool.query(`
        SELECT c.*, s.name AS series, t.name AS type_name,
               m.code AS mint_code, m.name AS mint_name,
               cond.grade, cond.category
        FROM coins c
        LEFT JOIN coin_series s ON s.id = c.series_id
        LEFT JOIN coin_types t ON t.id = s.type_id
        LEFT JOIN mints m ON m.id = c.mint_id
        LEFT JOIN conditions cond ON cond.id = c.condition_id
        WHERE c.id = $1
      `, [id]),
      pool.query(`
        SELECT id, purchase_date, price, qty, source, notes, created_at
        FROM coin_purchases
        WHERE coin_id = $1
        ORDER BY purchase_date DESC NULLS LAST, created_at DESC
      `, [id]),
      // Left-join all defs against this coin's values so the form
      // surfaces every defined field — even ones with no value yet.
      pool.query(`
        SELECT d.id AS def_id, d.key, d.label, d.type, d.unit, d.hint,
               d.sort_order, a.value
        FROM coin_attribute_defs d
        LEFT JOIN coin_attributes a ON a.def_id = d.id AND a.coin_id = $1
        ORDER BY d.sort_order, d.label
      `, [id]),
    ]);
    if (!rows[0]) return res.sendStatus(404);
    res.render('detail', { coin: rows[0], purchases, attrs, title: rows[0].serial });
  } catch (e) { next(e); }
});

// ─── Add a coin (manual entry) ───────────────────────────────────────
//
// /coins/new is the touch-friendly form (also works as a "PWA app" once
// added to home screen). POST /coins runs the insert + auto-generates
// a serial when the user doesn't supply one. A matching coin_purchases
// row is written in the same txn so the new coin shows full purchase
// history immediately.

app.get('/coins/new', async (_req, res, next) => {
  try {
    const [{ rows: types }, { rows: series }, { rows: mints }, { rows: conditions }] =
      await Promise.all([
        pool.query(`SELECT id, name, denomination_cents FROM coin_types ORDER BY denomination_cents`),
        pool.query(`
          SELECT s.id, s.name, t.id AS type_id, t.name AS type_name
          FROM coin_series s JOIN coin_types t ON t.id = s.type_id
          ORDER BY t.denomination_cents, s.name
        `),
        pool.query(`SELECT id, code, name FROM mints ORDER BY code`),
        pool.query(`SELECT id, grade, sheldon_value, category FROM conditions ORDER BY category, sheldon_value NULLS LAST`),
      ]);
    res.render('coin_new', {
      title: 'Add a coin',
      types,
      series,
      mints,
      conditions,
      values: {},
      error: null,
    });
  } catch (e) { next(e); }
});

// 3-letter prefix per series — used to generate a human-friendly serial
// when the user doesn't supply one. Falls back to the first 3 alpha
// chars of the series name (uppercased) for series we haven't mapped.
const SERIES_PREFIX = {
  'Indian Head Penny': 'IND',
  'Lincoln Cent': 'LIN',
  'Flying Eagle Cent': 'FLY',
  'Liberty V Nickel': 'LIB',
  'Buffalo Nickel': 'BUF',
  'Jefferson Nickel': 'JEF',
  'Shield Nickel': 'SHL',
  'Mercury Dime': 'MRC',
  'Roosevelt Dime': 'ROO',
  'Barber Dime': 'BAR',
  'Washington Quarter': 'WAS',
  'Barber Quarter': 'BAQ',
  'Standing Liberty Quarter': 'STL',
  'Walking Liberty Half': 'WAL',
  'Franklin Half': 'FRA',
  'Kennedy Half': 'KEN',
  'Barber Half': 'BAH',
  'Morgan Dollar': 'MOR',
  'Peace Dollar': 'PEA',
  'Eisenhower Dollar': 'EIS',
  'Susan B. Anthony Dollar': 'SBA',
  'Sacagawea Dollar': 'SAC',
  'Presidential Dollar': 'PRE',
  'Silver Eagle Dollar': 'AEU',
  'Trade Dollar': 'TRD',
  'Seated Liberty Dollar': 'SEA',
};

function fallbackPrefix(seriesName) {
  return String(seriesName ?? 'COI')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 3)
    .padEnd(3, 'X');
}

async function generateUniqueSerial(client, seriesName, year, mintCode) {
  const prefix = SERIES_PREFIX[seriesName] ?? fallbackPrefix(seriesName);
  // Up to 5 retries — collisions are vanishingly unlikely (676 suffixes
  // per (prefix, year, mint) triple) but we still verify against the
  // unique constraint rather than trusting the math.
  for (let i = 0; i < 5; i++) {
    const a = String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const b = String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const candidate = `${prefix}${year}${mintCode}-${a}${b}`;
    const { rowCount } = await client.query(
      'SELECT 1 FROM coins WHERE serial = $1',
      [candidate],
    );
    if (rowCount === 0) return candidate;
  }
  // Last-ditch: use a timestamp suffix so we always succeed.
  return `${prefix}${year}${mintCode}-${Date.now().toString(36).slice(-2).toUpperCase()}`;
}

app.post('/coins', async (req, res, next) => {
  // Helper: re-render the form with the user's values + an error,
  // instead of dropping their typing on validation failure.
  async function renderError(message, values) {
    try {
      const [{ rows: types }, { rows: series }, { rows: mints }, { rows: conditions }] =
        await Promise.all([
          pool.query(`SELECT id, name, denomination_cents FROM coin_types ORDER BY denomination_cents`),
          pool.query(`
            SELECT s.id, s.name, t.id AS type_id, t.name AS type_name
            FROM coin_series s JOIN coin_types t ON t.id = s.type_id
            ORDER BY t.denomination_cents, s.name
          `),
          pool.query(`SELECT id, code, name FROM mints ORDER BY code`),
          pool.query(`SELECT id, grade, sheldon_value, category FROM conditions ORDER BY category, sheldon_value NULLS LAST`),
        ]);
      res.status(400).render('coin_new', {
        title: 'Add a coin',
        types, series, mints, conditions, values, error: message,
      });
    } catch (e) { next(e); }
  }

  const seriesId = req.body.series_id ? parseInt(req.body.series_id, 10) : null;
  const mintId = req.body.mint_id ? parseInt(req.body.mint_id, 10) : null;
  const conditionId = req.body.condition_id ? parseInt(req.body.condition_id, 10) : null;
  const yearRaw = req.body.year?.toString().trim();
  const year = yearRaw ? parseInt(yearRaw, 10) : null;
  const qty = parseInt(req.body.qty || '1', 10) || 1;
  const paid = req.body.paid?.toString().trim() ? Number(req.body.paid) : null;
  const bookValue = req.body.book_value?.toString().trim() ? Number(req.body.book_value) : null;
  const acquiredDate = req.body.acquired_date?.toString().trim() || null;
  const comment1 = req.body.comment_1?.toString().trim() || null;
  const comment2 = req.body.comment_2?.toString().trim() || null;
  const slabSerial = req.body.slab_serial?.toString().trim() || null;
  const gradingService = req.body.grading_service?.toString().trim() || null;
  const userSerial = req.body.serial?.toString().trim() || null;

  // Re-collect values for re-render in case of error
  const values = {
    series_id: seriesId, mint_id: mintId, condition_id: conditionId,
    year, qty, paid, book_value: bookValue, acquired_date: acquiredDate,
    comment_1: comment1, comment_2: comment2, slab_serial: slabSerial,
    grading_service: gradingService, serial: userSerial,
  };

  if (!seriesId) return renderError('Pick a series.', values);
  if (!year || year < 1700 || year > 2100) return renderError('Enter a valid year.', values);
  if (!mintId) return renderError('Pick a mint.', values);
  if (!conditionId) return renderError('Pick a condition.', values);

  const client = await pool.connect();
  try {
    const [{ rows: seriesRows }, { rows: mintRows }] = await Promise.all([
      client.query('SELECT name FROM coin_series WHERE id = $1', [seriesId]),
      client.query('SELECT code FROM mints WHERE id = $1', [mintId]),
    ]);
    const seriesName = seriesRows[0]?.name;
    const mintCode = mintRows[0]?.code;
    if (!seriesName || !mintCode) {
      return renderError('Selected series or mint no longer exists.', values);
    }

    const serial = userSerial || (await generateUniqueSerial(client, seriesName, year, mintCode));

    await client.query('BEGIN');
    let coinId;
    try {
      const { rows: created } = await client.query(
        `INSERT INTO coins (serial, series_id, year, mint_id, condition_id,
                           paid, book_value, qty, comment_1, comment_2,
                           slab_serial, grading_service, acquired_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id`,
        [
          serial, seriesId, year, mintId, conditionId, paid, bookValue, qty,
          comment1, comment2, slabSerial, gradingService, acquiredDate,
        ],
      );
      coinId = created[0].id;

      // Always log a corresponding purchase row so the coin's history
      // page populates immediately. Source flagged so we can tell
      // manual entries apart from imports later.
      await client.query(
        `INSERT INTO coin_purchases (coin_id, purchase_date, price, qty, source, notes)
         VALUES ($1, $2, $3, $4, 'manual_entry', NULL)`,
        [coinId, acquiredDate, paid, qty],
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('coins_serial_key')) {
        return renderError(`Serial "${serial}" already exists — pick a different one or leave it blank to auto-generate.`, values);
      }
      throw e;
    }
    res.redirect(`/coins/${coinId}`);
  } catch (e) {
    next(e);
  } finally {
    client.release();
  }
});

// ─── Custom fields (registry) ───────────────────────────────────────
//
// Each row in coin_attribute_defs becomes an editable input on every
// coin's detail page. Adding a new field is a single form submission
// here — no schema change, no UI redeploy. Per-coin values live in
// coin_attributes (TEXT regardless of declared type; UI casts).

app.get('/fields', async (req, res, next) => {
  try {
    const { rows: defs } = await pool.query(`
      SELECT d.id, d.key, d.label, d.type, d.unit, d.hint, d.sort_order,
             COUNT(a.id)::int AS filled_count,
             (SELECT COUNT(*)::int FROM coins) - COUNT(a.id)::int AS missing_count
      FROM coin_attribute_defs d
      LEFT JOIN coin_attributes a ON a.def_id = d.id AND a.value IS NOT NULL AND a.value != ''
      GROUP BY d.id
      ORDER BY d.sort_order, d.label
    `);
    res.render('fields', {
      title: 'Custom fields',
      defs,
      saved: req.query.saved === '1',
    });
  } catch (e) { next(e); }
});

app.post('/fields', async (req, res, next) => {
  const key = (req.body.key || '').toString().trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const label = (req.body.label || '').toString().trim();
  const type = ['TEXT', 'NUMBER', 'DATE'].includes(req.body.type) ? req.body.type : 'TEXT';
  const unit = (req.body.unit || '').toString().trim() || null;
  const hint = (req.body.hint || '').toString().trim() || null;
  if (!key || !label) return res.redirect('/fields?error=missing');
  try {
    await pool.query(
      `INSERT INTO coin_attribute_defs (key, label, type, unit, hint, sort_order)
       VALUES ($1, $2, $3, $4, $5,
               COALESCE((SELECT MAX(sort_order) + 10 FROM coin_attribute_defs), 10))
       ON CONFLICT (key) DO UPDATE SET
         label = EXCLUDED.label,
         type = EXCLUDED.type,
         unit = EXCLUDED.unit,
         hint = EXCLUDED.hint`,
      [key, label, type, unit, hint],
    );
    res.redirect('/fields?saved=1');
  } catch (e) { next(e); }
});

app.post('/fields/:id/delete', async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.sendStatus(400);
  try {
    // Cascade deletes the per-coin values, intentional — removing a
    // field means removing all data captured against it.
    await pool.query('DELETE FROM coin_attribute_defs WHERE id = $1', [id]);
    res.redirect('/fields?saved=1');
  } catch (e) { next(e); }
});

// ─── AI backfill (slice 2) ──────────────────────────────────────────
//
// /fields/:id/backfill is the review queue. The "Suggest" button
// pulls a batch of N coins missing the field and asks Claude (via
// the DocHub proxy) for a value per coin. Suggestions are returned
// inline; the user accepts/rejects/edits per row, then bulk-saves.
//
// Suggestions are never auto-applied — every value lands in the DB
// only after explicit human approval.

app.get('/fields/:id(\\d+)/backfill', async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  try {
    const [{ rows: defRows }, { rows: missing }] = await Promise.all([
      pool.query('SELECT * FROM coin_attribute_defs WHERE id = $1', [id]),
      pool.query(`
        SELECT c.id, c.year, c.serial,
               s.name AS series, t.name AS type, t.denomination_cents,
               m.code AS mint, cond.grade
        FROM coins c
        LEFT JOIN coin_series s ON s.id = c.series_id
        LEFT JOIN coin_types t ON t.id = s.type_id
        LEFT JOIN mints m ON m.id = c.mint_id
        LEFT JOIN conditions cond ON cond.id = c.condition_id
        WHERE NOT EXISTS (
          SELECT 1 FROM coin_attributes a
          WHERE a.coin_id = c.id AND a.def_id = $1
                AND a.value IS NOT NULL AND a.value != ''
        )
        ORDER BY s.name NULLS LAST, c.year, c.id
        LIMIT 500
      `, [id]),
    ]);
    if (!defRows[0]) return res.sendStatus(404);
    res.render('fields_backfill', {
      title: `AI fill — ${defRows[0].label}`,
      def: defRows[0],
      missing,
      suggestions: null,
      error: null,
    });
  } catch (e) { next(e); }
});

import('./ai/client.js').then((m) => {
  globalThis.__coinhubAi = m;
}); // eager-load so the first request isn't slow

app.post('/fields/:id(\\d+)/ai-suggest', async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  const batchSize = Math.min(25, Math.max(1, parseInt(req.body.batch_size || '10', 10)));
  try {
    const ai = globalThis.__coinhubAi || (await import('./ai/client.js'));
    const { rows: defRows } = await pool.query('SELECT * FROM coin_attribute_defs WHERE id = $1', [id]);
    const def = defRows[0];
    if (!def) return res.sendStatus(404);

    const { rows: coins } = await pool.query(`
      SELECT c.id, c.year, c.serial,
             s.name AS series, t.name AS type, t.denomination_cents,
             m.code AS mint, cond.grade
      FROM coins c
      LEFT JOIN coin_series s ON s.id = c.series_id
      LEFT JOIN coin_types t ON t.id = s.type_id
      LEFT JOIN mints m ON m.id = c.mint_id
      LEFT JOIN conditions cond ON cond.id = c.condition_id
      WHERE NOT EXISTS (
        SELECT 1 FROM coin_attributes a
        WHERE a.coin_id = c.id AND a.def_id = $1
              AND a.value IS NOT NULL AND a.value != ''
      )
      ORDER BY s.name NULLS LAST, c.year, c.id
      LIMIT $2
    `, [id, batchSize]);

    if (coins.length === 0) {
      return res.render('fields_backfill', {
        title: `AI fill — ${def.label}`,
        def, missing: [], suggestions: [],
        error: 'Every coin already has a value for this field. Nothing to suggest.',
      });
    }

    const system = [
      `You are a numismatic expert filling a custom data field for a coin collector.`,
      `Field: "${def.label}" (key: ${def.key}, type: ${def.type}${def.unit ? ', unit: ' + def.unit : ''}).`,
      def.hint ? `Hint to the user: "${def.hint}".` : '',
      ``,
      `For each coin in the user message, suggest a value for this field based on standard numismatic knowledge.`,
      `Use composition tables (e.g. Lincoln Cent: 95% Cu pre-1982, then 97.5% Zn / 2.5% Cu plating; Morgan Dollar: 90% Ag).`,
      `For melt-value-style fields, use a recent silver spot (~$30/oz) or copper spot (~$0.40/oz) as a rough estimate.`,
      ``,
      `Respond with ONLY a JSON array, one object per coin, in the SAME ORDER as the input:`,
      `  [{"coin_id": <id>, "value": "<suggested value, or null if you're not sure>", "confidence": 0.0-1.0, "reason": "<one short phrase>"}]`,
      ``,
      `confidence interpretation:`,
      `  >= 0.8  : standard reference data, e.g. Morgan Dollar = 90% silver`,
      `  0.5–0.8 : type known but variant uncertain (e.g. Lincoln 1982 transition year)`,
      `  < 0.5   : guessing — return null value`,
    ].filter(Boolean).join('\n');

    const userPayload = coins.map((c) => ({
      coin_id: c.id,
      year: c.year,
      series: c.series,
      type: c.type,
      mint: c.mint,
      condition: c.grade,
      serial: c.serial,
    }));

    const result = await ai.callProxy(
      [{ role: 'user', content: JSON.stringify(userPayload, null, 2) }],
      { system, max_tokens: 4096 },
    );

    if (!result.ok) {
      return res.render('fields_backfill', {
        title: `AI fill — ${def.label}`,
        def, missing: coins, suggestions: null,
        error: `AI proxy error: ${result.error}`,
      });
    }
    const parsed = ai.extractJson(result.response);
    if (!Array.isArray(parsed)) {
      return res.render('fields_backfill', {
        title: `AI fill — ${def.label}`,
        def, missing: coins, suggestions: null,
        error: `Could not parse AI response as JSON. Raw text was: ${
          result.response?.content?.[0]?.text?.slice(0, 200) || '(empty)'
        }`,
      });
    }

    // Stitch suggestions back to the coin rows so the UI has full
    // context per row. AI might return them out of order or skip ids;
    // be defensive.
    const byId = new Map(parsed.map((s) => [s.coin_id, s]));
    const suggestions = coins.map((c) => {
      const s = byId.get(c.id) || {};
      return {
        coin: c,
        value: s.value ?? '',
        confidence: typeof s.confidence === 'number' ? s.confidence : null,
        reason: s.reason ?? '',
      };
    });

    res.render('fields_backfill', {
      title: `AI fill — ${def.label}`,
      def, missing: [], suggestions,
      error: null,
    });
  } catch (e) { next(e); }
});

app.post('/fields/:id(\\d+)/ai-apply', async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  try {
    // Form fields look like accept_<coinId>=on + value_<coinId>=<value>
    const accepted = [];
    for (const [k, v] of Object.entries(req.body)) {
      if (!k.startsWith('accept_')) continue;
      const coinId = parseInt(k.slice(7), 10);
      if (!Number.isInteger(coinId)) continue;
      const val = (req.body[`value_${coinId}`] || '').toString().trim();
      if (!val) continue;
      accepted.push([coinId, val]);
    }
    if (accepted.length === 0) {
      return res.redirect(`/fields/${id}/backfill`);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [coinId, val] of accepted) {
        await client.query(
          `INSERT INTO coin_attributes (coin_id, def_id, value, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (coin_id, def_id)
           DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [coinId, id, val],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    res.redirect(`/fields/${id}/backfill?applied=${accepted.length}`);
  } catch (e) { next(e); }
});

// Bulk-update all custom-field values for a single coin. Posted from
// the coin detail page's edit form. Empty value → DELETE the row
// (revert to "no value set"), so blanking the input clears it.
app.post('/coins/:id(\\d+)/attributes', async (req, res, next) => {
  const coinId = parseInt(req.params.id, 10);
  try {
    const { rows: defs } = await pool.query(
      'SELECT id, key FROM coin_attribute_defs',
    );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const def of defs) {
        const raw = req.body[`attr_${def.key}`];
        const value = raw == null ? null : String(raw).trim();
        if (!value) {
          await client.query(
            'DELETE FROM coin_attributes WHERE coin_id = $1 AND def_id = $2',
            [coinId, def.id],
          );
        } else {
          await client.query(
            `INSERT INTO coin_attributes (coin_id, def_id, value, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (coin_id, def_id)
             DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [coinId, def.id, value],
          );
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    res.redirect(`/coins/${coinId}`);
  } catch (e) { next(e); }
});

app.get('/series', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.id, s.name, t.name AS type_name, s.start_year, s.end_year,
             t.denomination_cents, COUNT(c.id)::int AS count
      FROM coin_series s
      JOIN coin_types t ON t.id = s.type_id
      LEFT JOIN coins c ON c.series_id = s.id
      GROUP BY s.id, s.name, t.name, s.start_year, s.end_year, t.denomination_cents
      ORDER BY t.denomination_cents, s.name
    `);
    res.render('series_list', { series: rows, title: 'Series' });
  } catch (e) { next(e); }
});

app.get('/series/:id', async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.sendStatus(400);
  try {
    const [{ rows: seriesRows }, { rows: coins }, { rows: mintageTotals }] = await Promise.all([
      pool.query(
        `SELECT s.id, s.name, t.name AS type_name, s.start_year, s.end_year
           FROM coin_series s JOIN coin_types t ON t.id = s.type_id
          WHERE s.id = $1`,
        [id],
      ),
      pool.query(`
        SELECT c.id, c.serial, c.year, m.code AS mint, cond.grade
        FROM coins c
        LEFT JOIN mints m ON m.id = c.mint_id
        LEFT JOIN conditions cond ON cond.id = c.condition_id
        WHERE c.series_id = $1
        ORDER BY c.year NULLS LAST, m.code, c.serial
      `, [id]),
      pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM mintage_reference WHERE series_id = $1) AS mintage_total,
          (SELECT COUNT(*)::int FROM mintage_reference mr
            WHERE mr.series_id = $1
              AND EXISTS (SELECT 1 FROM coins c
                           WHERE c.series_id = mr.series_id
                             AND c.year = mr.year
                             AND c.mint_id = mr.mint_id)) AS mintage_owned
      `, [id]),
    ]);
    if (!seriesRows[0]) return res.sendStatus(404);
    res.render('series_detail', {
      series: seriesRows[0],
      coins,
      mintage: mintageTotals[0],
      title: seriesRows[0].name,
    });
  } catch (e) { next(e); }
});

app.get('/series/:id/gaps', async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.sendStatus(400);
  const showMissingOnly = req.query.missing === '1';
  try {
    const [{ rows: seriesRows }, { rows: mints }, { rows: grid }] = await Promise.all([
      pool.query(
        `SELECT s.id, s.name, t.name AS type_name
           FROM coin_series s JOIN coin_types t ON t.id = s.type_id
          WHERE s.id = $1`,
        [id],
      ),
      pool.query(`
        SELECT DISTINCT m.id, m.code, m.name
        FROM mintage_reference mr
        JOIN mints m ON m.id = mr.mint_id
        WHERE mr.series_id = $1
        ORDER BY m.code
      `, [id]),
      pool.query(`
        SELECT mr.year, m.code AS mint,
          (SELECT c.id FROM coins c
            WHERE c.series_id = mr.series_id
              AND c.year = mr.year
              AND c.mint_id = mr.mint_id
            ORDER BY c.id ASC LIMIT 1) AS coin_id
        FROM mintage_reference mr
        JOIN mints m ON m.id = mr.mint_id
        WHERE mr.series_id = $1
        ORDER BY mr.year, m.code
      `, [id]),
    ]);
    if (!seriesRows[0]) return res.sendStatus(404);
    if (grid.length === 0) {
      return res.render('gaps_empty', {
        series: seriesRows[0],
        title: `${seriesRows[0].name} — Gaps`,
      });
    }
    const mintCodes = mints.map(m => m.code);
    const byYear = new Map();
    for (const row of grid) {
      if (!byYear.has(row.year)) byYear.set(row.year, {});
      byYear.get(row.year)[row.mint] = row.coin_id;
    }
    const rows = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, cells]) => ({
      year,
      cells: mintCodes.map(code => ({ mint: code, coinId: cells[code] ?? null, inMintage: code in cells })),
    }));
    const total = grid.length;
    const owned = grid.filter(r => r.coin_id !== null).length;
    const missing = total - owned;

    let visibleRows = rows;
    if (showMissingOnly) {
      visibleRows = rows.filter(r => r.cells.some(c => c.inMintage && c.coinId === null));
    }

    res.render('gaps', {
      series: seriesRows[0],
      mintCodes,
      rows: visibleRows,
      stats: { total, owned, missing, percent: total === 0 ? 0 : Math.round((owned / total) * 100) },
      showMissingOnly,
      title: `${seriesRows[0].name} — Gaps`,
    });
  } catch (e) { next(e); }
});

app.use('/import', createWizardRouter(pool));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).send('Internal Server Error');
});

const port = parseInt(process.env.PORT || '3005', 10);
app.listen(port, () => console.log(`coinhub listening on :${port}`));
