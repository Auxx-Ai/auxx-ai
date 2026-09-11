# Data migrations

One registry, one ledger, one runner, one `NNN` id sequence. Everything in this
folder is a migration; there is no second framework.

## The two authoring shapes

**Whole-database** — export a `DataMigrationDef` (`../types.ts`):

```ts
export const migration151Thing: DataMigrationDef = {
  id: '151-thing',
  description: 'What it does and why, in one sentence',
  async run(db) { /* throws on failure */ },
}
```

**Per-org** — export a `PerOrgMigration` (`../per-org.ts`) and register it in
`PER_ORG_MIGRATIONS`. The adapter drives it across every org and busts each org's
`entityDefs` / `entityDefSlugs` / `customFields` / `resources` caches for you:

```ts
export const migration151Thing: PerOrgMigration = {
  id: '151-thing',
  description: '...',
  async up(db, organizationId) { /* returns PerOrgMigrationResult */ },
}
```

Use the per-org shape whenever you touch `EntityDefinition`, `CustomField`,
select options or display fields, because those rows are seeded **per org** by
`EntitySeeder` from the resource registry — so a registry edit alone reaches no
existing organization.

## Rules

1. **Ids are permanent ledger keys and are never reused.** 001 to 150 are retired;
   `registry.ts` throws at module load if you reuse one. Take the next free number.
2. **`run`/`up` must throw on failure.** The ledger only records what the runner sees.
3. **Be idempotent.** The ledger gives exactly-once across the fleet, but a run that
   fails on org 40 of 200 is retried from the top.
4. **Never rewrite a stored option `value` key.** `FieldValue.optionId` holds it.
   Append what is missing and relabel; see `118-movement-type-relabel.ts`.
5. **A shipped migration is frozen.** Once it is `applied` anywhere, correcting it
   means a NEW id — the ledger will not re-run an applied row.
6. **Schema tightening does not belong here.** A generated Drizzle migration that
   does `SET NOT NULL` or adds a UNIQUE index must carry its own backfill SQL, never
   assume a runtime data migration ran between two schema files.

## The worked examples

The eight migrations kept here are all long since applied. They exist to show the
shapes, not because anything needs them.

| File | Shows |
| --- | --- |
| `149-shipment-parcel.ts` | Per-org: new defs, their fields, and an inverse relationship. The richest example. |
| `148-recurring-journal-entries.ts` | Per-org: add a select option plus fields to an existing def. The everyday case. |
| `150-strip-legacy-address-components.ts` | Per-org: mutate `CustomField.options` on fields that already exist. |
| `118-movement-type-relabel.ts` | Per-org: relabel options without breaking stored `optionId`s (rule 4). |
| `045-default-entity-dashboards.ts` | Per-org, and **not** just an example — `apps/worker/scripts/reseed-default-dashboard.ts` still re-runs its ensure. |
| `147-backfill-bank-match-keys.ts` | Per-org: recompute a stored column from its own source. |
| `099-imap-backfill-stamps.ts` | Whole-database: walk a table and stamp rows, with the decision split out as a pure exported function its unit test drives with no database. Copy this one. |
| `131-reseed-platform-providers-bank-feed.ts` | Whole-database: call a live idempotent seeder. The smallest useful migration. |

## Running one by hand

`packages/lib/scripts/run-entity-migration.ts --id <id> [--org <organizationId>]`
runs a per-org migration outside the ledger, for dev. In production the boot job
and the superadmin panel are the only triggers.
