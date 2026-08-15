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
import { blockFuzzyRecord, blockSurnameRecord } from '../../dedup/blocking-fuzzy'
import { DEDUP_V1_ALLOWLIST, getDedupConfig } from '../../dedup/config'
import {
  type CorroborationFields,
  deriveCorroborationFields,
  evaluateFuzzyPair,
} from '../../dedup/corroborate'
import { enqueueDuplicateScanContinuation } from '../../dedup/enqueue-scan'
import { deriveMatchKeys, type MatchKey } from '../../dedup/match-keys'
import { normalizeSurname } from '../../dedup/name-match'
import { rescoreOpenPairsForRecord, upsertPairs } from '../../dedup/pairs'
import type { ScoredPair } from '../../dedup/scoring'
import {
  scoreBlockGroup,
  scoreIdentityGroup,
  scorePair,
  toCandidatePair,
} from '../../dedup/scoring'
import {
  type NameFieldIds,
  readStructuredNames,
  resolveNameFieldIds,
  type SurnameRarity,
  surnameIdf,
} from '../../dedup/surname-rarity'
import type { CandidatePair, DedupConfig, Signal } from '../../dedup/types'
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
 * Per record, BOTH arms (see `scanRecord`): the exact arm `deriveMatchKeys` →
 * `blockRecord`, and the Phase-2 arm `blockFuzzyRecord` + `blockSurnameRecord` →
 * `readStructuredNames` → `evaluateFuzzyPair`. Their pairs are merged onto the
 * canonical key, then `scorePair` → `upsertPairs` → `rescoreOpenPairsForRecord`
 * → stamp `lastDuplicateScanAt`. The rescore step is not optional: without it
 * the store is upsert-only and a corrected email leaves its duplicate suggestion
 * standing forever.
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
  /**
   * The record's own trigram anchors, projected here rather than re-read per
   * record inside `blockFuzzyRecord`: the fuzzy arm needs them for EVERY dirty
   * record, and they cost nothing extra on a query that is already reading the
   * row.
   */
  displayName: string | null
  secondaryDisplayValue: string | null
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

  // Resolved ONCE per definition, not per record: the name field ids and the
  // corroboration field split are stable for the whole scan, and surname rarity
  // is an aggregate over the definition that a per-pair call would repeat for
  // every neighbour of every record.
  const fuzzy = await buildFuzzyContext(target, config, fields)

  const counts: ScanCounts = { definitions: 1, scanned: 0, upserted: 0, closed: 0 }

  for (const record of dirty) {
    try {
      accumulate(
        counts,
        await scanRecord({
          organizationId,
          entityDefinitionId,
          config,
          keys,
          fuzzy,
          record,
          dryRun,
        })
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

  // The watermark query is oldest-dirty-first and capped, so in a definition
  // with more than RECORDS_PER_DEFINITION dirty records a freshly created record
  // sorts LAST and would wait for the next trigger or the 6h sweep. Requeue
  // ourselves instead: the next tick starts from the new watermark, so the
  // backlog drains in bounded chunks rather than stalling.
  if (!dryRun && !instanceIds && dirty.length >= RECORDS_PER_DEFINITION) {
    const cursor = dirty.at(-1)?.dirtyAt ?? ''
    await enqueueDuplicateScanContinuation(organizationId, entityDefinitionId, cursor).catch(
      (error: unknown) => {
        logger.warn('Failed to requeue a capped scan', {
          organizationId,
          entityDefinitionId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    )
  }

  return counts
}

/**
 * The per-definition state the Phase-2 (fuzzy / name) arm needs, or `null` when
 * this definition has no person-name shape.
 *
 * Companies resolve to `null` — `DedupConfig` carries no
 * `surnameSystemAttribute` for them — so they keep exactly the exact-key
 * behaviour they had. The structured comparator is about people; there is no
 * `firstName`/`lastName` on a company to compare.
 */
interface FuzzyContext {
  corroboration: CorroborationFields
  nameFields: NameFieldIds & { surnameFieldId: FieldIdString }
  /**
   * normalized surname → rarity, memoized for the whole definition scan.
   *
   * `surnameIdf` is an aggregate over the definition's surname values, and a
   * scan commonly walks several records sharing one surname. Resolving it per
   * pair would repeat that aggregate for every neighbour of every record.
   */
  rarityBySurname: Map<string, SurnameRarity>
}

/** `CustomField.id` as `surname-rarity` brands it. */
type FieldIdString = NonNullable<NameFieldIds['surnameFieldId']>

async function buildFuzzyContext(
  target: ScanTarget,
  config: DedupConfig,
  fields: Awaited<ReturnType<typeof getCachedResourceFields>>
): Promise<FuzzyContext | null> {
  if (!config.surnameSystemAttribute) return null

  const resolved = await resolveNameFieldIds(
    database,
    target.organizationId,
    target.entityDefinitionId,
    { givenName: config.givenNameSystemAttribute, surname: config.surnameSystemAttribute }
  )
  if (resolved.isErr()) {
    logger.warn('Could not resolve name fields — fuzzy arm disabled for this definition', {
      organizationId: target.organizationId,
      entityDefinitionId: target.entityDefinitionId,
      error: resolved.error.message,
    })
    return null
  }

  const surnameFieldId = resolved.value.surnameFieldId
  // No surname field ⇒ condition (a) of the name rule can never hold, so the
  // whole arm is dead weight for this definition.
  if (!surnameFieldId) return null

  return {
    corroboration: deriveCorroborationFields(fields),
    nameFields: { ...resolved.value, surnameFieldId },
    rarityBySurname: new Map(),
  }
}

/**
 * Block, score and store one record's pairs — **both arms**.
 *
 * ```text
 * exact:  deriveMatchKeys → blockRecord            → toCandidatePair ┐
 * fuzzy:  blockFuzzyRecord + blockSurnameRecord                     ├→ merge
 *         → readStructuredNames → evaluateFuzzyPair                 ┘
 *                    → scorePair → upsertPairs → rescoreOpenPairsForRecord
 * ```
 *
 * 🔴 **The two arms MERGE before scoring, and that is not cosmetic.**
 * `upsertPairs` dedupes by the conflict key and keeps the last writer, so a pair
 * found by both arms would be stored with whichever arm happened to be scored
 * last — a `high` exact pair silently rewritten as `medium`. Merging the signal
 * sets first also produces the richer "matched on:" chips a reviewer actually
 * wants: an email match AND a name match on one card, not one of the two.
 */
async function scanRecord(args: {
  organizationId: string
  entityDefinitionId: string
  config: DedupConfig
  keys: MatchKey[]
  fuzzy: FuzzyContext | null
  record: DirtyRecord
  dryRun: boolean
}): Promise<ScanCounts> {
  const { organizationId, entityDefinitionId, config, keys, fuzzy, record, dryRun } = args
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

  const exact = matches.value.flatMap((match) => {
    const pair = toCandidatePair({
      organizationId,
      entityDefinitionId,
      instanceId: record.id,
      match,
    })
    return pair ? [pair] : []
  })

  const fuzzyPairs = fuzzy
    ? await fuzzyPairsForRecord({ organizationId, entityDefinitionId, fuzzy, record })
    : []

  const scored = mergeCandidatePairs([...exact, ...fuzzyPairs]).flatMap((pair) => {
    const result = scorePair(pair)
    return result ? [result] : []
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

/** Stable identity for a signal, so the same evidence is never carried twice. */
const signalKey = (s: Signal) =>
  `${s.type}|${s.strength}|${s.fieldKey ?? ''}|${s.value}|${s.otherValue ?? ''}`

/**
 * Fold every candidate pair for one record onto its canonical key, unioning the
 * signal sets.
 *
 * Two arms can produce the same pair — two contacts who share a phone number
 * usually share a name too — and storage holds ONE row per canonical pair. See
 * the `scanRecord` docstring for why keeping the last writer instead would
 * silently downgrade a `high` pair.
 */
function mergeCandidatePairs(pairs: CandidatePair[]): CandidatePair[] {
  const byKey = new Map<string, CandidatePair>()
  for (const pair of pairs) {
    const key = `${pair.instanceIdLow}|${pair.instanceIdHigh}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { ...pair, signals: [...pair.signals] })
      continue
    }
    const seen = new Set(existing.signals.map(signalKey))
    for (const signal of pair.signals) {
      if (seen.has(signalKey(signal))) continue
      seen.add(signalKey(signal))
      existing.signals.push(signal)
    }
  }
  return [...byKey.values()]
}

/**
 * The Phase-2 arm for one record: name neighbours → structured comparison →
 * corroboration → the name-alone rule.
 *
 * 🔴 **This is the seam Phase 5 verification found missing.** The modules below
 * were merged, unit-tested and correct, and had ZERO production callers — so
 * every stored row was `band: 'high'` and the work-address / name-variant
 * duplicates the feature exists to catch were invisible. Nothing here
 * re-implements them; it calls them in the documented order.
 *
 * Two candidate sources, not one:
 *  - `blockFuzzyRecord` — trigram neighbours off the displayName index, which is
 *    what catches a MISSPELLED surname;
 *  - `blockSurnameRecord` — an exact match on the surname field, which is what
 *    catches a nickname behind a COMMON surname. The trigram pass truncates
 *    against 19 Smiths, so `Bob Smith` / `Robert Smith` is unreachable without
 *    it (measured), and corroboration cannot rescue a pair that was never
 *    generated.
 *
 * A record with no surname returns nothing: condition (a) of the name rule
 * cannot hold, and neither can the reversed-order fallback, since that compares
 * this record's `lastName` against the other's `firstName`.
 *
 * ⚠️ **One accepted asymmetry.** `rescoreOpenPairsForRecord` treats a record's
 * fresh set as a complete statement about every pair it belongs to, which is
 * exactly true for exact blocking (scanning A finds B iff scanning B finds A).
 * The name arm is symmetric on an exact surname match, but on a TYPO'd one the
 * two sides resolve rarity for different normalized surnames — `smiht` can be
 * rare where `smith` is common — so scanning one side may create a pair the
 * other side's scan then closes. It settles after both have been scanned (each
 * runs only while dirty, so there is no loop), and it fails toward dropping a
 * borderline pair rather than keeping one. Not worth a second rarity lookup per
 * pair to close.
 */
async function fuzzyPairsForRecord(args: {
  organizationId: string
  entityDefinitionId: string
  fuzzy: FuzzyContext
  record: DirtyRecord
}): Promise<CandidatePair[]> {
  const { organizationId, entityDefinitionId, fuzzy, record } = args
  const db = database

  const ownNames = await readStructuredNames(db, organizationId, [record.id], fuzzy.nameFields)
  if (ownNames.isErr()) return []
  const own = ownNames.value.get(record.id)
  if (!own?.lastName) return []

  const [neighbours, sameSurname] = await Promise.all([
    blockFuzzyRecord(db, {
      organizationId,
      entityDefinitionId,
      instanceId: record.id,
      anchors: {
        displayName: record.displayName,
        secondaryDisplayValue: record.secondaryDisplayValue,
        surname: own.lastName,
      },
    }),
    blockSurnameRecord(db, {
      organizationId,
      entityDefinitionId,
      instanceId: record.id,
      surnameFieldId: fuzzy.nameFields.surnameFieldId,
      surname: own.lastName,
    }),
  ])

  const candidateIds = [
    ...new Set([
      ...(neighbours.isOk() ? neighbours.value : []).map((c) => c.instanceId),
      ...(sameSurname.isOk() ? sameSurname.value : []).map((c) => c.instanceId),
    ]),
  ].filter((id) => id !== record.id)
  if (candidateIds.length === 0) return []

  // One query for the whole candidate set, not one per candidate.
  const names = await readStructuredNames(db, organizationId, candidateIds, fuzzy.nameFields)
  if (names.isErr()) return []

  const rarity = await resolveSurnameRarity(fuzzy, organizationId, entityDefinitionId, own.lastName)

  const pairs: CandidatePair[] = []
  for (const otherId of candidateIds) {
    const other = names.value.get(otherId)
    if (!other) continue

    // Canonical order is a STORAGE invariant, so the pair is oriented here and
    // `evaluateFuzzyPair` is handed the two names already on that axis — the
    // signals it returns need no re-orientation downstream.
    const swap = record.id > otherId
    const instanceIdLow = swap ? otherId : record.id
    const instanceIdHigh = swap ? record.id : otherId

    const signals = await evaluateFuzzyPair(db, {
      organizationId,
      entityDefinitionId,
      instanceIdLow,
      instanceIdHigh,
      fields: fuzzy.corroboration,
      nameLow: swap ? other : own,
      nameHigh: swap ? own : other,
      surnameFieldId: fuzzy.nameFields.surnameFieldId,
      surnameRarity: rarity,
    })
    if (signals.isErr()) {
      logger.warn('Fuzzy pair evaluation failed', {
        organizationId,
        entityDefinitionId,
        instanceIdLow,
        instanceIdHigh,
        error: signals.error.message,
      })
      continue
    }
    if (signals.value.length === 0) continue

    pairs.push({
      organizationId,
      entityDefinitionId,
      instanceIdLow,
      instanceIdHigh,
      signals: signals.value,
    })
  }

  return pairs
}

/**
 * Surname rarity for the SCANNED record, memoized per definition scan.
 *
 * Keyed on the scanned record's surname rather than the pair's because
 * condition (a) already requires the two surnames to be equal or within a typo
 * of each other — and because a scan walks many records that share one surname,
 * which is exactly the case a per-pair aggregate would pay for repeatedly.
 */
async function resolveSurnameRarity(
  fuzzy: FuzzyContext,
  organizationId: string,
  entityDefinitionId: string,
  surname: string
): Promise<SurnameRarity | undefined> {
  const key = normalizeSurname(surname)
  if (!key) return undefined

  const cached = fuzzy.rarityBySurname.get(key)
  if (cached) return cached

  const computed = await surnameIdf(database, organizationId, entityDefinitionId, surname, {
    surnameFieldId: fuzzy.nameFields.surnameFieldId,
  })
  // Undefined, not a fabricated `rare: false`: `evaluateFuzzyPair` resolves its
  // own rarity when none is supplied, so a transient failure here degrades to an
  // extra query rather than to a silently suppressed suggestion.
  if (computed.isErr()) return undefined

  fuzzy.rarityBySurname.set(key, computed.value)
  return computed.value
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
    SELECT ei."id" AS "id", ${DIRTY_AT}::text AS "dirtyAt",
           ei."displayName" AS "displayName",
           ei."secondaryDisplayValue" AS "secondaryDisplayValue"
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
    SELECT ei."id" AS "id", ${DIRTY_AT}::text AS "dirtyAt",
           ei."displayName" AS "displayName",
           ei."secondaryDisplayValue" AS "secondaryDisplayValue"
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
    .map((row) => ({
      id: String(row.id),
      dirtyAt: String(row.dirtyAt),
      displayName: row.displayName == null ? null : String(row.displayName),
      secondaryDisplayValue:
        row.secondaryDisplayValue == null ? null : String(row.secondaryDisplayValue),
    }))
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
