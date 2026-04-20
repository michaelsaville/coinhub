import express from 'express';
import compression from 'compression';
import basicAuth from 'express-basic-auth';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();
app.set('trust proxy', true);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(compression());

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

app.get('/coins/:id', async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.sendStatus(400);
  try {
    const { rows } = await pool.query(`
      SELECT c.*, s.name AS series, t.name AS type_name,
             m.code AS mint_code, m.name AS mint_name,
             cond.grade, cond.category
      FROM coins c
      LEFT JOIN coin_series s ON s.id = c.series_id
      LEFT JOIN coin_types t ON t.id = s.type_id
      LEFT JOIN mints m ON m.id = c.mint_id
      LEFT JOIN conditions cond ON cond.id = c.condition_id
      WHERE c.id = $1
    `, [id]);
    if (!rows[0]) return res.sendStatus(404);
    res.render('detail', { coin: rows[0], title: rows[0].serial });
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
    const [{ rows: seriesRows }, { rows: coins }] = await Promise.all([
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
    ]);
    if (!seriesRows[0]) return res.sendStatus(404);
    res.render('series_detail', { series: seriesRows[0], coins, title: seriesRows[0].name });
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).send('Internal Server Error');
});

const port = parseInt(process.env.PORT || '3005', 10);
app.listen(port, () => console.log(`coinhub listening on :${port}`));
