// packages/lib/src/data-migrations/per-org.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../cache'
import { describeMigrationError, MAX_SUMMARY_LENGTH } from './describe-migration-error'
import type { DataMigrationDef } from './types'

const logger = createScopedLogger('per-org-migration')

/**
 * A migration authored per organization rather than per database.
 *
 * Most schema-shaped work (a new EntityDefinition, CustomField, select option or
 * display field) has to be applied once per org, because those rows are seeded
 * per-org by `EntitySeeder` from the resource registry and a registry edit reaches
 * no existing organization on its own.
 *
 * This is NOT a second migration framework. {@link perOrgMigration} adapts one of
 * these into the {@link DataMigrationDef} the single registry, ledger and runner
 * already understand — the org loop and the cache invalidation are the only things
 * the shape buys you.
 *
 * `up()` MUST be idempotent: the ledger guarantees exactly-once across the fleet,
 * but a run that fails on org 40 of 200 is retried from the top.
 */
export interface PerOrgMigration {
  /** Unique migration id (e.g. '001-vendor-part-subpart'). Never change after shipping. */
  id: string
  /** Human-readable description */
  description: string
  /** Run the migration for a single organization */
  up: (db: Database, organizationId: string) => Promise<PerOrgMigrationResult>
}

export interface PerOrgMigrationResult {
  /** Number of EntityDefinitions created */
  entityDefsCreated: number
  /** Number of CustomFields created */
  fieldsCreated: number
  /** Number of relationships linked */
  relationshipsLinked: number
  /** Whether everything was already up to date (nothing created) */
  alreadyUpToDate: boolean
}

/**
 * Per-org failure lines quoted verbatim in the aggregate thrown by
 * {@link perOrgMigration}. A migration that fails on one org
 * usually fails on all of them for the same reason, so the first few lines
 * carry the whole diagnosis and lines 6..N are just N copies of it — bounded
 * here so an org count, not a bug, can never inflate the message.
 */
const MAX_QUOTED_ORG_FAILURES = 5

const TRUNCATION_MARKER = '…[truncated]'

/** Hard bound — the result never exceeds `max`, marker included. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`
}

/**
 * Render the multi-org failure list for the aggregate error message.
 *
 * Two independent bounds, because each per-org line is already a
 * {@link describeMigrationError} summary capped at {@link MAX_SUMMARY_LENGTH}:
 * quoting every org would make the aggregate `orgs × 2 KB`. The line count is
 * capped first, then the whole message is capped at {@link MAX_SUMMARY_LENGTH}
 * so it matches what the ledger will actually store. The header carries the
 * *count* and is emitted before the truncation point, so "how many orgs failed"
 * survives no matter how verbose one org's error was.
 */
function buildAggregateFailureMessage(migrationId: string, failures: string[]): string {
  const header = `Migration ${migrationId} failed for ${failures.length} org(s):`
  const quoted = failures.slice(0, MAX_QUOTED_ORG_FAILURES)
  const omitted = failures.length - quoted.length
  const lines = omitted > 0 ? [...quoted, `…and ${omitted} more org(s)`] : quoted

  return `${header}\n${truncate(lines.join('\n'), MAX_SUMMARY_LENGTH - header.length - 1)}`
}

/**
 * Run a single entity migration across every organization.
 *
 * The transpose of `perOrgMigration` (one migration × all orgs vs.
 * all migrations × one org): the data-migrations framework drives each registered
 * migration independently, so it needs this shape. Preserves the per-org cache
 * invalidation and the global flush of the per-all-orgs runner.
 *
 * Partial failure: collects per-org errors, runs the remaining orgs, then THROWS the
 * aggregate so the ledger marks the migration `failed`. Retry is safe and cheap —
 * succeeded orgs no-op via their own idempotency checks, only failed orgs redo work.
 */
async function runForAllOrgs(db: Database, migration: PerOrgMigration): Promise<void> {
  const orgs = await db.select({ id: schema.Organization.id }).from(schema.Organization)

  logger.info(`Running entity migration ${migration.id} for ${orgs.length} organizations`)

  const errors: string[] = []
  /** The raw first failure, kept as the `cause` of the aggregate below. */
  let firstError: unknown
  let totalCreated = 0

  for (const org of orgs) {
    try {
      const result = await migration.up(db, org.id)
      if (!result.alreadyUpToDate) {
        totalCreated += result.entityDefsCreated + result.fieldsCreated
        // Recompute this org's entity/field caches so it picks up the new definitions
        await getOrgCache().invalidateAndRecompute(org.id, [
          'entityDefs',
          'entityDefSlugs',
          'customFields',
          'resources',
        ])
        logger.info(`Migration ${migration.id} applied`, {
          organizationId: org.id,
          entityDefsCreated: result.entityDefsCreated,
          fieldsCreated: result.fieldsCreated,
          relationshipsLinked: result.relationshipsLinked,
        })
      }
    } catch (error) {
      // Same reason as in `perOrgMigration`: the recorded line must name
      // the pg error, not Drizzle's `Failed query: …` wrapper.
      const { summary, pg } = describeMigrationError(error)
      logger.error(`Migration ${migration.id} failed for org`, {
        organizationId: org.id,
        error: summary,
        ...pg,
      })
      if (errors.length === 0) firstError = error
      errors.push(`${org.id}: ${summary}`)
    }
  }

  // Belt-and-braces global flush so every org picks up new definitions
  if (totalCreated > 0) {
    logger.info('Flushing entity and field caches for all orgs')
    await getOrgCache().flushKeyForAllOrgs([
      'entityDefs',
      'entityDefSlugs',
      'customFields',
      'resources',
    ])
  }

  if (errors.length > 0) {
    // Both halves are needed, and they fix different things:
    //  - the message quotes `describeMigrationError` summaries, so a human reading
    //    the ledger row or the script output sees the pg code/constraint per org;
    //  - `cause` keeps the ORIGINAL error object on the chain. This aggregate is
    //    what `perOrgMigration` hands to `runPendingDataMigrations`, which
    //    re-describes it; a causeless `new Error(...)` severs the chain there and
    //    the runner's unwrapping recovers nothing for all ~50 wrapped entity
    //    migrations. The first failure is the cause because a migration that
    //    breaks on one org almost always breaks on the rest identically.
    throw new Error(buildAggregateFailureMessage(migration.id, errors), { cause: firstError })
  }
}

/**
 * Adapt a {@link PerOrgMigration} into the {@link DataMigrationDef} the registry holds.
 *
 * The migration's `id`/`description` carry over as the ledger id; `run()` drives it
 * across every org, which throws an aggregate on any per-org failure so the ledger
 * marks it `failed`.
 *
 * The migration's own per-org idempotency checks are not the exactly-once mechanism
 * (the ledger is that) — they are the retry/repair safety net.
 */
export function perOrgMigration(migration: PerOrgMigration): DataMigrationDef {
  return {
    id: migration.id,
    description: migration.description,
    run: (db) => runForAllOrgs(db, migration),
  }
}
