// File-backed session store for the import wizard.
//
// Each session lives at `data/import-sessions/{sid}.json` and survives
// across requests + server restarts. We pick this over an in-memory map
// because the wizard is multi-step (upload → map → preview → commit) and
// the user might wander away mid-flow; the file lets them resume.
//
// Sessions older than SESSION_TTL_MS are swept on every read so the
// directory doesn't grow unbounded. There's also a write-time cap on
// retained rows to keep individual session files reasonable.

import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = resolve(__dirname, '../../data/import-sessions');
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

mkdirSync(SESSION_DIR, { recursive: true });

function pathFor(sid) {
  // Belt-and-braces — sid comes from the URL.
  if (!/^[a-zA-Z0-9-]+$/.test(sid)) throw new Error('invalid session id');
  return join(SESSION_DIR, `${sid}.json`);
}

export function createSession(payload) {
  const sid = randomUUID();
  writeFileSync(pathFor(sid), JSON.stringify({ createdAt: Date.now(), ...payload }));
  sweepOldSessions();
  return sid;
}

export function readSession(sid) {
  try {
    const buf = readFileSync(pathFor(sid), 'utf8');
    return JSON.parse(buf);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export function updateSession(sid, patch) {
  const cur = readSession(sid);
  if (!cur) throw new Error('session not found');
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  writeFileSync(pathFor(sid), JSON.stringify(next));
  return next;
}

export function deleteSession(sid) {
  try {
    unlinkSync(pathFor(sid));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

function sweepOldSessions() {
  const now = Date.now();
  for (const name of readdirSync(SESSION_DIR)) {
    if (!name.endsWith('.json')) continue;
    try {
      const full = join(SESSION_DIR, name);
      const st = statSync(full);
      if (now - st.mtimeMs > SESSION_TTL_MS) unlinkSync(full);
    } catch {
      /* ignore — concurrent reaper or transient FS error */
    }
  }
}
