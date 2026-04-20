# CoinHub — Project Plan

**Status:** Planning  
**Owner:** Michael Saville  
**Repository:** [github.com/michaelsaville/coinhub](https://github.com/michaelsaville/coinhub)  
**Deployment:** `coins.pcc2k.com` (same host as portal.pcc2k.com, isolated database)  
**Last Updated:** April 19, 2026

---

## 1. Vision

A mobile-first web app that serves as the definitive digital companion to the coin collection — installable on the phone as a PWA, fast on spotty cell signal at a coin show, with AI features that genuinely help at the table.

### Anchor Scenario

> *Michael is at a coin show. A dealer hands him a 1926-S Buffalo Nickel. Within 10 seconds he needs to know: do I already own this? If so, what condition? If not, is it on my want list, and what's a fair price?*

Every design decision should trace back to whether it helps that 10-second loop.

---

## 2. Feature Set

### Phase 1 — MVP (Coin Show Ready)

The minimum set that makes the app worth carrying to a show.

- **Fast search** — type-ahead across year, mint, series, serial. Returns "YES you have it" or "NO, missing" in under 1 second.
- **Coin detail view** — photos, paid, book value, condition, comments.
- **Want list** — per-series list of year+mint combos not yet in the collection.
- **Add/edit coin** — form to add a new acquisition on the spot, with mint/condition dropdowns and photo capture.
- **Offline-capable** — PWA with service worker caching so the full collection is browsable without signal. Writes queue and sync when connection returns.
- **Auth** — single-user login, session persistence on the phone.

### Phase 2 — AI Integration

- **Photo identification** — snap a coin, Claude API identifies type/series/year/mint candidates, auto-checks against collection.
- **Ask the expert** — chat interface for coin questions ("what's the key date for Mercury Dimes?", "is this 1955 DDO worth the $200 he's asking?").
- **Grading assist** — photo-based condition estimate (with appropriate caveats — this is advisory, not authoritative).
- **Purchase advisor** — given a candidate coin and asking price, pulls recent sold data + want list context to recommend proceed/pass/negotiate.

### Phase 3 — Collection Management

- **Value dashboard** — paid vs book, trends over time, breakdown by type/series, top holdings.
- **Bulk edit** — fix typos, standardize conditions across many rows.
- **Photo manager** — upload/replace/crop, bulk photo import.
- **Reports** — printable inventory, insurance schedule, acquisition timeline.
- **Export** — back to Excel for backup, CSV for other tools.

### Phase 4 — Nice to Have

- **Completion progress bars** per series ("Jefferson Nickels: 78% complete").
- **Acquisition history timeline** — when was each coin added.
- **Barcode/NGC/PCGS slab reader** for already-graded coins.
- **Multi-user/sharing** (read-only link to show the collection).

---

## 3. Data Model

### Source Data Summary

| Sheet | Rows | Purpose |
|---|---|---|
| CoinCollection | 2,445 | Primary inventory — every coin owned |
| NickelMintage, DimeMintage, QuarterMintage, HalfMintage | ~1,500 combined | Reference: every year+mint combo minted (for gap tracking) |
| PenneyWantList, DimeWantList, Dollar_Want_List | ~600 combined | Pre-computed want lists |
| Dashboard | 364 | Summary stats |
| CoinSearch, DimeSearch, QuarterSearch, etc. | — | Excel-formula-driven search views |

### Proposed PostgreSQL Schema

```
coin_types              coins
──────────────          ──────────────
id                      id
name ("Penny")          serial        (IND1887CNT-AA, unique)
denomination_cents      series_id     → coin_series
                        year
coin_series             mint_id       → mints
──────────────          condition_id  → conditions
id                      paid
type_id → coin_types    book_value
name ("Indian Head      qty
  Penny")               comment_1
start_year              comment_2
end_year                verified
                        photo_path
mints                   acquired_date
──────────────          created_at
code ("P","D","S")      updated_at
name
location

conditions              mintage_reference
──────────────          ──────────────
id                      series_id → coin_series
grade ("MS-63")         year
sheldon_value (63)      mint_id   → mints
category                mintage_count
  ("Uncirculated")      is_key_date
                        notes

photos
──────────────
id
coin_id → coins
filename
caption
is_primary
uploaded_at
```

Key design choices:
- `series` separates *what kind* (Indian Head Penny) from *what type* (Penny). Gap tracking runs per series.
- `mintage_reference` is the join target for want-list logic: *"every row in mintage_reference where no matching row exists in coins"* = your want list, computed on demand.
- `conditions` has a numeric sheldon_value so grades are sortable and comparable, not just free text.
- `photos` table supports multiple photos per coin (obverse, reverse, detail shots).

### Data Cleaning Tasks (One-Time Import)

Things I noticed in the source data that need normalization before import:

- **Mint column** — values include `' '`, `'D '`, `' D'`, `'p'`, `9`. Strip whitespace, uppercase, map `' '` (blank) → `'P'` (Philadelphia — the default).
- **DESC typos** — `Murcury Dime`, `Morgan Doller`, `Liberty Halp Dollar`, `Washinton`, `Peneey Book`. Map to canonical series names during import.
- **Condition values** — 13 variants mixing grades (`MS-63`) with descriptions (`Select Uncirculated`) and typos (`Unciculated`). Map each free-text value to the standardized `conditions` table. A one-time mapping CSV reviewed by you keeps this auditable.
- **Serial# column** — appears to be a group/category number (many rows share `1`), not a unique row ID. The `Serial` column (`IND1887CNT-AA`) is the real unique identifier.
- **Helper columns 15–27** — Excel formula scaffolding (`\\coins1\\PHOTOS\\`, `HYPERLINK(...)`). Skip on import.

Suggested approach: build a one-time import script that produces a **pre-flight report** — "these 17 condition values will be mapped as follows, confirm or edit" — before touching the database. No silent guessing on anything ambiguous.

---

## 4. Tech Stack Recommendation

Built to match your existing pcc2k.com infrastructure so there's nothing new to deploy or maintain.

| Layer | Choice | Why |
|---|---|---|
| Repository | [github.com/michaelsaville/coinhub](https://github.com/michaelsaville/coinhub) | Personal GitHub (separate from work `msavillepcccoder`). |
| Backend | Node.js + Express | Matches the portal and invoice printer. Familiar territory. |
| Database | PostgreSQL — **isolated instance** on pcc2k.com (port 5433) | Same host, separate process/data dir from the portal DB. See §4.1 below. |
| Frontend | Progressive Web App — vanilla HTML/CSS/JS + Alpine.js or HTMX | Lightweight, fast on mobile, no build step needed. Installable as home-screen app. |
| Image storage | Local filesystem on pcc2k.com (`/var/lib/coinhub/photos/`), served via Express static | Simple, same pattern as existing apps. |
| AI | Anthropic Claude API (Opus 4.7 for vision/ID, Haiku for quick lookups) | You're already in the ecosystem; no new vendor. |
| Auth | Session cookies + bcrypt, single user | Matches portal pattern. |
| Deploy | `coins.pcc2k.com` — nginx reverse proxy, systemd service, Let's Encrypt | Exact pattern you already use. |
| Dev environment | Claude Code on Ubuntu | Already installed. |

### 4.1 Database Isolation

Running a second Postgres cluster on the same host, separate from whatever the portal uses:

```
/etc/postgresql/16/main/       ← portal (port 5432, existing)
/etc/postgresql/16/coinhub/    ← CoinHub (port 5433, new)
```

Setup pattern:

```bash
# Create second cluster
pg_createcluster 16 coinhub --port=5433 \
  --datadir=/var/lib/postgresql/16/coinhub

# Starts as its own systemd unit: postgresql@16-coinhub.service
systemctl enable --now postgresql@16-coinhub

# Creates a fully separate server — own config, own logs, own pg_hba
```

**Benefits of this approach over just a separate database:**
- Portal DB tuning/restarts don't affect CoinHub and vice versa
- Independent backup schedules and retention
- Postgres major version upgrades can happen separately
- A runaway query in one can't consume shared buffer cache in the other
- Distinct `pg_hba.conf` — tighter access control per app

**Backup strategy** — nightly `pg_dump` via systemd timer to `/var/backups/coinhub/`, rotated 30 days. Mirror to your existing off-box backup target (same one the portal uses).

**Alternative if you'd rather:** Docker container (`postgres:16` with a named volume) gives similar isolation with arguably cleaner teardown, at the cost of introducing Docker to the pcc2k.com box if it's not already there. Separate instance is the minimum-new-surface-area option.

### 4.2 Why PWA Over Native Mobile

A PWA hits the coin-show requirements cleanly:
- Installs to home screen, opens full-screen like a native app
- Works offline with service worker caching
- Camera access via `getUserMedia` — sufficient for coin photos
- No app store friction, no separate iOS/Android codebases
- Updates deploy the moment you push

The only real limitation is that iOS PWAs have some rough edges (e.g., background sync is flaky), but none of that is blocking for this use case.

---

## 5. AI Features — Design Notes

AI is the differentiator here, so worth being specific about how each feature actually works.

### Photo Identification Flow

1. User taps camera button, captures coin (obverse, optionally reverse).
2. Client sends image + prompt to Claude API via backend (backend holds the API key, never exposed to client).
3. Prompt asks for structured JSON response: `{type, series, year_estimate, mint_estimate, confidence, notes}`.
4. Backend takes that response and runs a collection query: *"Do I have any coin matching series=X and year=Y?"*
5. UI shows: coin guess + **own/don't own** badge + condition of existing copies if owned.

### Ask the Expert Flow

A conversational chat pinned to the bottom of any screen. Context-aware — if you're viewing the Buffalo Nickel detail page and ask "what's the key date?", the prompt includes which series you're looking at. Useful patterns:

- Key dates, varieties, mint errors
- Fair market value ranges (with appropriate "check recent sold listings" caveats)
- Authentication red flags to watch for
- Want list prioritization

### Grading Assist — Be Careful Here

Claude can give an educated guess on condition from a photo, but **this cannot replace professional grading**. Build this feature with loud caveats and log every grading suggestion so you can compare AI guesses against eventual pro grades over time. That becomes useful calibration data.

### Purchase Advisor — Guardrails

Given a target coin + asking price, the AI assembles a recommendation. Important: keep it advisory. The logic flow should be:
1. Is it on the want list? (deterministic, from DB)
2. What's the current book value? (from DB)
3. What's recent sold data suggest? (Claude answers based on its knowledge; flag if uncertain)
4. Final advice is a synthesis you can accept, modify, or ignore.

---

## 6. Mobile UX — Coin Show Optimizations

Specific design decisions driven by the phone-at-a-show use case:

- **Giant search bar on the home screen** — no drilling. Type "1887" and see every match immediately.
- **Thumb-zone buttons** — primary actions in the bottom 30% of the screen where the thumb naturally rests.
- **High-contrast mode** — coin show lighting is terrible. A bright-light toggle swaps to high-contrast colors.
- **No modal dialogs** for destructive actions — use bottom sheets that confirm with a swipe instead.
- **Camera shortcut** on the home screen — one tap to start photo ID.
- **Offline banner** — discreet indicator showing when the app is running from cache vs live.
- **Large tap targets** (48px minimum) — tired eyes + handling coins = fat-finger territory.
- **Landscape-friendly detail views** — coin photos are more useful in landscape.

---

## 7. Architecture Diagram (Rough)

```
  ┌─────────────────────────┐
  │   Phone (PWA installed) │
  │   - Service Worker      │
  │   - IndexedDB cache     │
  │   - Camera access       │
  └───────────┬─────────────┘
              │ HTTPS
  ┌───────────▼─────────────┐
  │  nginx (pcc2k.com)      │
  │  coins.pcc2k.com →      │
  └───────────┬─────────────┘
              │
  ┌───────────▼──────────────────┐
  │  Node.js / Express           │   ← systemd: coinhub.service
  │  - REST API                  │
  │  - Auth                      │
  │  - Photo upload              │
  │  - AI proxy endpoints        │
  └────┬─────────────────┬───────┘
       │                 │
  ┌────▼─────────┐  ┌────▼──────────┐
  │ Postgres     │  │ Claude API    │
  │ :5433        │  │ (vision+chat) │
  │ (isolated    │  └───────────────┘
  │  instance)   │
  │              │
  │ Portal DB    │   ← separate cluster on :5432
  │ stays on     │     not touched by CoinHub
  │ :5432        │
  └──────────────┘

  Photos: /var/lib/coinhub/photos/  (local filesystem)
  Backups: /var/backups/coinhub/    (nightly pg_dump)
```

---

## 8. Build Sequence

A suggested order of operations so each step produces something usable:

1. **Schema + import script** — get the data into Postgres cleanly. Deliverable: a queryable DB + a cleanup report.
2. **Read-only web UI** — list, search, detail views. No editing yet. Deliverable: you can browse your whole collection on your phone.
3. **PWA shell** — service worker, manifest, offline cache. Deliverable: installable on home screen, works without signal.
4. **Want list views** — surface the mintage-vs-owned diff. Deliverable: per-series gap reports.
5. **Add/edit flow** — forms, photo upload. Deliverable: can add a new coin from the show.
6. **AI photo ID** — camera → Claude → match. Deliverable: the killer feature.
7. **AI chat assistant** — context-aware expert. Deliverable: ask questions in-app.
8. **Dashboard + reports** — value tracking, exports. Deliverable: insurance-ready PDF.

Each step is independently shippable — if you stop after step 2 you still have something useful.

---

## 9. Open Questions

Things I'd want your input on before writing any code:

- ~~**Photos** — where do they live?~~ ✅ **Decided:** `/var/lib/coinhub/photos/` on pcc2k.com, served via Express static.
- ~~**Backup cadence**~~ ✅ **Decided:** Nightly `pg_dump` to `/var/backups/coinhub/`, 30-day retention, mirrored to existing off-box target.
- **Existing photo migration** — the workbook references `\\coins1\\PHOTOS\\` (Windows UNC path). Where does that share actually live now, and should we bulk-migrate those JPGs into `/var/lib/coinhub/photos/` during initial import, or start fresh and re-photograph over time?
- **Mintage reference source** — import from your existing NickelMintage/DimeMintage sheets (faster, matches what you already trust), or pull from an authoritative external source like NGC/PCGS lists (more complete but risks conflicts with your sheets)? I'd lean toward: import yours first, flag gaps against an external source as a one-time audit.
- **Graded slabs** — any NGC/PCGS-graded coins where we should track the slab serial number as a first-class field? Adds a `slab_serial`, `grading_service`, `grade_detail` set of fields on `coins` if yes.
- **Other collectors / sharing** — this is single-user for now. Ever imagine sharing read-only views with family for estate-planning purposes, or with an insurance adjuster? Affects auth design (plan for it vs. punt on it).
- **Currency scope** — the data has a few Canadian dollars and foreign items (`Marshaal Island`, `Korean Memorial`, `Olympic Dollar`). Keep US-focused with a generic "other" bucket, or build the schema with `country_code` from day one?

---

## 10. Next Steps

1. Review this plan, mark any changes or pushback.
2. Decide on MVP feature cut — trim Phase 1 if any of it feels aspirational.
3. Answer the remaining open questions in §9 so schema can be finalized.
4. **Infrastructure setup:**
   - Create empty `michaelsaville/coinhub` repo with README, `.gitignore`, LICENSE
   - DNS: add `coins.pcc2k.com` A record pointing to pcc2k.com server
   - Provision isolated Postgres cluster on `:5433` (see §4.1)
   - nginx stub config for `coins.pcc2k.com` (Let's Encrypt cert)
   - systemd unit placeholder for `coinhub.service`
5. Start with step 1 of the build sequence — import script + cleanup report.
