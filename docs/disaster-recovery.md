# Disaster Recovery Runbook — Production (Railway)

Procedures for when production data or services break. Read this **before** an incident, not during one.

**Target RPO:** ≤ 24h (daily volume snapshots are the primary recovery mechanism).
**Target RTO:** restore + verify + swap in under ~1h.

> First rule of a restore: **stop writes before you restore.** A live app writing to a DB you're about to swap corrupts the recovery.

---

## Production inventory (what we're protecting)

| Service | Volume | Mount | Holds |
| --- | --- | --- | --- |
| **pgvector** | `pgvector-volume` (`cfbc815b-06d3-444c-9121-ebf69ef5fecb`) | `/var/lib/postgresql` | **The live app DB.** PostgreSQL 18.4, `vector` extension. `PGDATA=/var/lib/postgresql/data/pgdata` |
| Redis | `redis-4xb4-volume` | `/data` | Cache + BullMQ queues. Regenerable; not a restore target. |
| api | `api-volume-bjWk` | `/app/geo` | Geo/IP data. Regenerable. |
| Postgres | `postgres-volume` | `/var/lib/postgresql/data` | **Unused legacy service.** Not the app DB — do not restore into it. |

**Connection facts (pgvector):**
- Private (inside Railway): `pgvector.railway.internal:5432`, db `railway`, user `postgres`
- Public proxy (from laptop): `shortline.proxy.rlwy.net:29274` — host/port rotate; always read the live value from `railway variables -s pgvector --json`
- The DB password is injected as `DATABASE_URL` into every app service (web, api, worker, build, lambda-server). **Never paste it into this doc or a commit.**

**Local tooling:** `psql` / `pg_dump` live at `/opt/homebrew/opt/libpq/bin` (libpq). They must be **PG 18 clients** to dump/restore a PG 18 server — check with `psql --version`.

---

## ⚠️ Prerequisite: verify scheduled volume backups exist

The entire primary plan assumes Railway is taking daily snapshots of `pgvector-volume`. **This cannot be checked via CLI/API** (the backup GraphQL fields return `Not Authorized` for CLI tokens). Verify in the dashboard:

> Railway → project **Auxx Ai** → **pgvector** service → **Volume** → **Backups** tab

Confirm: schedule = **Daily**, retention ≥ **7 days**, and at least one recent backup is listed. If the tab is empty, **enable it now** — without it, none of "Scenario 1" works.

Railway volume backups are **snapshots, not point-in-time recovery**. You can only restore to the moment a snapshot was taken (hence the 24h RPO).

---

## Scenario 1 — DB corruption / bad delete / destructive migration

**Symptom:** data is wrong/missing/gone, but the most recent daily snapshot predates the damage.

1. **Freeze writes.** Scale the app services to 0 so nothing writes during the restore:
   ```bash
   railway scale -s web 0
   railway scale -s api 0
   railway scale -s worker 0
   railway scale -s build 0
   railway scale -s lambda-server 0
   ```
   (Or, if `scale` isn't available on the plan, pause/remove the deployments via the dashboard.)
2. **Restore the snapshot.** Dashboard → pgvector → Volume → Backups → pick the last-good snapshot → **Restore**. Railway provisions a new volume from it.
3. **Verify before committing.** If Railway restores into a new/temp volume, attach it to a throwaway PG service first and sanity-check:
   ```bash
   psql "$RESTORED_URL" -c "select count(*) from contact;"   # or another known table
   psql "$RESTORED_URL" -c "select max(created_at) from <a high-traffic table>;"
   ```
   Confirm the timestamp predates the damage and row counts look right.
4. **Swap & redeploy.** Attach the restored volume to `pgvector` (mount path **must** stay `/var/lib/postgresql`), then redeploy:
   ```bash
   railway redeploy -s pgvector
   ```
5. **Unfreeze.** Scale the app services back up (web/api/worker/build/lambda-server) and confirm health.
6. **Post-incident:** write down what was lost in the snapshot→damage window and reconcile if possible.

**If the damage is narrow** (one table / a known bad migration) and the rest of the DB is fine, prefer a **partial restore** over a full rollback: restore the snapshot into a *scratch* PG, `pg_dump -t <table>` the good copy, and load just that table back into live — no full-DB rollback, no losing good writes elsewhere.

---

## Scenario 2 — Railway-wide outage / account or region loss

Volume backups live **inside Railway** — useless if Railway itself is the failure. This is the gap the 24h-RPO snapshot plan does **not** cover.

**Mitigation (recommended, not yet built):** a nightly offsite logical backup.
- A small BullMQ cron in `apps/worker`: `pg_dump --format=custom "$DATABASE_URL"` → private S3 bucket (a **private** bucket, not `auxx-public`), 30-day retention.
- Recovery: provision any PG 18 + pgvector anywhere and `pg_restore` the dump. This is also our portability-off-Railway path.

**Manual offsite dump on demand** (do this before any risky migration):
```bash
URL=$(railway variables -s pgvector --json | python3 -c "import json,sys;print(json.load(sys.stdin)['DATABASE_URL'])")
pg_dump --format=custom --no-owner --file="pgvector-$(date +%Y%m%d-%H%M).dump" "$URL"
```
Restore into a fresh PG 18 (with `vector` available):
```bash
pg_restore --no-owner --dbname "$TARGET_URL" pgvector-YYYYMMDD-HHMM.dump
```

---

## Scenario 3 — Bad deploy / app regression

No DB involved — just roll the app back.

```bash
railway deployment list -s web          # find the last-good deployment
railway redeploy -s web                 # redeploy current, or roll a git revert
```
Or revert the offending commit and let CI redeploy. If a **migration** shipped with the bad deploy, treat it as Scenario 1 — code rollback alone won't undo schema/data changes.

---

## Scenario 4 — Accidental volume or service deletion

Railway deletions are effectively immediate and unrecoverable. There is no "trash."
- **Prevention:** limit who has prod write access; double-check the service name before any destructive dashboard action.
- **Recovery:** only the offsite dump from Scenario 2. This is the strongest argument for building it.

---

## Scenario 5 — DB credential compromise / rotation

The pgvector password is referenced by every app service via `DATABASE_URL`. To rotate:
1. Change `POSTGRES_PASSWORD` / `PGPASSWORD` on the **pgvector** service (and `DATABASE_URL` if it's a literal, not a reference variable).
2. Propagate to every consumer: web, api, worker, build, lambda-server.
3. Redeploy consumers (DB last, or DB first then consumers — avoid a window where they disagree).
4. Verify each service reconnects (check logs for auth failures).

---

## Scenario 6 — Disk fill / WAL bloat

`pgvector-volume` is 10 GB, ~0.8 GB used today — comfortable, but unmonitored. A runaway query or WAL growth can fill it and stop Postgres.
- **Detect:** `railway volume list` shows `Storage used`. Alert when pgvector crosses ~70% (7 GB).
- **Recover:** bump volume size in the dashboard, or stop the write source. WAL bloat usually clears once the blocker (stuck replication slot, long transaction) is removed.

---

## Restore-compatibility checklist (read before any restore)

- Target Postgres **major version = 18** (server is 18.4). Don't restore into PG 16/17.
- `vector` extension must be available on the target (`create extension vector;`).
- `pg_dump`/`pg_restore` client version ≥ server major (use the PG 18 libpq client).
- Mount path on swap must stay `/var/lib/postgresql` (PGDATA is `…/data/pgdata`).

---

## Test it (a backup you've never restored is not a backup)

Quarterly: take a `pg_dump`, restore it into a scratch Railway PG 18, and diff key table counts against production. Record the date/result here:

| Date | Method | Result | By |
| --- | --- | --- | --- |
| _(none yet)_ | | | |
