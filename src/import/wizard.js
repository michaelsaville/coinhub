// Web import wizard. Four steps:
//   1. POST /import           — file upload, parse, create session
//   2. GET  /import/:sid/map  — column-mapping form with auto-detection
//   3. POST /import/:sid/map  — save mapping, redirect to preview
//   4. GET  /import/:sid/preview — dry-run report + per-duplicate prompt
//   5. POST /import/:sid/commit — execute insert/upsert + purchase rows
//   6. GET  /import/:sid/done — results summary
//
// Reuses src/import/normalizers.js so the CLI script and the web wizard
// share normalization rules. Per-duplicate user choice is one of:
//   'skip'       — ignore the row entirely
//   'purchase'   — leave the coins row untouched, append a coin_purchases row
//   'overwrite'  — update the coins row with the new values + append purchase row
//
// The choice is per-row but the preview UI also offers a "default for all"
// shortcut so the user doesn't have to click through 200 dupes individually.

import express from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import {
  TARGET_FIELDS,
  autoDetectMapping,
  projectRow,
} from './normalizers.js';
import {
  createSession,
  readSession,
  updateSession,
  deleteSession,
} from './sessions.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xlsm|xls|csv)$/i.test(file.originalname);
    if (!ok) return cb(new Error('Upload must be .xlsx, .xlsm, .xls, or .csv'));
    cb(null, true);
  },
});

const VALID_RESOLUTIONS = new Set(['skip', 'purchase', 'overwrite']);

export function createWizardRouter(pool) {
  const router = express.Router();

  // ─── Step 1: upload form ─────────────────────────────────────────────
  router.get('/', (_req, res) => {
    res.render('import_upload', { title: 'Import — Upload', error: null });
  });

  router.post('/', upload.single('file'), (req, res, next) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .render('import_upload', {
            title: 'Import — Upload',
            error: 'Pick a file first.',
          });
      }
      const wb = XLSX.read(req.file.buffer, { cellDates: true, type: 'buffer' });
      if (wb.SheetNames.length === 0) {
        return res.status(400).render('import_upload', {
          title: 'Import — Upload',
          error: 'No sheets found in that file.',
        });
      }

      // Stash the raw workbook contents so /pick-sheet can re-parse any
      // sheet without a re-upload. Keep the workbook serializable: write
      // an array of {name, rows} entries so JSON.stringify works.
      const sheets = wb.SheetNames.map((name) => {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], {
          defval: null,
          raw: true,
        });
        return { name, rows, rowCount: rows.length };
      });

      // Single sheet (typical CSV / clean xlsx) → skip the picker.
      if (sheets.length === 1) {
        const only = sheets[0];
        if (only.rowCount === 0) {
          return res.status(400).render('import_upload', {
            title: 'Import — Upload',
            error: 'The sheet has no data rows.',
          });
        }
        const sid = createSession({
          filename: req.file.originalname,
          sheetName: only.name,
          headers: Object.keys(only.rows[0]),
          rows: only.rows,
          rowCount: only.rowCount,
        });
        return res.redirect(`/import/${sid}/map`);
      }

      // Multi-sheet → store all sheets, redirect to picker.
      const sid = createSession({
        filename: req.file.originalname,
        sheets,
      });
      res.redirect(`/import/${sid}/pick-sheet`);
    } catch (e) {
      next(e);
    }
  });

  // ─── Step 1.5: pick which sheet to import (multi-sheet workbooks only) ─
  router.get('/:sid/pick-sheet', (req, res) => {
    const sess = readSession(req.params.sid);
    if (!sess) return res.redirect('/import');
    if (!sess.sheets) return res.redirect(`/import/${req.params.sid}/map`);
    res.render('import_pick_sheet', {
      title: 'Import — Pick sheet',
      sid: req.params.sid,
      filename: sess.filename,
      sheets: sess.sheets.map((s) => ({
        name: s.name,
        rowCount: s.rowCount,
        sample: s.rows[0] ?? null,
      })),
      error: null,
    });
  });

  router.post(
    '/:sid/pick-sheet',
    express.urlencoded({ extended: true }),
    (req, res) => {
      const sess = readSession(req.params.sid);
      if (!sess) return res.redirect('/import');
      if (!sess.sheets) return res.redirect(`/import/${req.params.sid}/map`);
      const chosen = sess.sheets.find((s) => s.name === req.body.sheet);
      if (!chosen) {
        return res.status(400).render('import_pick_sheet', {
          title: 'Import — Pick sheet',
          sid: req.params.sid,
          filename: sess.filename,
          sheets: sess.sheets.map((s) => ({
            name: s.name,
            rowCount: s.rowCount,
            sample: s.rows[0] ?? null,
          })),
          error: 'Pick a sheet.',
        });
      }
      if (chosen.rowCount === 0) {
        return res.status(400).render('import_pick_sheet', {
          title: 'Import — Pick sheet',
          sid: req.params.sid,
          filename: sess.filename,
          sheets: sess.sheets.map((s) => ({
            name: s.name,
            rowCount: s.rowCount,
            sample: s.rows[0] ?? null,
          })),
          error: `Sheet "${chosen.name}" has no data rows.`,
        });
      }
      // Promote the chosen sheet to top-level fields so the rest of the
      // wizard treats it like a single-sheet upload, then drop the
      // multi-sheet blob.
      updateSession(req.params.sid, {
        sheetName: chosen.name,
        headers: Object.keys(chosen.rows[0]),
        rows: chosen.rows,
        rowCount: chosen.rowCount,
        sheets: undefined,
      });
      res.redirect(`/import/${req.params.sid}/map`);
    },
  );

  // ─── Step 2: column mapping ──────────────────────────────────────────
  router.get('/:sid/map', (req, res) => {
    const sess = readSession(req.params.sid);
    if (!sess) return res.redirect('/import');
    const mapping = sess.mapping ?? autoDetectMapping(sess.headers);
    res.render('import_map', {
      title: 'Import — Map columns',
      sid: req.params.sid,
      filename: sess.filename,
      sheetName: sess.sheetName,
      rowCount: sess.rowCount,
      headers: sess.headers,
      sample: sess.rows.slice(0, 5),
      mapping,
      targets: TARGET_FIELDS,
      error: null,
    });
  });

  router.post('/:sid/map', express.urlencoded({ extended: true }), (req, res) => {
    const sess = readSession(req.params.sid);
    if (!sess) return res.redirect('/import');

    // Build mapping from form. Form encodes one input per header named
    // `map[<header>]` whose value is the chosen target key (or '' for
    // unmapped).
    const submitted = req.body.map || {};
    const validTargets = new Set(TARGET_FIELDS.map((t) => t.key));
    const mapping = {};
    for (const header of sess.headers) {
      const target = submitted[header];
      mapping[header] = target && validTargets.has(target) ? target : null;
    }

    // Required-field check: every "required" target must be mapped to
    // some header. Without serial we have nothing to dedupe by, and
    // without year we can't make a useful coin row.
    const usedTargets = new Set(Object.values(mapping).filter(Boolean));
    const missingRequired = TARGET_FIELDS.filter(
      (t) => t.required && !usedTargets.has(t.key),
    );
    if (missingRequired.length > 0) {
      return res.status(400).render('import_map', {
        title: 'Import — Map columns',
        sid: req.params.sid,
        filename: sess.filename,
        sheetName: sess.sheetName,
        rowCount: sess.rowCount,
        headers: sess.headers,
        sample: sess.rows.slice(0, 5),
        mapping,
        targets: TARGET_FIELDS,
        error: `Map a column to: ${missingRequired
          .map((t) => t.label)
          .join(', ')}`,
      });
    }

    updateSession(req.params.sid, { mapping });
    res.redirect(`/import/${req.params.sid}/preview`);
  });

  // ─── Step 3: preview ────────────────────────────────────────────────
  router.get('/:sid/preview', async (req, res, next) => {
    const sess = readSession(req.params.sid);
    if (!sess) return res.redirect('/import');
    if (!sess.mapping) return res.redirect(`/import/${req.params.sid}/map`);

    try {
      const projected = sess.rows.map((row, idx) => {
        const { normalized, issues } = projectRow(row, sess.mapping);
        return { idx, sheetRow: idx + 2, normalized, issues };
      });

      // Short-circuit: separate the rows that have NO issues at all from
      // the ones we'll skip outright (invalid data — missing serial, etc.).
      const valid = projected.filter((p) => p.issues.length === 0);
      const invalid = projected.filter((p) => p.issues.length > 0);

      // Lookup existing serials in one shot.
      const validSerials = valid.map((p) => p.normalized.serial);
      let existingSerials = new Set();
      if (validSerials.length > 0) {
        const { rows } = await pool.query(
          `SELECT serial FROM coins WHERE serial = ANY($1::text[])`,
          [validSerials],
        );
        existingSerials = new Set(rows.map((r) => r.serial));
      }

      const fresh = valid.filter(
        (p) => !existingSerials.has(p.normalized.serial),
      );
      const dupes = valid.filter((p) =>
        existingSerials.has(p.normalized.serial),
      );

      res.render('import_preview', {
        title: 'Import — Preview',
        sid: req.params.sid,
        filename: sess.filename,
        rowCount: sess.rowCount,
        counts: {
          fresh: fresh.length,
          dupes: dupes.length,
          invalid: invalid.length,
        },
        fresh: fresh.slice(0, 20),
        dupes,
        invalid: invalid.slice(0, 30),
        error: null,
      });
    } catch (e) {
      next(e);
    }
  });

  // ─── Step 4: commit ────────────────────────────────────────────────
  router.post(
    '/:sid/commit',
    express.urlencoded({ extended: true, limit: '5mb' }),
    async (req, res, next) => {
      const sess = readSession(req.params.sid);
      if (!sess) return res.redirect('/import');
      if (!sess.mapping) return res.redirect(`/import/${req.params.sid}/map`);

      const defaultResolution = VALID_RESOLUTIONS.has(req.body.default_resolution)
        ? req.body.default_resolution
        : 'skip';
      const perRow = req.body.dupe || {};

      const projected = sess.rows.map((row, idx) => {
        const { normalized, issues } = projectRow(row, sess.mapping);
        return { idx, sheetRow: idx + 2, normalized, issues };
      });
      const valid = projected.filter((p) => p.issues.length === 0);

      const validSerials = valid.map((p) => p.normalized.serial);
      let existingByserial = new Map();
      if (validSerials.length > 0) {
        const { rows } = await pool.query(
          `SELECT id, serial FROM coins WHERE serial = ANY($1::text[])`,
          [validSerials],
        );
        existingByserial = new Map(rows.map((r) => [r.serial, r.id]));
      }

      // Lookup tables shared across the txn.
      const [{ rows: seriesRows }, { rows: mintRows }, { rows: condRows }] =
        await Promise.all([
          pool.query('SELECT id, name FROM coin_series'),
          pool.query('SELECT id, code FROM mints'),
          pool.query('SELECT id, grade FROM conditions'),
        ]);
      const seriesByName = new Map(seriesRows.map((r) => [r.name, r.id]));
      const mintByCode = new Map(mintRows.map((r) => [r.code, r.id]));
      const condByGrade = new Map(condRows.map((r) => [r.grade, r.id]));

      const client = await pool.connect();
      const summary = {
        inserted: 0,
        purchasesAdded: 0,
        overwritten: 0,
        skipped: 0,
        invalid: projected.length - valid.length,
        missingSeries: [],
      };

      try {
        await client.query('BEGIN');

        for (const p of valid) {
          const n = p.normalized;
          const seriesId = n.series ? seriesByName.get(n.series) ?? null : null;
          if (n.series && !seriesId) {
            summary.missingSeries.push(n.series);
            summary.skipped += 1;
            continue;
          }
          const mintId = mintByCode.get(n.mint) ?? mintByCode.get('?');
          const condId = condByGrade.get(n.condition) ?? condByGrade.get('UNG');

          const existingId = existingByserial.get(n.serial);

          if (!existingId) {
            // NEW row — insert coin + matching purchase.
            const { rows: created } = await client.query(
              `INSERT INTO coins
                 (serial, series_id, year, mint_id, condition_id, paid, book_value,
                  qty, comment_1, comment_2, photo_filename, country_code, acquired_date)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
               RETURNING id`,
              [
                n.serial, seriesId, n.year, mintId, condId, n.paid, n.book,
                n.qty, n.comment_1, n.comment_2, n.photo, n.country, n.acquired_date,
              ],
            );
            const coinId = created[0].id;
            await client.query(
              `INSERT INTO coin_purchases
                 (coin_id, purchase_date, price, qty, source, notes)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [
                coinId,
                n.acquired_date,
                n.paid,
                n.qty,
                n.source ?? 'wizard_import',
                `Imported from ${sess.filename}`,
              ],
            );
            summary.inserted += 1;
            continue;
          }

          // DUPLICATE — apply the user's resolution.
          const choice = VALID_RESOLUTIONS.has(perRow[String(p.idx)])
            ? perRow[String(p.idx)]
            : defaultResolution;

          if (choice === 'skip') {
            summary.skipped += 1;
            continue;
          }

          if (choice === 'overwrite') {
            await client.query(
              `UPDATE coins SET
                 series_id = COALESCE($2, series_id),
                 year = COALESCE($3, year),
                 mint_id = COALESCE($4, mint_id),
                 condition_id = COALESCE($5, condition_id),
                 paid = COALESCE($6, paid),
                 book_value = COALESCE($7, book_value),
                 qty = COALESCE($8, qty),
                 comment_1 = COALESCE($9, comment_1),
                 comment_2 = COALESCE($10, comment_2),
                 photo_filename = COALESCE($11, photo_filename),
                 country_code = COALESCE($12, country_code),
                 acquired_date = COALESCE($13, acquired_date),
                 updated_at = NOW()
               WHERE id = $1`,
              [
                existingId, seriesId, n.year, mintId, condId, n.paid, n.book,
                n.qty, n.comment_1, n.comment_2, n.photo, n.country, n.acquired_date,
              ],
            );
            summary.overwritten += 1;
          }

          // Both 'overwrite' and 'purchase' add a purchase history row —
          // overwrite implies "I'm correcting this AND it's a new acquisition".
          await client.query(
            `INSERT INTO coin_purchases
               (coin_id, purchase_date, price, qty, source, notes)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              existingId,
              n.acquired_date,
              n.paid,
              n.qty,
              n.source ?? 'wizard_import',
              `Imported from ${sess.filename}${
                choice === 'overwrite' ? ' (overwrote coin row)' : ''
              }`,
            ],
          );
          summary.purchasesAdded += 1;
        }

        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
        return next(e);
      }
      client.release();

      // Stash summary on the session for the done page, then drop the
      // big rows blob — we don't need it anymore.
      updateSession(req.params.sid, {
        summary,
        rows: undefined,
      });
      res.redirect(`/import/${req.params.sid}/done`);
    },
  );

  // ─── Step 5: done ───────────────────────────────────────────────────
  router.get('/:sid/done', (req, res) => {
    const sess = readSession(req.params.sid);
    if (!sess) return res.redirect('/import');
    res.render('import_done', {
      title: 'Import — Done',
      sid: req.params.sid,
      filename: sess.filename,
      summary: sess.summary ?? {
        inserted: 0,
        purchasesAdded: 0,
        overwritten: 0,
        skipped: 0,
        invalid: 0,
        missingSeries: [],
      },
    });
  });

  // ─── Cancel: scrub the session file ─────────────────────────────────
  router.post('/:sid/cancel', (req, res) => {
    deleteSession(req.params.sid);
    res.redirect('/');
  });

  return router;
}
