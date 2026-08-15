// packages/lib/src/jobs/dedup/duplicate-scan-job.ts
//
// ONE job, three scopes. Every door into duplicate detection — the interactive
// mutation seam, the sync-change manifest consumer, and the 6h sweep — enqueues
// THIS handler; only the job data differs. The handler itself is always
// watermark-driven, so a coalesced burst and a scheduled backfill run exactly
// the same code against exactly the same dirty predicate.

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getCachedResourceFields } from '../../cache'
import { blockIdentity, blockOrgKey, blockRecord } from '../../dedup/blocking'
import { DEDUP_V1_ALLOWLIST, getDedupConfig } from '../../dedup/config'
import { deriveMatchKeys, type MatchKey } from '../../dedup/match-keys'
import { rescoreOpenPairsForRecord, upsertPairs } from '../../dedup/pairs'
import type { ScoredPair } from '../../dedup/scoring'
import { scoreBlockGroup, scoreIdentityGroup, scoreRecordMatches } from '../../dedup/scoring'
import type { DedupConfig } from '../../dedup/types'
import { FeaturePermissionService } from '../../permissions/feature-permission-service'
import { FeatureKey } from '../../permissions/types'
import type { JobContext } from '../types'

const logger = createScopedLogger('job:duplicate-scan')

/** Max dirty records processed per (org × definition) per tick. */
const RECORDS_PER_DEFINITION = 500

/**
 * Dirty-set size above which the org-level passes (`blockOrgKey`,
 * `blockIdentity`) are cheaper than N per-record lookups and run alongside them.
 */
const ORG_PASS_DIRTY_THRESHOLD = 50

/**
 * Scope of one scan, resolved from the job data — there is no `mode` field,
 * because the three doors differ only in what they know:
 *
 *  - `recordIds` present → scan exactly those records (the sync-manifest door;
 *    the ids carry their definition, so no watermark query is needed to FIND
 *    them — though their watermark is still stamped);
 *  - `organizationId` + `entityDefinitionId` → the watermark query for that
 *    definition's dirty records (the coalesced mutation-seam door);
 *  - neither → walk feature-enabled orgs × allowlisted definitions (the 6h
 *    sweep; also the only path that runs the org-level passes unconditionally).
 */
export interface DuplicateScanJobData {
  organizationId?: string
  entityDefinitionId?: string
  /** `RecordId`s (`entityDefinitionId:instanceId`), from a sync-change manifest. */
  recordIds?: string[]
  /** Block, score and log — write no pairs and bump no watermark. */
  dryRun?: boolean
}

export interface DuplicateScanJobStats {
  /** (org × definition) pairs actually scanned. */
  definitions: number
  /** Records blocked + scored. */
  scanned: number
  /** Pairs inserted or refreshed. */
  upserted: number
  /** Stale `open` pairs deleted by the rescore arm. */
  closed: number
  elapsedMs: number
}

/** One (org, definition) the scan can run against. */
interface ScanTarget {
  organizationId: string
  entityDefinitionId: string
  /** `EntityDefinition.entityType` — `null` for org-created definitions (never scanned in v1). */
  entityType: string | null
}

/**
 * Duplicate scan — block, score and store `DuplicateSuggestion` pairs for every
 * dirty record in scope.
 *
 * Per record: `deriveMatchKeys` → `blockRecord` → `scoreRecordMatches` →
 * `upsertPairs` → `rescoreOpenPairsForRecord` → stamp `lastDuplicateScanAt`.
 * The rescore step is not optional: without it the store is upsert-only and a
 * corrected email leaves its duplicate suggestion standing forever.
 *
 * Never throws — a scan failure must not fail whatever enqueued it. Per-record
 * failures are logged and skipped so one garbage row cannot take down the tick.
 */
export async function duplicateScanJob(
  ctx: JobContext<DuplicateScanJobData>
): Promise<DuplicateScanJobStats> {
  const data = ctx.job?.data ?? ({} as DuplicateScanJobData)
  const { organizationId, entityDefinitionId, recordIds, dryRun = false } = data
  const startedAt = Date.now()

  const stats = { definitions: 0, scanned: 0, upserted: 0, closed: 0 }
  const featureCache = new Map<string, boolean>()

  logger.info('Starting duplicate scan', {
    organizationId,
    entityDefinitionId,
    recordCount: recordIds?.length,
    dryRun,
    jobId: ctx.job?.id,
  })

  try {
    if (recordIds && recordIds.length > 0) {
      // ── Manifest scope ────────────────────────────────────────────────────
      if (!organizationId) {
        logger.warn('duplicateScanJob received recordIds with no organizationId — bailing')
        return { ...stats, elapsedMs: Date.now() - startedAt }
      }
      if (!(await isEnabled(organizationId, featureCache))) {
        return { ...stats, elapsedMs: Date.now() - startedAt }
      }

      for (const [defId, instanceIds] of groupByDefinition(recordIds)) {
        const target = await loadTarget(organizationId, defId)
        if (!target) continue
        accumulate(stats, await scanDefinition({ target, instanceIds, dryRun }))
      }
    } else if (organizationId && entityDefinitionId) {
      // ── Coalesced mutation-seam scope ─────────────────────────────────────
      if (!(await isEnabled(organizationId, featureCache))) {
        return { ...stats, elapsedMs: Date.now() - startedAt }
      }
      const target = await loadTarget(organizationId, entityDefinitionId)
      if (target) accumulate(stats, await scanDefinition({ target, dryRun }))
    } else {
      // ── Scheduled sweep ───────────────────────────────────────────────────
      for (const target of await listSweepTargets(organizationId)) {
        if (!(await isEnabled(target.organizationId, featureCache))) continue
        accumulate(stats, await scanDefinition({ target, dryRun, forceOrgPasses: true }))
      }
    }
  } catch (error) {
    logger.error('Duplicate scan failed', {
      organizationId,
      entityDefinitionId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const result = { ...stats, elapsedMs: Date.now() - startedAt }
  logger.info('Duplicate scan finished', result)
  return result
}

// ═══════════════════════════════════════════════════════════════════════════
// SCOPE RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Feature check, memoized per tick. `hasAccess` is org-cache-backed, but the
 * sweep asks the same question once per definition and an org commonly has both
 * `contact` and `company`.
 */
async function isEnabled(organizationId: string, cache: Map<string, boolean>): Promise<boolean> {
  const cached = cache.get(organizationId)
  if (cached !== undefined) return cached
  const features = new FeaturePermissionService()
  const enabled = await features.hasAccess(organizationId, FeatureKey.duplicateDetection)
  cache.set(organizationId, enabled)
  return enabled
}

/** Group manifest `RecordId`s by their definition — one scan pass per definition. */
function groupByDefinition(recordIds: string[]): Map<string, string[]> {
  const byDef = new Map<string, string[]>()
  for (const raw of recordIds) {
    const { entityDefinitionId, entityInstanceId } = parseRecordId(raw as RecordId)
    if (!entityDefinitionId || !entityInstanceId) continue
    const bucket = byDef.get(entityDefinitionId)
    if (bucket) bucket.push(entityInstanceId)
    else byDef.set(entityDefinitionId, [entityInstanceId])
  }
  return byDef
}

async function loadTarget(
  organizationId: string,
  entityDefinitionId: string
): Promise<ScanTarget | null> {
  const [row] = await database
    .select({ entityType: schema.EntityDefinition.entityType })
    .from(schema.EntityDefinition)
    .where(
      and(
        eq(schema.EntityDefinition.id, entityDefinitionId),
        eq(schema.EntityDefinition.organizationId, organizationId),
        isNull(schema.EntityDefinition.archivedAt)
      )
    )
    .limit(1)

  if (!row) return null
  return { organizationId, entityDefinitionId, entityType: row.entityType }
}

/**
 * Every (org, definition) the sweep walks: live definitions whose `entityType`
 * is on the v1 allowlist, in orgs that are not disabled. Feature filtering
 * happens per org in the caller (the `filterByTodayInboxFlag` pattern) so the
 * memo can be shared with the other two scopes.
 */
async function listSweepTargets(onlyOrganizationId?: string): Promise<ScanTarget[]> {
  const conditions = [
    inArray(schema.EntityDefinition.entityType, [...DEDUP_V1_ALLOWLIST]),
    isNull(schema.EntityDefinition.archivedAt),
    isNull(schema.Organization.disabledAt),
  ]
  if (onlyOrganizationId) {
    conditions.push(eq(schema.EntityDefinition.organizationId, onlyOrganizationId))
  }

  return database
    .select({
      organizationId: schema.EntityDefinition.organizationId,
      entityDefinitionId: schema.EntityDefinition.id,
      entityType: schema.EntityDefinition.entityType,
    })
    .from(schema.EntityDefinition)
    .innerJoin(
      schema.Organization,
      eq(schema.Organization.id, schema.EntityDefinition.organizationId)
    )
    .where(and(...conditions))
}

// ═══════════════════════════════════════════════════════════════════════════
// THE SCAN
// ═══════════════════════════════════════════════════════════════════════════

interface ScanCounts {
  definitions: number
  scanned: number
  upserted: number
  closed: number
}

const NO_WORK: ScanCounts = { definitions: 0, scanned: 0, upserted: 0, closed: 0 }

function accumulate(into: ScanCounts, from: ScanCounts): void {
  into.definitions += from.definitions
  into.scanned += from.scanned
  into.upserted += from.upserted
  into.closed += from.closed
}

/** One record the scan will process, with the watermark it will be stamped with. */
interface DirtyRecord {
  id: string
  /**
   * `GREATEST(ei."updatedAt", max(fv."updatedAt"))` as it was OBSERVED — bound
   * as text, never as a `Date`, so nothing re-interprets a `timestamp without
   * time zone` in the session timezone on the way back in.
   *
   * Stamping the OBSERVED watermark rather than `now()` is what closes the
   * scan-window race: a write that lands while this record is being blocked
   * leaves a `FieldValue.updatedAt` newer than the stamp, so the record stays
   * dirty and the next tick picks it up.
   */
  dirtyAt: string
}

async function scanDefinition(args: {
  target: ScanTarget
  /** Explicit records (manifest door). Omitted → the watermark query decides. */
  instanceIds?: string[]
  dryRun: boolean
  /** Scheduled sweep: run the org-level passes regardless of dirty-set size. */
  forceOrgPasses?: boolean
}): Promise<ScanCounts> {
  const { target, instanceIds, dryRun, forceOrgPasses = false } = args
  const { organizationId, entityDefinitionId } = target

  const config = getDedupConfig(target.entityType)
  if (!config) return NO_WORK

  const fields = await getCachedResourceFields(organizationId, entityDefinitionId)
  const keys = deriveMatchKeys(fields, config)
  if (keys.length === 0) {
    logger.debug('No strong match keys for definition — skipping', {
      organizationId,
      entityDefinitionId,
      entityType: target.entityType,
    })
    return NO_WORK
  }

  const dirty = instanceIds
    ? await selectLiveRecords(organizationId, entityDefinitionId, instanceIds)
    : await selectDirtyRecords(organizationId, entityDefinitionId, RECORDS_PER_DEFINITION)

  const counts: ScanCounts = { definitions: 1, scanned: 0, upserted: 0, closed: 0 }

  for (const record of dirty) {
    try {
      accumulate(
        counts,
        await scanRecord({ organizationId, entityDefinitionId, config, keys, record, dryRun })
      )
    } catch (error) {
      logger.error('Record scan threw', {
        organizationId,
        entityDefinitionId,
        instanceId: record.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Org-level passes find pairs where NEITHER side is dirty (a backfill), and
  // once a definition's dirty set is large they are cheaper than N per-record
  // lookups. They only UPSERT — rescoring stays a per-record responsibility,
  // because only the scanned record has a complete fresh pair set.
  if (!dryRun && (forceOrgPasses || dirty.length >= ORG_PASS_DIRTY_THRESHOLD)) {
    accumulate(counts, await runOrgPasses({ organizationId, entityDefinitionId, config, keys }))
  }

  return counts
}

async function scanRecord(args: {
  organizationId: string
  entityDefinitionId: string
  config: DedupConfig
  keys: MatchKey[]
  record: DirtyRecord
  dryRun: boolean
}): Promise<ScanCounts> {
  const { organizationId, entityDefinitionId, config, keys, record, dryRun } = args
  const db = database

  const matches = await blockRecord(db, {
    organizationId,
    entityDefinitionId,
    instanceId: record.id,
    keys,
    blockCap: config.blockCap,
  })
  if (matches.isErr()) {
    logger.warn('Blocking failed for record', {
      organizationId,
      entityDefinitionId,
      instanceId: record.id,
      error: matches.error.message,
    })
    return NO_WORK
  }

  const scored = scoreRecordMatches({
    organizationId,
    entityDefinitionId,
    instanceId: record.id,
    matches: matches.value,
  })

  if (dryRun) {
    logger.info('dry run — pairs not written', {
      organizationId,
      entityDefinitionId,
      instanceId: record.id,
      pairs: scored.length,
    })
    return { definitions: 0, scanned: 1, upserted: 0, closed: 0 }
  }

  const upserted = await upsertPairs(db, scored)
  if (upserted.isErr()) {
    logger.warn('Pair upsert failed', {
      organizationId,
      entityDefinitionId,
      instanceId: record.id,
      error: upserted.error.message,
    })
  }

  const closed = await rescoreOpenPairsForRecord(db, {
    organizationId,
    entityDefinitionId,
    instanceId: record.id,
    pairs: scored,
  })

  await stampWatermark(organizationId, record)

  return {
    definitions: 0,
    scanned: 1,
    upserted: upserted.isOk() ? upserted.value : 0,
    closed: closed.isOk() ? closed.value : 0,
  }
}

async function runOrgPasses(args: {
  organizationId: string
  entityDefinitionId: string
  config: DedupConfig
  keys: MatchKey[]
}): Promise<ScanCounts> {
  const { organizationId, entityDefinitionId, config, keys } = args
  const db = database
  const pairs: ScoredPair[] = []

  for (const key of keys) {
    const groups = await blockOrgKey(db, {
      organizationId,
      entityDefinitionId,
      key,
      blockCap: config.blockCap,
    })
    if (groups.isErr()) continue
    for (const group of groups.value) {
      pairs.push(...scoreBlockGroup({ organizationId, entityDefinitionId, group }))
    }
  }

  const identities = await blockIdentity(db, {
    organizationId,
    entityDefinitionId,
    blockCap: config.blockCap,
  })
  if (identities.isOk()) {
    for (const group of identities.value) {
      pairs.push(...scoreIdentityGroup({ organizationId, entityDefinitionId, group }))
    }
  }

  if (pairs.length === 0) return NO_WORK
  const written = await upsertPairs(db, pairs)
  return {
    definitions: 0,
    scanned: 0,
    upserted: written.isOk() ? written.value : 0,
    closed: 0,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// THE WATERMARK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `GREATEST(ei."updatedAt", max(fv."updatedAt"))` — the only dirty predicate
 * that survives a `skipEvents` writer.
 *
 * A connector sync or CSV import leaves BOTH `EntityInstance.updatedAt` and
 * `lastActivityAt` untouched (`touchEntityActivity` never runs, and the
 * post-hook gate needs a `userId`), so `FieldValue.updatedAt` is the only
 * timestamp that always moves. The lateral is a per-row aggregate rather than a
 * join+GROUP BY so the outer row can be filtered and ordered without collapsing.
 */
const DIRTY_AT = sql`GREATEST(ei."updatedAt", COALESCE(fv."maxAt", ei."updatedAt"))`

const FIELD_VALUE_LATERAL = sql`
  LEFT JOIN LATERAL (
    SELECT max(v."updatedAt") AS "maxAt"
    FROM "FieldValue" v
    WHERE v."entityId" = ei."id" AND v."organizationId" = ei."organizationId"
  ) fv ON TRUE
`

/**
 * The dirty records of one definition, oldest-dirty first.
 *
 * ⚠️ `archivedAt IS NULL` is NOT optional. `EntityInstance_org_def_dup_scan_idx`
 * is a PARTIAL index (`WHERE "archivedAt" IS NULL`); without the matching
 * predicate the planner cannot use it and this degrades to a full scan of the
 * org's records. It is also correct on its own terms — an archived record is
 * never a duplicate subject, and `blockRecord` already refuses to return one as
 * a candidate.
 */
async function selectDirtyRecords(
  organizationId: string,
  entityDefinitionId: string,
  limit: number
): Promise<DirtyRecord[]> {
  const result = await database.execute(sql`
    SELECT ei."id" AS "id", ${DIRTY_AT}::text AS "dirtyAt"
    FROM "EntityInstance" ei
    ${FIELD_VALUE_LATERAL}
    WHERE ei."organizationId" = ${organizationId}
      AND ei."entityDefinitionId" = ${entityDefinitionId}
      AND ei."archivedAt" IS NULL
      AND (ei."lastDuplicateScanAt" IS NULL OR ${DIRTY_AT} > ei."lastDuplicateScanAt")
    ORDER BY ${DIRTY_AT} ASC
    LIMIT ${limit}
  `)
  return toDirtyRecords(result)
}

/**
 * The same projection for an EXPLICIT id set (the manifest door): the ids are
 * already known to be freshly written, so there is no watermark predicate — only
 * the org/definition/archived guards, which stop a manifest from steering the
 * scan at another org's rows.
 */
async function selectLiveRecords(
  organizationId: string,
  entityDefinitionId: string,
  instanceIds: string[]
): Promise<DirtyRecord[]> {
  if (instanceIds.length === 0) return []
  const ids = [...new Set(instanceIds)].slice(0, RECORDS_PER_DEFINITION)
  // One bind per id rather than an array parameter: `= ANY($1::text[])` depends
  // on the driver serialising a JS array into a Postgres array literal, which
  // Drizzle's `sql` template does not promise for an interpolated value.
  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  )

  const result = await database.execute(sql`
    SELECT ei."id" AS "id", ${DIRTY_AT}::text AS "dirtyAt"
    FROM "EntityInstance" ei
    ${FIELD_VALUE_LATERAL}
    WHERE ei."organizationId" = ${organizationId}
      AND ei."entityDefinitionId" = ${entityDefinitionId}
      AND ei."archivedAt" IS NULL
      AND ei."id" IN (${idList})
  `)
  return toDirtyRecords(result)
}

function toDirtyRecords(result: unknown): DirtyRecord[] {
  const rows = ((result as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>
  return rows
    .filter((row) => row.id != null && row.dirtyAt != null)
    .map((row) => ({ id: String(row.id), dirtyAt: String(row.dirtyAt) }))
}

/**
 * Stamp `lastDuplicateScanAt` with the watermark this scan OBSERVED.
 *
 * ⚠️ Raw SQL on purpose. `EntityInstance.updatedAt` carries `$onUpdate`, so a
 * Drizzle `.update()` would bump `updatedAt` in the same statement — instantly
 * re-dirtying the record against its own fresh watermark and looping the scanner
 * forever. This statement touches exactly one column.
 */
async function stampWatermark(organizationId: string, record: DirtyRecord): Promise<void> {
  await database.execute(sql`
    UPDATE "EntityInstance"
    SET "lastDuplicateScanAt" = ${record.dirtyAt}::timestamp
    WHERE "id" = ${record.id} AND "organizationId" = ${organizationId}
  `)
}
