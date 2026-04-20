# CoinHub

Personal, mobile-first PWA for my coin collection.

- **Live:** `coins.pcc2k.com` (after deployment)
- **Repo:** [github.com/michaelsaville/coinhub](https://github.com/michaelsaville/coinhub)
- **Plan:** [`docs/project-plan.md`](docs/project-plan.md)

## Quickstart

```bash
docker compose up -d         # isolated Postgres on 127.0.0.1:5434
cp .env.example .env         # then edit .env (password + DATABASE_URL)
npm install
npm run migrate              # apply schema + seed reference data
npm run import:dry           # produces data/output/import-report.md
# review the report, iterate mappings in scripts/import.js
npm run import:apply         # once the report looks right
```

Full provisioning procedure: [`docs/setup.md`](docs/setup.md).

## Status

Session 1 (schema + import). No web app yet — that's session 2.
