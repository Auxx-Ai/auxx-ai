// packages/lib/src/events/handlers/handle-sync-record-rules.ts
// Dispatch door 3 (B2): the sync-change manifest consumer. On `sync:records:changed`
// it resolves the persisted manifest, transition-matches each captured field write
// against the org's enabled rules, and fires the engine with `source: 'sync'` — giving
// record rules visibility into bulk writes the connector sink / import job suppressed
// via `skipEvents`. Lifecycle (`created`/`deleted`) firings dispatch here too. After
// the rules fire, the Phase 4 sync finalize pass (`./sync-finalize.ts`) runs on the
// same once-only claim — see that module for the doors it executes.
//
// Keep top-level imports to types/logger only; lazy-import everything else (the
// record-rules ↔ data-connectors ↔ cache boundaries break vi.mock otherwise).

import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import type { RecordSnapshot } from '../../record-rules/resolver'
import type { SyncChangeManifest } from '../../record-rules/sync-manifest-types'
import type { CachedRecordRule } from '../../record-rules/types'
import type { AuxxEvent, SyncRecordsChangedEvent } from '../types'

const logger = createScopedLogger('record-rules-sync')

/** Resolve the manifest a pointer event refers to (connector run row / import job row). */
async function resolveManifest(
  data: SyncRecordsChangedEvent['data']
): Promise<SyncChangeManifest | null> {
  const { database } = await import('@auxx/database')
  if (data.source === 'connector') {
    if (!data.runId) return null
    const { getRunManifest } = await import('../../data-connectors/service')
    return getRunManifest(database, data.runId)
  }
  if (!data.importRef) return null
  const { getImportManifest } = await import('../../import')
  return getImportManifest(database, data.importRef)
}

/**
 * Atomically claim the manifest for once-only consumption (F3). Rule actions carry no
 * idempotency of their own, and BOTH delivery legs can duplicate: a re-entered
 * connector finalize re-publishes the pointer event, and BullMQ can redeliver the
 * handler job. Exactly one claimant proceeds; everyone else no-ops.
 */
async function claimManifest(data: SyncRecordsChangedEvent['data']): Promise<boolean> {
  const { database } = await import('@auxx/database')
  if (data.source === 'connector') {
    if (!data.runId) return false
    const { claimRunManifestConsumed } = await import('../../data-connectors/service')
    return claimRunManifestConsumed(database, data.runId)
  }
  if (!data.importRef) return false
  const { claimImportManifestConsumed } = await import('../../import')
  return claimImportManifestConsumed(database, data.importRef)
}

export const handleSyncRecordRules = async ({ data: event }: { data: AuxxEvent }) => {
  if (event.type !== 'sync:records:changed') return
  const data = event.data
  const { organizationId } = data

  try {
    const manifest = await resolveManifest(data)
    if (!manifest) {
      logger.warn('sync:records:changed with no resolvable manifest — bailing', {
        source: data.source,
        runId: data.runId,
        importRef: data.importRef,
      })
      return
    }
    if (manifest.truncated) {
      logger.warn('sync-change manifest truncated — some changes will not fire rules', {
        organizationId,
        changed: Object.keys(manifest.changes).length,
        created: manifest.createdRecordIds.length,
        archived: manifest.archivedRecordIds.length,
      })
    }

    // Claim AFTER the manifest bail-out, BEFORE any firing. At-most-once by design: a
    // crash mid-fire loses the remainder rather than double-notifying on retry. The
    // claim now sits BEFORE the zero-rules check — the Phase 4 finalize pass below
    // rides the same latch and must run exactly once per run even when every rule was
    // disabled between write and consume.
    if (!(await claimManifest(data))) {
      logger.info('sync-change manifest already consumed — skipping duplicate delivery', {
        organizationId,
        source: data.source,
        runId: data.runId,
        importRef: data.importRef,
      })
      return
    }

    const { getCachedRecordRules } = await import('../../cache')
    const rules = (await getCachedRecordRules(organizationId)).filter((r) => r.enabled)
    if (rules.length > 0) {
      // Index rules per def for the three firing kinds.
      const fieldRulesByDef = new Map<string, CachedRecordRule[]>()
      const createdRulesByDef = new Map<string, CachedRecordRule[]>()
      const deletedRulesByDef = new Map<string, CachedRecordRule[]>()
      for (const rule of rules) {
        if (rule.fieldId !== null) {
          push(fieldRulesByDef, rule.entityDefinitionId, rule)
        } else if (rule.on === 'created') {
          push(createdRulesByDef, rule.entityDefinitionId, rule)
        } else if (rule.on === 'deleted') {
          push(deletedRulesByDef, rule.entityDefinitionId, rule)
        }
      }

      let fired = 0
      fired += await fireFieldChanges(organizationId, manifest, fieldRulesByDef)
      fired += await fireLifecycle(
        organizationId,
        manifest.createdRecordIds,
        createdRulesByDef,
        false,
        manifest.createdValues
      )
      fired += await fireLifecycle(
        organizationId,
        manifest.archivedRecordIds,
        deletedRulesByDef,
        true
      )

      logger.info('sync:records:changed processed', {
        organizationId,
        source: data.source,
        runId: data.runId,
        fired,
      })
    }

    // Phase 4 (plan events/03 §8, D-12): the sync finalize pass — activity bump,
    // collapsed timeline, lane-gated dispatch, tier-2 frames. INSIDE the claimed
    // branch, AFTER rules fire; `runSyncFinalize` catches its own errors (rules
    // already fired — a finalize crash must not re-throw into a retry that can
    // never re-claim).
    const { runSyncFinalize } = await import('./sync-finalize')
    const { database } = await import('@auxx/database')
    await runSyncFinalize(database, {
      organizationId,
      source: data.source,
      ref: (data.source === 'connector' ? data.runId : data.importRef) as string,
      dataConnectorId: data.dataConnectorId,
      manifest,
    })
  } catch (error) {
    logger.error('Sync record-rule dispatch failed', {
      organizationId,
      runId: data.runId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const arr = map.get(key)
  if (arr) arr.push(value)
  else map.set(key, [value])
}

/**
 * Field-transition firings. Per record → per rule on the changed field: match the
 * transition, then choose a snapshot (partial from the manifest when the rule's
 * condition refs all resolve within the record's changed keys, else a bulk fetch).
 * Events are grouped per def and handed to `fireRecordRulesBatch` so native system-rule
 * actions get one batched invocation across the run (D11); non-native rules run per
 * record exactly as before.
 */
async function fireFieldChanges(
  organizationId: string,
  manifest: SyncChangeManifest,
  fieldRulesByDef: Map<string, CachedRecordRule[]>
): Promise<number> {
  const recordIds = Object.keys(manifest.changes) as RecordId[]
  if (recordIds.length === 0 || fieldRulesByDef.size === 0) return 0

  const { getCachedResourceFields } = await import('../../cache')
  const { buildFieldKeyMap } = await import('../../record-rules/resolver')
  const { collectConditionFieldIds } = await import('../../conditions/collect-field-ids')
  const { matchesFieldTransition } = await import('../../record-rules/transitions')
  const { fireRecordRulesBatch } = await import('../../record-rules/engine')

  // Per-def field key maps (ref → outputKey), loaded once.
  const keyMaps = new Map<string, Map<string, string>>()
  const keyMapFor = async (defId: string) => {
    let m = keyMaps.get(defId)
    if (!m) {
      m = buildFieldKeyMap(await getCachedResourceFields(organizationId, defId))
      keyMaps.set(defId, m)
    }
    return m
  }

  // One event plan per (def, instance, fieldRowId). Multiple rules on the same field
  // union their snapshot needs — a full snapshot (superset) also satisfies partial rules.
  type EventPlan = {
    recordId: RecordId
    entityInstanceId: string
    fieldId: string
    o: unknown
    n: unknown
    changeBucket: SyncChangeManifest['changes'][RecordId]
    needsSnapshot: boolean
    needsFull: boolean
  }
  const plansByDef = new Map<string, Map<string, EventPlan>>()
  const fullFetchIds = new Set<RecordId>()

  for (const recordId of recordIds) {
    const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
    const rulesForDef = fieldRulesByDef.get(entityDefinitionId)
    if (!rulesForDef) continue
    const changeBucket = manifest.changes[recordId]
    if (!changeBucket) continue
    const changedKeys = new Set(Object.keys(changeBucket))
    const keyMap = await keyMapFor(entityDefinitionId)

    for (const rule of rulesForDef) {
      const fieldId = rule.fieldId as string
      const outputKey = keyMap.get(fieldId) ?? fieldId
      const entry = changeBucket[outputKey]
      if (!entry) continue
      if (!matchesFieldTransition(rule.on, entry.o, entry.n)) continue

      const ruleNeedsSnapshot =
        rule.condition.length > 0 || rule.actions.some((a) => a.type === 'enqueue-workflow')
      let ruleNeedsFull = false
      if (ruleNeedsSnapshot) {
        const refs = collectConditionFieldIds(rule.condition)
        const hasWorkflow = rule.actions.some((a) => a.type === 'enqueue-workflow')
        const allResolvable =
          !hasWorkflow &&
          !refs.hasRelationshipPath &&
          refs.fieldRefs.every((ref) => changedKeys.has(keyMap.get(ref) ?? ref))
        ruleNeedsFull = !allResolvable
      }

      let plans = plansByDef.get(entityDefinitionId)
      if (!plans) {
        plans = new Map()
        plansByDef.set(entityDefinitionId, plans)
      }
      const planKey = `${entityInstanceId}|${fieldId}`
      let plan = plans.get(planKey)
      if (!plan) {
        plan = {
          recordId,
          entityInstanceId,
          fieldId,
          o: entry.o,
          n: entry.n,
          changeBucket,
          needsSnapshot: false,
          needsFull: false,
        }
        plans.set(planKey, plan)
      }
      plan.needsSnapshot = plan.needsSnapshot || ruleNeedsSnapshot
      plan.needsFull = plan.needsFull || ruleNeedsFull
      if (ruleNeedsFull) fullFetchIds.add(recordId)
    }
  }

  if (plansByDef.size === 0) return 0

  // ONE bulk fetch across all defs for every record that needs a full snapshot.
  let fullSnapshots = new Map<RecordId, RecordSnapshot>()
  if (fullFetchIds.size > 0) {
    const { fetchResourceSnapshots } = await import('../../record-rules/snapshot-fetcher')
    const { database } = await import('@auxx/database')
    fullSnapshots = await fetchResourceSnapshots(database, organizationId, [...fullFetchIds])
  }

  let fired = 0
  for (const [entityDefinitionId, plans] of plansByDef) {
    const events = [...plans.values()].map((plan) => {
      let snapshot: RecordSnapshot | null | undefined
      if (plan.needsFull) {
        snapshot = fullSnapshots.get(plan.recordId) ?? null
      } else if (plan.needsSnapshot) {
        const fieldValues: Record<string, unknown> = {}
        for (const [key, e] of Object.entries(plan.changeBucket)) fieldValues[key] = e.n
        snapshot = { id: plan.entityInstanceId, entityDefinitionId, fieldValues }
      } else {
        snapshot = undefined
      }
      return {
        entityInstanceId: plan.entityInstanceId,
        fieldId: plan.fieldId,
        oldValue: plan.o,
        newValue: plan.n,
        snapshot,
      }
    })

    await fireRecordRulesBatch(fieldRulesByDef.get(entityDefinitionId)!, {
      organizationId,
      entityDefinitionId,
      source: 'sync',
      events,
    })
    fired += events.length
  }
  return fired
}

/**
 * Lifecycle firings for created/archived record ids. `archived` (deleted rules) MUST
 * provide a snapshot (the record is soft-archived — the engine can't refetch it via the
 * live path), so those always bulk-fetch. Created rules with conditions/workflows also
 * prefetch; conditionless created rules fire with no snapshot.
 */
async function fireLifecycle(
  organizationId: string,
  recordIds: RecordId[],
  rulesByDef: Map<string, CachedRecordRule[]>,
  archived: boolean,
  valuesByRecordId?: SyncChangeManifest['createdValues']
): Promise<number> {
  if (recordIds.length === 0 || rulesByDef.size === 0) return 0

  const { fireRecordRulesBatch } = await import('../../record-rules/engine')

  // Which defs actually have rules for the ids present? Group ids by def.
  const idsByDef = new Map<string, RecordId[]>()
  for (const rid of recordIds) {
    const { entityDefinitionId } = parseRecordId(rid)
    if (rulesByDef.has(entityDefinitionId)) push(idsByDef, entityDefinitionId, rid)
  }
  if (idsByDef.size === 0) return 0

  // Prefetch snapshots when needed: always for archived; for created only when a rule
  // has conditions or an enqueue-workflow action.
  const needsSnapshot = (rules: CachedRecordRule[]) =>
    archived ||
    rules.some(
      (r) => r.condition.length > 0 || r.actions.some((a) => a.type === 'enqueue-workflow')
    )

  const fetchIds: RecordId[] = []
  for (const [defId, ids] of idsByDef) {
    if (needsSnapshot(rulesByDef.get(defId)!)) fetchIds.push(...ids)
  }
  let snapshots = new Map<RecordId, RecordSnapshot>()
  if (fetchIds.length > 0) {
    const { fetchResourceSnapshots } = await import('../../record-rules/snapshot-fetcher')
    const { database } = await import('@auxx/database')
    snapshots = await fetchResourceSnapshots(database, organizationId, fetchIds)
  }

  let fired = 0
  for (const [defId, ids] of idsByDef) {
    const rules = rulesByDef.get(defId)!
    const snap = needsSnapshot(rules)
    // Archived: a missing snapshot means the row is truly gone — still fire so the rule
    // can run its unconditioned actions with a null snapshot (engine handles it).
    const events = ids.map((rid) => ({
      entityInstanceId: parseRecordId(rid).entityInstanceId,
      snapshot: snap ? (snapshots.get(rid) ?? null) : undefined,
      // Raw created values for native entity-trigger handlers (created firings only).
      eventData: valuesByRecordId?.[rid],
    }))
    await fireRecordRulesBatch(rules, {
      organizationId,
      entityDefinitionId: defId,
      source: 'sync',
      events,
    })
    fired += ids.length
  }
  return fired
}
