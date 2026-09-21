// packages/lib/src/field-hooks/dispatch.ts

// plans/events/10-replay-hooks-from-the-committed-scope.md §4.2: the one place a lane
// replays the registered hook chain. What a handler may do on a lane falls out of its
// KIND, not a flag — see `types.ts` and the table in §4.1.
//
// `../cache` and `../field-values/field-change-events` are LAZY-imported for the reason
// `resources/crud/tx-write-flush.ts`'s header records: this module is reached from the
// crud barrel, whose evaluation order is load-bearing for the cycle through `@auxx/lib/cache`.

import type { Database } from '@auxx/database'
import type { CustomFieldEntity, FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import type { CachedField } from '../field-values/types'
import { runWithDirtyParents } from '../reconcilers/dirty-parents'
import {
  getRegisteredEntityFieldChangeHooks,
  getRegisteredFieldTypeChangeHooks,
  toEntityFieldChangeHandler,
} from './registry'
import type { BatchCore, FieldChangeRef, RegisteredFieldChangeHook } from './types'

const logger = createScopedLogger('field-hooks:dispatch')

/**
 * Ceiling on the changes a `degraded` list may synthesize (§7 item 4). A def with many
 * system attributes times a truncated scope's record list is the shape this bounds.
 */
const MAX_DEGRADED_CHANGES = 20_000

export type DispatchLane = 'buffered' | 'sync'

export interface DispatchChange {
  /** Either RecordId keyspace — the def resolves through `findCachedResource`. */
  recordId: RecordId
  /** `systemAttribute ?? fieldId`, the key both the scope and the manifest use. */
  outputKey: string
  /** Pre/post values. Present on the buffered lane, absent on sync. */
  o?: unknown
  n?: unknown
  isCreate?: boolean
}

export interface DispatchInput {
  organizationId: string
  userId: string
  lane: DispatchLane
  changes: DispatchChange[]
  /** Records whose keys were shed: every field with an applicable hook becomes a valueless change. */
  degraded?: RecordId[]
  /** Required on the sync lane — handed to batch cores so they read this run's connection. */
  db?: Database
  /** Correlates the report line with the caller's own logs (the flush's `scope.attemptId`). */
  attemptId?: string
}

export interface DispatchHandlerCounts {
  fired: number
  skipped: number
  failed: number
}

export interface DispatchReport {
  lane: DispatchLane
  attemptId?: string
  handlers: Record<string, DispatchHandlerCounts>
  /** Changes that resolved to a def + field and reached the chain. */
  changes: number
  /** Valueless changes synthesized from `degraded`. */
  degraded: number
}

interface DefIndex {
  entityDefinitionId: string
  entityType: string | null
  entitySlug: string
  byOutputKey: Map<string, CachedField>
}

type DefResolver = (rawDefId: string) => Promise<DefIndex | null>

interface BatchEntry {
  core: BatchCore
  name: string
  targets: FieldChangeRef[]
}

interface DispatchState {
  organizationId: string
  userId: string
  lane: DispatchLane
  report: DispatchReport
  batches: Map<RegisteredFieldChangeHook, BatchEntry>
  emit: EmitFieldChange
}

type EmitFieldChange = typeof import('../field-values/field-change-events').emitFieldChange

/**
 * Replay the registered field-change hook chain for a committed lane's changes.
 *
 * Cache-only resolution, one `runWithDirtyParents` around the whole pass so marks coalesce
 * and drain once (it JOINS an ambient scope, which is what the flush relies on). Never
 * throws: every handler call is guarded so one bad handler cannot starve the rest.
 */
export async function dispatchFieldChanges(input: DispatchInput): Promise<DispatchReport> {
  const { organizationId, userId, lane, changes, degraded = [], db, attemptId } = input
  const report: DispatchReport = { lane, attemptId, handlers: {}, changes: 0, degraded: 0 }
  if (changes.length === 0 && degraded.length === 0) return report

  const [resolveDef, { emitFieldChange }] = await Promise.all([
    buildDefResolver(organizationId),
    import('../field-values/field-change-events'),
  ])

  const state: DispatchState = {
    organizationId,
    userId,
    lane,
    report,
    batches: new Map(),
    emit: emitFieldChange,
  }

  await runWithDirtyParents(organizationId, userId, async () => {
    for (const change of changes) {
      const resolved = await resolveChange(resolveDef, state, change)
      if (!resolved) continue
      report.changes++
      await runChain(state, resolved.ref, resolved.hooks, change)
    }
    await dispatchDegraded(resolveDef, state, degraded)
    await runBatchCores(state, db)
  })

  // One structured line per dispatch: a derivation that stops firing shows up as a zero here.
  logger.info('field hooks dispatched', { organizationId, ...report })
  return report
}

// =============================================================================
// Resolution
// =============================================================================

/**
 * Memoizing def resolver over the RecordId prefix (slug or CUID — `findCachedResource`
 * matches id, entityType and apiSlug). Null for unknown defs: a skipped record beats a
 * thrown dispatch.
 */
async function buildDefResolver(organizationId: string): Promise<DefResolver> {
  const { findCachedResource, getCachedCustomFields } = await import('../cache')
  const memo = new Map<string, Promise<DefIndex | null>>()
  return (rawDefId: string) => {
    let pending = memo.get(rawDefId)
    if (!pending) {
      pending = (async () => {
        const resource = await findCachedResource(organizationId, rawDefId)
        if (!resource?.entityDefinitionId) return null
        const fields = await getCachedCustomFields(organizationId, resource.entityDefinitionId)
        const byOutputKey = new Map<string, CachedField>()
        for (const raw of fields) byOutputKey.set(raw.systemAttribute ?? raw.id, asCachedField(raw))
        return {
          entityDefinitionId: resource.entityDefinitionId,
          entityType: resource.entityType ?? null,
          entitySlug: resource.apiSlug,
          byOutputKey,
        }
      })().catch((error) => {
        logger.warn('def resolution failed — skipping def', {
          organizationId,
          rawDefId,
          error: message(error),
        })
        return null
      })
      memo.set(rawDefId, pending)
    }
    return pending
  }
}

/** `CachedField` is `CustomFieldEntity` plus display config no handler in §3 reads. */
function asCachedField(field: CustomFieldEntity): CachedField {
  return field as unknown as CachedField
}

async function resolveChange(
  resolveDef: DefResolver,
  state: DispatchState,
  change: DispatchChange
): Promise<{ ref: FieldChangeRef; hooks: RegisteredFieldChangeHook[] } | null> {
  const { entityDefinitionId: rawDefId, entityInstanceId } = parseRecordId(change.recordId)
  const def = await resolveDef(rawDefId)
  if (!def) return null
  const field = def.byOutputKey.get(change.outputKey)
  if (!field) return null
  const hasValues = 'o' in change || 'n' in change
  const ref: FieldChangeRef = {
    // Canonical CUID keyspace, so a handler's read/write path resolves the def.
    recordId: toRecordId(def.entityDefinitionId, entityInstanceId),
    entityDefinitionId: def.entityDefinitionId,
    entityType: def.entityType,
    entitySlug: def.entitySlug,
    field,
    organizationId: state.organizationId,
    userId: state.userId,
    ...(change.isCreate ? { isCreate: true } : {}),
    ...(hasValues ? { oldValue: change.o ?? null, newValue: change.n ?? null } : {}),
  }
  return { ref, hooks: chainFor(def.entitySlug, field) }
}

/** Entity-scoped chain first, then the field's type-keyed chain — the inline gate's order. */
function chainFor(entitySlug: string, field: CachedField): RegisteredFieldChangeHook[] {
  return [
    ...getRegisteredEntityFieldChangeHooks(entitySlug),
    ...getRegisteredFieldTypeChangeHooks(field.type as FieldType),
  ]
}

// =============================================================================
// The chain
// =============================================================================

async function runChain(
  state: DispatchState,
  ref: FieldChangeRef,
  hooks: RegisteredFieldChangeHook[],
  change: DispatchChange
): Promise<void> {
  const hasValues = ref.oldValue !== undefined || ref.newValue !== undefined
  const live = state.lane === 'buffered' && hasValues

  for (const hook of hooks) {
    const name = handlerName(hook.handler)
    switch (hook.kind) {
      case 'mark':
        await guard(state, name, () => hook.handler(ref))
        break
      case 'derive':
        if (live) {
          if (hook.options.skipOnCreate && ref.isCreate) {
            count(state, name, 'skipped')
            break
          }
          const handler = toEntityFieldChangeHandler(hook)
          await guard(state, name, () => handler(toEvent(ref)))
          break
        }
        collectBatchTarget(state, hook, ref, name)
        break
      case 'react':
        if (!live) {
          count(state, name, 'skipped')
          break
        }
        await guard(state, name, () => hook.handler(toEvent(ref)))
        break
    }
  }

  if (live && !change.isCreate) emit(state, ref)
}

/**
 * Batch cores run on the sync lane only: the buffered lane has no `db` to hand them, and
 * a buffered scope that degraded to marks must not start deriving.
 */
function collectBatchTarget(
  state: DispatchState,
  hook: RegisteredFieldChangeHook & { kind: 'derive' },
  ref: FieldChangeRef,
  name: string
): void {
  const core = hook.options.batch
  if (!core || state.lane !== 'sync' || (hook.options.skipOnCreate && ref.isCreate)) {
    count(state, name, 'skipped')
    return
  }
  let entry = state.batches.get(hook)
  if (!entry) {
    entry = { core, name, targets: [] }
    state.batches.set(hook, entry)
  }
  entry.targets.push(ref)
}

async function runBatchCores(state: DispatchState, db: Database | undefined): Promise<void> {
  for (const entry of state.batches.values()) {
    if (entry.targets.length === 0) continue
    if (!db) {
      logger.error('batch derive has targets but no db — skipping core', {
        handler: entry.name,
        targets: entry.targets.length,
      })
      count(state, entry.name, 'failed', entry.targets.length)
      continue
    }
    try {
      await entry.core({
        organizationId: state.organizationId,
        userId: state.userId,
        db,
        targets: entry.targets,
      })
      count(state, entry.name, 'fired', entry.targets.length)
    } catch (error) {
      logger.error('batch derive core failed', {
        handler: entry.name,
        targets: entry.targets.length,
        error: message(error),
      })
      count(state, entry.name, 'failed', entry.targets.length)
    }
  }
}

/** The `<prefix>:field:updated` bus event, replayed on the buffered lane (§8.1). */
function emit(state: DispatchState, ref: FieldChangeRef): void {
  try {
    state.emit(
      {
        recordId: ref.recordId,
        entityDefinitionId: ref.entityDefinitionId,
        entitySlug: ref.entitySlug,
        entityType: ref.entityType,
        organizationId: ref.organizationId,
        userId: ref.userId,
        change: {
          fieldId: ref.field.id,
          fieldName: ref.field.name,
          fieldType: ref.field.type,
          oldValue: ref.oldValue ?? null,
          newValue: ref.newValue ?? null,
          oldDisplay: null,
          newDisplay: null,
        },
      },
      undefined
    )
  } catch (error) {
    logger.error('field:updated emit failed', { recordId: ref.recordId, error: message(error) })
  }
}

// =============================================================================
// Degraded records
// =============================================================================

async function dispatchDegraded(
  resolveDef: DefResolver,
  state: DispatchState,
  degraded: RecordId[]
): Promise<void> {
  if (degraded.length === 0) return
  let capped = false

  for (const recordId of degraded) {
    const { entityDefinitionId: rawDefId, entityInstanceId } = parseRecordId(recordId)
    const def = await resolveDef(rawDefId)
    if (!def) continue

    const entityHooks = getRegisteredEntityFieldChangeHooks(def.entitySlug)
    const entityApplies = entityHooks.some((hook) => appliesDegraded(state.lane, hook))

    for (const [key, field] of def.byOutputKey) {
      const typeHooks = getRegisteredFieldTypeChangeHooks(field.type as FieldType)
      const typeApplies = typeHooks.some((hook) => appliesDegraded(state.lane, hook))
      // Every entity-scoped handler filters on systemAttribute, so a custom field without one
      // can only reach its type-keyed chain (an org's own ADDRESS_STRUCT field).
      const chain = field.systemAttribute ? [...entityHooks, ...typeHooks] : typeHooks
      if (field.systemAttribute ? !entityApplies && !typeApplies : !typeApplies) continue
      if (state.report.degraded >= MAX_DEGRADED_CHANGES) {
        if (!capped) {
          capped = true
          logger.error('degraded dispatch capped; some derived values will stay stale', {
            organizationId: state.organizationId,
            cap: MAX_DEGRADED_CHANGES,
            records: degraded.length,
          })
        }
        return
      }
      state.report.degraded++
      const ref: FieldChangeRef = {
        recordId: toRecordId(def.entityDefinitionId, entityInstanceId),
        entityDefinitionId: def.entityDefinitionId,
        entityType: def.entityType,
        entitySlug: def.entitySlug,
        field,
        organizationId: state.organizationId,
        userId: state.userId,
      }
      await runChain(state, ref, chain, { recordId, outputKey: key })
    }
  }
}

/** A valueless change can only reach a mark, or a sync-lane derive with a batch core. */
function appliesDegraded(lane: DispatchLane, hook: RegisteredFieldChangeHook): boolean {
  if (hook.kind === 'mark') return true
  return lane === 'sync' && hook.kind === 'derive' && hook.options.batch !== undefined
}

// =============================================================================
// Plumbing
// =============================================================================

function toEvent(ref: FieldChangeRef) {
  return {
    recordId: ref.recordId,
    entityDefinitionId: ref.entityDefinitionId,
    entityType: ref.entityType,
    entitySlug: ref.entitySlug,
    field: ref.field,
    oldValue: ref.oldValue ?? null,
    newValue: ref.newValue ?? null,
    oldDisplay: null,
    newDisplay: null,
    organizationId: ref.organizationId,
    userId: ref.userId,
    ...(ref.isCreate ? { isCreate: true as const } : {}),
  }
}

async function guard(state: DispatchState, name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run()
    count(state, name, 'fired')
  } catch (error) {
    count(state, name, 'failed')
    logger.error('field-change handler failed', {
      handler: name,
      lane: state.lane,
      organizationId: state.organizationId,
      error: message(error),
    })
  }
}

function count(
  state: DispatchState,
  name: string,
  bucket: keyof DispatchHandlerCounts,
  by = 1
): void {
  const entry = (state.report.handlers[name] ??= { fired: 0, skipped: 0, failed: 0 })
  entry[bucket] += by
}

/** `export const foo: MarkHandler = async …` yields `foo`; an inline arrow yields ''. */
function handlerName(handler: (...args: never[]) => unknown): string {
  return handler.name || 'anonymous'
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
