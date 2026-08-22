// packages/lib/src/resources/crud/tx-write-scope.ts

// Phase A of plans/events/04-in-transaction-write-semantics-plan.md (§6):
// an in-transaction composition is a one-transaction sync run. The doors it
// would have opened per write are captured here as PURE DATA and replayed once,
// after the transaction commits, by `flushTxWriteScope`.
//
// The whole point of this file is the per-attempt contract (T-5). A buffer that
// outlives one transaction attempt double-flushes writes a serializable retry
// rolled back, so `runInTxWrite` mints the scope itself and hands it back only
// on the resolving path. There is deliberately no API shape that lets a caller
// open a scope, hold it, and pass it into a retry loop.
//
// NOT re-exported from `resources/crud/index.ts`, on purpose. This module and
// `tx-write-flush` are imported by leaf path so the crud barrel's module
// evaluation order stays exactly as it is — that order is load-bearing for the
// import cycle that runs through `@auxx/lib/cache`.

import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { generateId } from '@auxx/utils'
import type { FieldValueUpdateEntry } from '../../realtime/events'
import type { ManifestFieldChange } from '../../record-rules/sync-manifest-types'
import type { WriteSession } from './write-origin'
import { getAmbientWriteSession, runWithWriteSession } from './write-session-als'

const logger = createScopedLogger('tx-write-scope')

/**
 * Cap on how many distinct records one scope buffers, per bucket (T-5 rule 6).
 * Billing composes well under this; the cap is a guard against a runaway
 * composition, not a lane. Overflow flips {@link TxWriteScope.truncated} and
 * degrades that flush to a coarse `records:invalidated` per touched def.
 */
export const MAX_TX_WRITE_RECORDS = 500

/** A create captured inside a buffered scope. Pure data — no handles, no closures. */
export interface TxWriteCreate {
  recordId: RecordId
  /** Canonical `EntityDefinition.id` — the record-room keyspace. */
  entityDefinitionId: string
  entityType: string | null
  entitySlug: string
  /** `systemAttribute ?? fieldId` → raw value, exactly `extractEventData`'s shape. */
  values: Record<string, unknown>
  /**
   * T-1b. Set by the composing site when this create is structural — the named
   * parent announces it. Honoured ONLY if that parent is itself in
   * {@link TxWriteScope.created}; otherwise this record announces itself as
   * normal. Nothing is inferred from the def or the relationship graph.
   */
  absorbInto?: RecordId
}

/** An archive/delete captured inside a buffered scope. */
export interface TxWriteArchive {
  recordId: RecordId
  entityDefinitionId: string
  entityType: string | null
  entitySlug: string
  /** `record:archived` for a soft archive, `record:deleted` for a hard delete. */
  realtimeEvent: 'record:archived' | 'record:deleted'
  /** The `entity:deleted` payload the inline lane would have carried. */
  eventData: Record<string, unknown>
}

/**
 * The buffer for ONE transaction attempt (§6.3). Every member is a plain value:
 * never a `FieldValueContext`, a `FieldValueService`, a `UnifiedCrudHandler`, an
 * `EntityFieldChangeEvent`, or any closure — all of those hold `ctx.db`, which
 * post-commit is a released transaction handle that fails silently (T-4).
 * {@link assertTxWriteScopePure} enforces that in dev.
 */
export interface TxWriteScope {
  /** Identity of THIS attempt. Never reused across retries. */
  readonly attemptId: string
  readonly organizationId: string
  readonly actorUserId: string
  readonly at: Date
  readonly created: TxWriteCreate[]
  /** RecordId → outputKey → `{ o?, n }` — `ManifestFieldChange`, verbatim. */
  readonly changes: Record<RecordId, Record<string, ManifestFieldChange>>
  /**
   * The `fieldValues:updated` entries the inline lane would have published,
   * shaped at the write (where the typed values are in hand) and replayed
   * verbatim at flush. Keyed by the same RecordId as {@link changes}.
   */
  readonly realtime: Record<RecordId, FieldValueUpdateEntry[]>
  readonly archived: TxWriteArchive[]
  truncated: boolean
}

/**
 * Mint an empty scope. Exported for tests and for {@link runInTxWrite}, which is
 * the only supported production entry point — it owns the lifecycle so a retry
 * is structurally unable to reuse a buffer (T-5 rules 1–3).
 */
export function createTxWriteScope(organizationId: string, actorUserId: string): TxWriteScope {
  return {
    attemptId: generateId(),
    organizationId,
    actorUserId,
    at: new Date(),
    created: [],
    changes: {},
    realtime: {},
    archived: [],
    truncated: false,
  }
}

/**
 * The buffered scope of the current async context, or undefined when the
 * ambient session is not buffered. `session` (a handler's or a
 * `FieldValueContext`'s own) wins over the ambient one, matching the S1
 * resolution order.
 */
export function getAmbientTxWriteScope(session?: WriteSession): TxWriteScope | undefined {
  const own = session?.mode
  if (own?.kind === 'buffered') return own.scope
  // Falls through rather than returning undefined on purpose: a service or
  // handler CONSTRUCTED before the scope opened carries a non-buffered session
  // of its own, and publishing from it mid-transaction is exactly the failure
  // this lane exists to prevent.
  const ambient = getAmbientWriteSession()?.mode
  return ambient?.kind === 'buffered' ? ambient.scope : undefined
}

/**
 * Run `fn` with a FRESH buffered scope as the ambient write session, and return
 * the scope alongside the result — on the resolving path only (T-5 rule 3).
 *
 * Call this INSIDE the `database.transaction` callback, with `tx` already in
 * hand. Rules it makes structural rather than disciplinary:
 *
 * 1. the scope is minted here, so no caller can open one before the callback;
 * 2. one scope per invocation, so a serializable retry starts empty;
 * 3. a throw takes the scope with it — a rejected promise carries no scope, so
 *    `withSerializableRetry` can never flush a rolled-back attempt;
 * 4. nesting JOINS: an already-buffered ambient session returns its own scope,
 *    so there is one buffer and one flush per outermost transaction (rule 5).
 *
 * **`owned` is what makes rule 4 safe, and callers MUST honour it: flush only
 * when `owned` is true.** A joined caller shares the outer buffer, so flushing
 * it would (a) re-announce everything the outer composition has accumulated so
 * far — N joined commands replaying an ever-growing buffer is O(N²) duplicate
 * `record:created` — and (b) on a serializable retry inside a joined scope,
 * replay the captures of an attempt that rolled back, which is exactly the
 * failure T-5 exists to prevent, reached through the one path the per-attempt
 * contract does not cover. The outermost owner flushes once, for everyone.
 *
 * Nesting is not reachable today (no caller of money's billing commands sits
 * inside a buffered scope), but `batch-invoicing.ts` already loops those
 * commands and plan 03's batch lane is about wrapping batches in a session.
 *
 * Known limitation while joined: a nested composition's own post-flush work
 * (money's two billing projections, which run events-ON) still runs at the inner
 * call site, so it lands BEFORE the outer flush and inverts O-9's ordering for
 * that invoice. Acceptable only because nesting is unreachable; whoever makes it
 * reachable owns fixing the ordering too.
 */
export async function runInTxWrite<T>(
  args: { organizationId: string; actorUserId: string },
  fn: (scope: TxWriteScope) => Promise<T>
): Promise<{ result: T; scope: TxWriteScope; owned: boolean }> {
  const existing = getAmbientTxWriteScope()
  if (existing) {
    return { result: await fn(existing), scope: existing, owned: false }
  }

  const ambient = getAmbientWriteSession()
  const scope = createTxWriteScope(args.organizationId, args.actorUserId)
  const session: WriteSession = {
    origin: ambient?.origin ?? { kind: 'interactive', userId: args.actorUserId },
    depth: ambient?.depth ?? 0,
    mode: { kind: 'buffered', scope },
  }
  const result = await runWithWriteSession(session, () => fn(scope))
  return { result, scope, owned: true }
}

/**
 * Whether `recordId` is being created inside this scope — the T-1 absorption
 * test, and the reason the field-value layer can skip capturing a composed
 * record's own field writes altogether.
 *
 * Matched on the entity INSTANCE id, never the RecordId string: `handler.create`
 * builds RecordIds from the canonical `EntityDefinition.id` while money's own
 * writers build them from the type slug, and the two never compare equal for the
 * same record.
 */
export function isTxWriteCreated(scope: TxWriteScope, recordId: RecordId): boolean {
  const instanceId = parseRecordId(recordId).entityInstanceId
  return scope.created.some(
    (create) => parseRecordId(create.recordId).entityInstanceId === instanceId
  )
}

function markTruncated(scope: TxWriteScope, what: string): void {
  if (scope.truncated) return
  scope.truncated = true
  logger.warn('Transaction write scope truncated — cap hit', {
    what,
    attemptId: scope.attemptId,
    created: scope.created.length,
    changed: Object.keys(scope.changes).length,
  })
}

/** Buffer a create. Silently drops (and flags `truncated`) past the cap. */
export function recordTxWriteCreate(scope: TxWriteScope, create: TxWriteCreate): void {
  if (scope.created.length >= MAX_TX_WRITE_RECORDS) {
    markTruncated(scope, 'created records')
    return
  }
  scope.created.push(create)
}

/** Buffer an archive/delete. Silently drops (and flags `truncated`) past the cap. */
export function recordTxWriteArchive(scope: TxWriteScope, archive: TxWriteArchive): void {
  if (scope.archived.length >= MAX_TX_WRITE_RECORDS) {
    markTruncated(scope, 'archived records')
    return
  }
  scope.archived.push(archive)
}

/**
 * Buffer one field write: the `{ o, n }` tuple (the manifest's shape, captured
 * in-tx because post-commit the pre-write value is gone) and the realtime entry
 * the inline lane would have published. First `o` wins, last `n` wins — the same
 * merge `sync-manifest-collector` applies, so a field written twice in one
 * composition folds the way a sync run's would.
 */
export function recordTxWriteChange(
  scope: TxWriteScope,
  args: {
    recordId: RecordId
    outputKey: string
    change: ManifestFieldChange
    entry?: FieldValueUpdateEntry
  }
): void {
  const { recordId, outputKey, change, entry } = args
  let bucket = scope.changes[recordId]
  if (!bucket) {
    if (Object.keys(scope.changes).length >= MAX_TX_WRITE_RECORDS) {
      markTruncated(scope, 'changed records')
      return
    }
    bucket = {}
    scope.changes[recordId] = bucket
  }
  const existing = bucket[outputKey]
  bucket[outputKey] = existing
    ? { n: change.n, ...('o' in existing ? { o: existing.o } : {}) }
    : change

  if (!entry) return
  const entries = scope.realtime[recordId] ?? []
  const at = entries.findIndex((candidate) => candidate.key === entry.key)
  if (at >= 0) entries[at] = entry
  else entries.push(entry)
  scope.realtime[recordId] = entries
}

/**
 * Dev-only T-4 enforcement: a buffered effect must survive `structuredClone`.
 * A captured `Database`/`Transaction` handle, service instance or closure cannot
 * — and the failure mode it prevents (a post-commit write on a released
 * transaction) is SILENT in production, so it has to fail loudly here.
 *
 * @throws {Error} when the scope holds anything non-cloneable.
 */
export function assertTxWriteScopePure(scope: TxWriteScope): void {
  if (process.env.NODE_ENV === 'production') return
  try {
    structuredClone(scope)
  } catch (error) {
    throw new Error(
      `TxWriteScope holds non-cloneable state (T-4): a buffered effect must be a plain value, never a db handle, service or closure. ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}
