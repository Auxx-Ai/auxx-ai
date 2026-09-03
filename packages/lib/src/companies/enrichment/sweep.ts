// packages/lib/src/companies/enrichment/sweep.ts
// The gap filler. Finds companies that never reached a terminal enrichment status and
// queues them.
//
// Three things land here and nothing else would ever pick them up:
//   1. Companies created BEFORE enrichment existed, or before it had more than one door.
//   2. Companies the per-org window limiter dropped mid-import — deliberately left with no
//      status write precisely so this sweep re-finds them.
//   3. Companies stuck on `pending` because a worker died between the marker and the
//      terminal write.
//
// It is deliberately NOT a re-enricher. Records already on `enriched` are never selected,
// and `shouldEnrich` would refuse them anyway. Widening it to re-enrich on TTL expiry is a
// one-predicate change once real fetch volumes are known.

import { type Database, database as defaultDb, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { enqueueCompanyEnrichment } from './enqueue'
import { FAILED_TTL_MS, ORG_WINDOW_LIMIT } from './guards'

const logger = createScopedLogger('companies:enrichment-sweep')

/** Hard ceiling on one sweep, across every org. */
const DEFAULT_MAX_RECORDS = 2000

export interface EnrichmentSweepOptions {
  db?: Database
  /** Restrict to one org. Used by the backfill script. */
  organizationId?: string
  /** Ceiling across all orgs (default 2000). */
  maxRecords?: number
  /** Ceiling per org (defaults to the org's hourly fetch budget). */
  maxPerOrganization?: number
  /** Resolve candidates and report, enqueue nothing. */
  dryRun?: boolean
}

export interface EnrichmentSweepSummary {
  candidates: number
  enqueued: number
  /** Candidates dropped because their org had already hit `maxPerOrganization`. */
  deferred: number
  organizations: number
}

export interface EnrichmentCandidate {
  organizationId: string
  companyInstanceId: string
}

/**
 * Companies with no terminal enrichment status, oldest first.
 *
 * Note it does NOT filter on having a domain. A company with neither a domain nor a usable
 * website is exactly the case worth surfacing: `enrichCompany` resolves it to the
 * `'skipped'` status, which is a terminal state, so it costs one cheap pass and is never
 * selected again. Filtering it out here would instead leave those records invisible
 * forever, which is the bug this whole change exists to fix.
 */
export async function findCompaniesNeedingEnrichment(
  options: EnrichmentSweepOptions = {}
): Promise<EnrichmentCandidate[]> {
  const db = options.db ?? defaultDb
  const limit = options.maxRecords ?? DEFAULT_MAX_RECORDS
  // `FieldValue.valueDate` is `mode: 'string'` in the schema, so the comparison value has
  // to be an ISO string too.
  const staleBefore = new Date(Date.now() - FAILED_TTL_MS).toISOString()

  const statusField = alias(schema.CustomField, 'enrichment_status_field')
  const statusValue = alias(schema.FieldValue, 'enrichment_status_value')
  const atField = alias(schema.CustomField, 'enriched_at_field')
  const atValue = alias(schema.FieldValue, 'enriched_at_value')

  const rows = await db
    .select({
      organizationId: schema.EntityInstance.organizationId,
      companyInstanceId: schema.EntityInstance.id,
    })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.EntityDefinition,
      and(
        eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId),
        eq(schema.EntityDefinition.entityType, 'company')
      )
    )
    .leftJoin(
      statusField,
      and(
        eq(statusField.entityDefinitionId, schema.EntityInstance.entityDefinitionId),
        eq(statusField.systemAttribute, 'company_enrichment_status')
      )
    )
    .leftJoin(
      statusValue,
      and(
        eq(statusValue.entityId, schema.EntityInstance.id),
        eq(statusValue.fieldId, statusField.id)
      )
    )
    .leftJoin(
      atField,
      and(
        eq(atField.entityDefinitionId, schema.EntityInstance.entityDefinitionId),
        eq(atField.systemAttribute, 'company_enriched_at')
      )
    )
    .leftJoin(
      atValue,
      and(eq(atValue.entityId, schema.EntityInstance.id), eq(atValue.fieldId, atField.id))
    )
    .where(
      and(
        isNull(schema.EntityInstance.archivedAt),
        options.organizationId
          ? eq(schema.EntityInstance.organizationId, options.organizationId)
          : undefined,
        or(
          // Never attempted.
          isNull(statusValue.optionId),
          // Attempted, non-terminal or stale-failed. `pending` is in here because a worker
          // that died between the marker and the terminal write leaves exactly that, and
          // nothing else would ever retry it.
          and(
            inArray(statusValue.optionId, ['failed', 'pending']),
            or(isNull(atValue.valueDate), lt(atValue.valueDate, staleBefore))
          )
        )
      )
    )
    .orderBy(sql`${schema.EntityInstance.createdAt} asc`)
    .limit(limit)

  return rows
}

/**
 * Find and enqueue. Per-org capped so one large org cannot consume a whole sweep, and
 * because everything past the org's hourly budget would only come back `rate-limited`.
 */
export async function sweepCompaniesNeedingEnrichment(
  options: EnrichmentSweepOptions = {}
): Promise<EnrichmentSweepSummary> {
  const candidates = await findCompaniesNeedingEnrichment(options)
  const perOrgCap = options.maxPerOrganization ?? ORG_WINDOW_LIMIT

  const takenByOrg = new Map<string, number>()
  let enqueued = 0
  let deferred = 0

  for (const candidate of candidates) {
    const taken = takenByOrg.get(candidate.organizationId) ?? 0
    if (taken >= perOrgCap) {
      deferred++
      continue
    }
    takenByOrg.set(candidate.organizationId, taken + 1)

    if (options.dryRun) {
      enqueued++
      continue
    }
    if (await enqueueCompanyEnrichment({ ...candidate, reason: 'backfill' })) enqueued++
  }

  const summary: EnrichmentSweepSummary = {
    candidates: candidates.length,
    enqueued,
    deferred,
    organizations: takenByOrg.size,
  }
  logger.info('Company enrichment sweep finished', { ...summary, dryRun: options.dryRun ?? false })
  return summary
}
