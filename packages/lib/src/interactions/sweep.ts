// packages/lib/src/interactions/sweep.ts
//
// The gap filler behind the nightly job and the backfill script.
//
// 🔴 **Windowed on purpose.** Company enrichment's sweep can use its stored status as a
// terminal marker; this feature deliberately has no status field, because the work is
// idempotent and a marker would be a schema column to maintain forever. The cost of that
// choice is that "records with no interaction stamps" is NOT a converging candidate set: a
// contact who has genuinely never written to us never gets a stamp, so an unwindowed sweep
// would re-examine every such contact in the org every single night, growing with the
// contact table.
//
// So the sweep only looks at recently created records. The two live callers handle
// everything as it happens (the integrity pass for bulk runs, the field hook for interactive
// writes), the backfill script handles history, and this catches a caller that dropped
// something in the last month. Nothing is lost past the window either: mail arriving later
// matches the contact by `primary_email` at ingest and stamps it on the spot.
//
// If a real "we have looked at this record" signal is ever wanted, the idiomatic form is a
// third scan watermark on `EntityInstance` beside `lastSuggestionScanAt` and
// `lastDuplicateScanAt` — a schema change, so only if this proves insufficient.

import { type Database, database as defaultDb, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm'
import { RECORDS_PER_BATCH, resolveInteractions } from './resolve'

const logger = createScopedLogger('interactions')

/** How far back the sweep looks. Older gaps are the backfill script's job. */
export const SWEEP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/** Hard ceiling on one sweep, across every org. */
const DEFAULT_MAX_RECORDS = 5_000

/** Ceiling per org, so one large org cannot consume a whole sweep. */
const DEFAULT_MAX_PER_ORGANIZATION = 2_000

export interface InteractionSweepOptions {
  db?: Database
  /** Restrict to one org. Used by the backfill script. */
  organizationId?: string
  /**
   * Ignore the 30-day window and consider every record with no stamps. The backfill script
   * passes this: recovering history is exactly the one-off case the window exists to keep
   * OUT of the nightly job.
   */
  allTime?: boolean
  maxRecords?: number
  maxPerOrganization?: number
  /** Resolve candidates and report, write nothing. */
  dryRun?: boolean
}

export interface InteractionSweepSummary {
  candidates: number
  organizations: number
  /** Candidates dropped because their org had already hit `maxPerOrganization`. */
  deferred: number
  resolved: number
  participantsAdopted: number
  threadParticipantsBackfilled: number
  contactsStamped: number
  companiesStamped: number
  employersAttached: number
}

export interface InteractionCandidate {
  organizationId: string
  recordId: string
}

/**
 * Contacts and companies with no interaction history, oldest first.
 *
 * `firstInteractionAt IS NULL` rather than `lastInteractionAt IS NULL`: the two are written
 * by one statement so they move together, and the first one is the column the
 * `(organizationId, entityDefinitionId, lastInteractionAt)` sibling index was added
 * alongside.
 */
export async function findRecordsNeedingInteractionResolution(
  options: InteractionSweepOptions = {}
): Promise<InteractionCandidate[]> {
  const db = options.db ?? defaultDb
  const limit = options.maxRecords ?? DEFAULT_MAX_RECORDS
  const createdAfter = new Date(Date.now() - SWEEP_WINDOW_MS)

  const rows = await db
    .select({
      organizationId: schema.EntityInstance.organizationId,
      recordId: schema.EntityInstance.id,
    })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.EntityDefinition,
      and(
        eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId),
        inArray(schema.EntityDefinition.entityType, ['contact', 'company'])
      )
    )
    .where(
      and(
        isNull(schema.EntityInstance.archivedAt),
        isNull(schema.EntityInstance.firstInteractionAt),
        options.organizationId
          ? eq(schema.EntityInstance.organizationId, options.organizationId)
          : undefined,
        options.allTime ? undefined : gt(schema.EntityInstance.createdAt, createdAfter)
      )
    )
    .orderBy(asc(schema.EntityInstance.createdAt))
    .limit(limit)

  return rows
}

/**
 * Find and resolve, per org, in batches.
 *
 * Resolves INLINE rather than enqueueing (the enrichment sweep's shape): the work is a set
 * of indexed statements, not an outbound fetch, so there is nothing for a queue to bound and
 * the backfill script needs no worker running to be useful.
 */
export async function sweepInteractionResolution(
  options: InteractionSweepOptions = {}
): Promise<InteractionSweepSummary> {
  const candidates = await findRecordsNeedingInteractionResolution(options)
  const perOrgCap = options.maxPerOrganization ?? DEFAULT_MAX_PER_ORGANIZATION

  const byOrg = new Map<string, string[]>()
  let deferred = 0
  for (const candidate of candidates) {
    const taken = byOrg.get(candidate.organizationId) ?? []
    if (taken.length >= perOrgCap) {
      deferred++
      continue
    }
    taken.push(candidate.recordId)
    byOrg.set(candidate.organizationId, taken)
  }

  const summary: InteractionSweepSummary = {
    candidates: candidates.length,
    organizations: byOrg.size,
    deferred,
    resolved: 0,
    participantsAdopted: 0,
    threadParticipantsBackfilled: 0,
    contactsStamped: 0,
    companiesStamped: 0,
    employersAttached: 0,
  }

  for (const [organizationId, recordIds] of byOrg) {
    summary.resolved += recordIds.length
    if (options.dryRun) continue

    // `resolveInteractions` batches internally; the outer slice only bounds how many ids
    // one call holds in memory at once.
    for (let offset = 0; offset < recordIds.length; offset += RECORDS_PER_BATCH * 4) {
      const slice = recordIds.slice(offset, offset + RECORDS_PER_BATCH * 4)
      const result = await resolveInteractions({
        organizationId,
        recordIds: slice,
        reason: 'backfill',
        db: options.db,
      })
      summary.participantsAdopted += result.participantsAdopted
      summary.threadParticipantsBackfilled += result.threadParticipantsBackfilled
      summary.contactsStamped += result.contactsStamped
      summary.companiesStamped += result.companiesStamped
      summary.employersAttached += result.employersAttached
    }
  }

  logger.info('Interaction resolution sweep finished', {
    ...summary,
    dryRun: options.dryRun ?? false,
    allTime: options.allTime ?? false,
  })
  return summary
}
