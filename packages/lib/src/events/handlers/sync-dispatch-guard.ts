// packages/lib/src/events/handlers/sync-dispatch-guard.ts
//
// Phase 6 of plans/events/03-write-context-and-batch-lane-plan.md (§9, D-3 /
// D-13 / D-19): the guarded workflow dispatcher for LARGE sync runs. Invoked by
// `sync-finalize.ts`'s large-lane branch, inside the manifest claim — so it runs
// at most once per run.
//
// The tally is computed ALWAYS (D-3): every changed/created record is matched
// against the org's published resource triggers WITHOUT enqueuing, and the
// per-workflow result is persisted on the run row (`heldDispatches`) as the
// mechanical trace that the door was considered, not forgotten. Per workflow
// (D-13): below `WORKFLOW_AUTO_DISPATCH_THRESHOLD` matched records the
// dispatches auto-enqueue through the normal path (a workflow matching 12
// records in a 5,000-record backfill just runs); at or above, they are HELD —
// no enqueue — and one `bulk-dispatch` `ApprovalRequest` per held workflow
// surfaces the decision (D-19). Approval enqueues the held dispatches through
// the same enqueue seam; denial stamps the entry `skipped`.
//
// Keep top-level imports to types/logger/pure constants only; lazy-import
// everything else (same rule as `sync-finalize.ts` next door — the events ↔
// data-connectors ↔ cache boundaries break vi.mock otherwise).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { WORKFLOW_AUTO_DISPATCH_THRESHOLD } from '../../resources/crud/door-matrix'
import type { AuxxEvent } from '../types'
import type { WorkflowTriggerTarget } from './trigger-resource-workflows'

const logger = createScopedLogger('sync-dispatch-guard')

/**
 * Lifecycle of one tallied workflow on a run:
 * - `auto` — below the threshold; its dispatches were enqueued at finalize.
 * - `held` — at/above the threshold; nothing enqueued, an approval is pending.
 * - `approved` / `skipped` — the `bulk-dispatch` approval decision's stamp.
 */
export type HeldDispatchStatus = 'held' | 'auto' | 'approved' | 'skipped'

/**
 * One tallied workflow, persisted in the run row's `heldDispatches` jsonb
 * (`DataConnectorRun` / `ImportJob` — both columns structurally mirror this
 * type BY HAND; the database package cannot import across the tier boundary).
 */
export interface HeldDispatchEntry {
  workflowId: string
  workflowAppId: string
  workflowName?: string
  /** The trigger arm the records matched — what an approved dispatch fires as. */
  triggerType: 'created' | 'updated' | 'deleted'
  /**
   * The def id an `executeResourceTrigger` job for this workflow must carry —
   * the workflow's OWN stored id (see `WorkflowTriggerTarget`).
   */
  entityDefinitionId: string
  /**
   * Canonical RecordIds, bounded by the manifest caps (≤5k). Omitted for
   * `auto` entries to keep the row small — those already ran.
   */
  recordIds?: string[]
  count: number
  status: HeldDispatchStatus
  /** Set for `held` entries whose `bulk-dispatch` request was created. */
  approvalRequestId?: string
}

export interface SyncDispatchGuardInput {
  organizationId: string
  source: 'connector' | 'import'
  /** Run identity: DataConnectorRun id (connector) or ImportJob id (import). */
  ref: string
  /** The run's resolved initiator (sync-finalize's actor), or null for system. */
  actorUserId: string | null
  /** Manifest RecordIds — def prefix in the producer's keyspace (slug or CUID). */
  createdIds: RecordId[]
  updatedIds: RecordId[]
  /** sync-finalize's memoized slug/CUID → canonical def id resolver. */
  canonicalDefId: (defId: string) => Promise<string>
}

/**
 * The guarded workflow dispatch door. NEVER throws — same contract as the other
 * finalize doors: rules already fired off the claimed manifest, and a crash
 * re-thrown into a retry could never re-claim.
 */
export async function runGuardedWorkflowDispatch(
  db: Database,
  input: SyncDispatchGuardInput
): Promise<void> {
  const { organizationId, source, ref } = input
  try {
    const { matchResourceWorkflowTargets, enqueueWorkflowTriggerJobs } = await import(
      './trigger-resource-workflows'
    )
    const { toRecordId } = await import('@auxx/types/resource')
    const userId = input.actorUserId ?? 'system'

    // ── 1. Tally (D-3: computed always) ──────────────────────────────────────
    // Same synthesized events the small lane dispatches, matched only. Matching
    // is per (triggerType, def) — record content never enters it — so the match
    // is memoized per pair rather than resolved per record.
    type MatchResult = Awaited<ReturnType<typeof matchResourceWorkflowTargets>>
    const matchMemo = new Map<string, Promise<MatchResult>>()
    const tally = new Map<string, { target: WorkflowTriggerTarget; recordIds: string[] }>()
    /** Which workflows matched each record — drives the auto-dispatch pass. */
    const matchesByRecord = new Map<string, string[]>()

    const tallyOne = async (rid: RecordId, type: 'entity:created' | 'entity:updated') => {
      const { entityDefinitionId, entityInstanceId } = parseRecordId(rid)
      const canonical = await input.canonicalDefId(entityDefinitionId)
      const canonicalRecordId = toRecordId(canonical, entityInstanceId)
      const memoKey = `${type}:${canonical}`
      let pending = matchMemo.get(memoKey)
      if (!pending) {
        const event = {
          type,
          data: {
            recordId: canonicalRecordId,
            entityDefinitionId: canonical,
            // The dispatchers never read the slug; carried for shape parity only.
            entitySlug: entityDefinitionId,
            organizationId,
            userId,
            eventData: {},
          },
        } as unknown as AuxxEvent
        pending = matchResourceWorkflowTargets(event)
        matchMemo.set(memoKey, pending)
      }
      const matched = await pending
      if (!matched || matched.targets.length === 0) return
      const workflowIds: string[] = []
      for (const target of matched.targets) {
        let entry = tally.get(target.workflowId)
        if (!entry) tally.set(target.workflowId, (entry = { target, recordIds: [] }))
        entry.recordIds.push(canonicalRecordId)
        workflowIds.push(target.workflowId)
      }
      matchesByRecord.set(canonicalRecordId, workflowIds)
    }

    for (const rid of input.createdIds) await tallyOne(rid, 'entity:created')
    for (const rid of input.updatedIds) await tallyOne(rid, 'entity:updated')

    // ── 2. Split per workflow (D-13: per-workflow, never per-run) ────────────
    const entries: HeldDispatchEntry[] = []
    const autoWorkflowIds = new Set<string>()
    const held: Array<{ target: WorkflowTriggerTarget; recordIds: string[] }> = []
    for (const [workflowId, tallied] of tally) {
      if (tallied.recordIds.length < WORKFLOW_AUTO_DISPATCH_THRESHOLD) {
        autoWorkflowIds.add(workflowId)
        entries.push({
          workflowId,
          workflowAppId: tallied.target.workflowAppId,
          workflowName: tallied.target.workflowName,
          triggerType: tallied.target.triggerType,
          entityDefinitionId: tallied.target.jobEntityDefinitionId,
          // recordIds deliberately omitted — 'auto' already ran; keep the row small.
          count: tallied.recordIds.length,
          status: 'auto',
        })
      } else {
        held.push(tallied)
      }
    }

    // ── 3. Auto-dispatch through the normal enqueue path ─────────────────────
    // One record fetch per record even when several auto workflows match it —
    // the same memoization the combined CRUD dispatcher applies.
    if (autoWorkflowIds.size > 0) {
      const { fetchResourceById } = await import('../../resources/resource-fetcher')
      for (const [recordId, workflowIds] of matchesByRecord) {
        const targets = workflowIds
          .filter((id) => autoWorkflowIds.has(id))
          .map((id) => tally.get(id)!.target)
        if (targets.length === 0) continue
        try {
          const resourceData = await fetchResourceById(recordId as RecordId, organizationId)
          if (!resourceData) {
            logger.warn('guarded dispatch: record vanished before auto-dispatch', {
              organizationId,
              recordId,
            })
            continue
          }
          await enqueueWorkflowTriggerJobs({ organizationId, targets, resourceData })
        } catch (error) {
          logger.error('guarded dispatch: auto-dispatch failed for record', {
            organizationId,
            recordId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    // ── 4. Hold + file one `bulk-dispatch` approval per held workflow (D-19) ─
    for (const tallied of held) {
      const entry: HeldDispatchEntry = {
        workflowId: tallied.target.workflowId,
        workflowAppId: tallied.target.workflowAppId,
        workflowName: tallied.target.workflowName,
        triggerType: tallied.target.triggerType,
        entityDefinitionId: tallied.target.jobEntityDefinitionId,
        recordIds: tallied.recordIds,
        count: tallied.recordIds.length,
        status: 'held',
      }
      try {
        const { createBulkDispatchRequest } = await import(
          '../../approval-requests/bulk-dispatch-mutations'
        )
        const created = await createBulkDispatchRequest(db, {
          organizationId,
          source,
          ref,
          workflowId: entry.workflowId,
          workflowName: entry.workflowName,
          count: entry.count,
          actorUserId: input.actorUserId,
        })
        if (created.isErr()) {
          logger.error('guarded dispatch: approval request creation failed — stays held', {
            organizationId,
            ref,
            workflowId: entry.workflowId,
            error: created.error.message,
          })
        } else if (created.value) {
          entry.approvalRequestId = created.value
        }
      } catch (error) {
        logger.error('guarded dispatch: approval request creation failed — stays held', {
          organizationId,
          ref,
          workflowId: entry.workflowId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      entries.push(entry)
    }

    // ── 5. Persist the tally, once (D-3) ─────────────────────────────────────
    // An empty array is still written: it is the trace that the door ran and
    // matched nothing, distinct from NULL ("finalize predates Phase 6").
    await persistHeldDispatches(db, source, ref, entries)

    logger.info('guarded workflow dispatch', {
      organizationId,
      source,
      ref,
      tallied: tally.size,
      auto: autoWorkflowIds.size,
      held: held.length,
    })
  } catch (error) {
    logger.error('guarded workflow dispatch failed', {
      organizationId,
      source,
      ref,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Write the tally onto the run row — the surface v1 exposes (UI reads it later). */
async function persistHeldDispatches(
  db: Database,
  source: 'connector' | 'import',
  ref: string,
  entries: HeldDispatchEntry[]
): Promise<void> {
  const { schema } = await import('@auxx/database')
  const { eq } = await import('drizzle-orm')
  if (source === 'connector') {
    await db
      .update(schema.DataConnectorRun)
      .set({ heldDispatches: entries })
      .where(eq(schema.DataConnectorRun.id, ref))
  } else {
    await db
      .update(schema.ImportJob)
      .set({ heldDispatches: entries })
      .where(eq(schema.ImportJob.id, ref))
  }
}
