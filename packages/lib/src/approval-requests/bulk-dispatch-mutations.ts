// packages/lib/src/approval-requests/bulk-dispatch-mutations.ts
//
// The `bulk-dispatch` kind (plan events/03 §9, D-19): a large sync run's HELD
// workflow dispatches, one `ApprovalRequest` per held workflow per run —
// matching the per-workflow hold of D-13. Created at sync finalize by the
// guarded dispatcher (`events/handlers/sync-dispatch-guard.ts`); resolved
// through the shared approval spine, whose kind handler dispatches here.
//
// The request's TARGET is not a row of its own: it points (via
// `BulkDispatchRequestMetadata` — `{ source, ref, workflowId }`) at the
// matching `heldDispatches` entry on the run row, which carries the record ids,
// the trigger arm, and the job def id. The decision therefore reads and stamps
// the RUN ROW inside the claim transaction, and an approve enqueues from that
// entry after commit.
//
// **Notifications are deliberately not sent for this kind (v1).** The access
// lane's funnel is access-vocabulary-specific (rungs, target kinds), and the
// batch lane's notification door is OFF (D-14) — the pending-approvals list and
// badge, driven by `assigneeUsers`, are the surface until Phase 8's approval UX.

import { type Database, schema } from '@auxx/database'
import { ApprovalStatus } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import type { RecordId } from '@auxx/types/resource'
import { eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../cache'
import { BadRequestError, NotFoundError } from '../errors'
import type { HeldDispatchEntry, HeldDispatchStatus } from '../events/handlers/sync-dispatch-guard'
import type { WorkflowTriggerTarget } from '../events/handlers/trigger-resource-workflows'
import type { BulkDispatchRequestMetadata } from './client'
import { guard } from './guard'
import type { ApprovalResolveContext } from './types'

const logger = createScopedLogger('approval-requests')

/** Chunk size for the post-approval enqueue — bounds concurrent record fetches. */
const BULK_DISPATCH_ENQUEUE_CHUNK = 25

export interface CreateBulkDispatchRequestInput {
  organizationId: string
  source: 'connector' | 'import'
  /** Run identity: DataConnectorRun id (connector) or ImportJob id (import). */
  ref: string
  workflowId: string
  workflowName?: string
  count: number
  /** The run's resolved initiator, when attributable. */
  actorUserId: string | null
}

/**
 * File one `bulk-dispatch` approval request for a held workflow.
 *
 * Audience: the run's initiator plus org ADMIN/OWNER members — the people who
 * can weigh "start N workflow runs and spend their credits". Snapshotted into
 * `assigneeUsers` like every other kind; groups unused.
 *
 * No `expiresAt`: a held run stays decidable until someone decides it — an
 * expiry sweep flipping it to `timeout` would strand the run entry `held` with
 * no pending request to act on.
 *
 * Returns the request id, or `null` when the org has nobody to ask (no
 * attributable actor and no admins) — the tally entry then stays `held` with no
 * `approvalRequestId`, which the run row still surfaces.
 */
export async function createBulkDispatchRequest(
  db: Database,
  input: CreateBulkDispatchRequestInput
): Promise<Result<string | null, Error>> {
  return guard(
    async () => {
      const assigneeUsers = await resolveBulkDispatchAudience(
        input.organizationId,
        input.actorUserId
      )
      if (assigneeUsers.length === 0) {
        logger.warn('bulk-dispatch request has no audience — skipping creation', {
          organizationId: input.organizationId,
          ref: input.ref,
          workflowId: input.workflowId,
        })
        return null
      }

      const metadata: BulkDispatchRequestMetadata = {
        source: input.source,
        ref: input.ref,
        workflowId: input.workflowId,
      }
      const sourceNoun = input.source === 'connector' ? 'sync run' : 'import'
      const [inserted] = await db
        .insert(schema.ApprovalRequest)
        .values({
          organizationId: input.organizationId,
          kind: 'bulk-dispatch',
          status: ApprovalStatus.pending,
          subjectLabel: `'${input.workflowName ?? 'Workflow'}' · ${input.count} records held from ${sourceNoun}`,
          // The FK is NOT NULL; the run's actor when attributable, else the
          // first admin in the audience — creation is a system act either way.
          createdById: input.actorUserId ?? assigneeUsers[0]!,
          assigneeUsers,
          assigneeGroups: [],
          metadata,
        })
        .returning({ id: schema.ApprovalRequest.id })
      return inserted?.id ?? null
    },
    'Failed to create bulk-dispatch approval request',
    { organizationId: input.organizationId, ref: input.ref, workflowId: input.workflowId }
  )
}

/**
 * The run initiator + org ADMIN/OWNER human members — a cache read, same
 * derivation as the record access lane's D3 resolver. The actor is added even
 * when not an admin (it is their run), but only while still a human member.
 */
async function resolveBulkDispatchAudience(
  organizationId: string,
  actorUserId: string | null
): Promise<string[]> {
  const roleMap = await getOrgCache().get(organizationId, 'memberRoleMap')
  const userIds = new Set(
    Object.entries(roleMap)
      .filter(([, e]) => e.userType === 'USER' && (e.role === 'ADMIN' || e.role === 'OWNER'))
      .map(([userId]) => userId)
  )
  if (actorUserId && roleMap[actorUserId]?.userType === 'USER') userIds.add(actorUserId)
  return [...userIds]
}

/**
 * The `bulk-dispatch` kind's `onResolved` side effect, invoked INSIDE the
 * winning decision claim (registry contract).
 *
 * In the claim transaction: load the run row the request points at, find its
 * still-`held` entry for the workflow, and stamp it `approved` / `skipped` — so
 * the run row and the request's terminal status cannot disagree, and a second
 * request for the same entry (impossible today, the finalize claim creates them
 * once) could never double-fire.
 *
 * The APPROVE enqueue happens in `afterCommit`, deliberately: BullMQ jobs are
 * not transactional, so enqueuing inside the claim could start thousands of
 * runs for a decision that then rolls back — the same deferred-until-commit
 * rule the module applies to notifications (types.ts §afterCommit). The cost is
 * the inverse failure: an enqueue crash after commit leaves the entry
 * `approved` with fewer runs started; that is logged loudly by the resolve
 * path and is recoverable, where phantom runs are not.
 */
export async function applyBulkDispatchDecision(
  ctx: ApprovalResolveContext
): Promise<{ message: string; afterCommit?: (db: Database) => Promise<void> }> {
  const { request, action } = ctx
  const tx = ctx.tx as Database
  const meta = (request.metadata ?? {}) as Partial<BulkDispatchRequestMetadata>
  if (!meta.source || !meta.ref || !meta.workflowId) {
    throw new BadRequestError('Bulk-dispatch approval request is missing its run reference')
  }
  const { source, ref, workflowId } = meta

  const row =
    source === 'connector'
      ? await tx.query.DataConnectorRun.findFirst({
          where: eq(schema.DataConnectorRun.id, ref),
          columns: { heldDispatches: true },
        })
      : await tx.query.ImportJob.findFirst({
          where: eq(schema.ImportJob.id, ref),
          columns: { heldDispatches: true },
        })
  if (!row) {
    throw new NotFoundError('The sync run this approval belongs to no longer exists')
  }

  const held = (row.heldDispatches ?? []) as HeldDispatchEntry[]
  const entry = held.find((e) => e.workflowId === workflowId && e.status === 'held')
  if (!entry) {
    throw new BadRequestError('This run no longer holds dispatches for the workflow')
  }

  const newStatus: HeldDispatchStatus = action === 'approve' ? 'approved' : 'skipped'
  const next = held.map((e) => (e === entry ? { ...e, status: newStatus } : e))
  if (source === 'connector') {
    await tx
      .update(schema.DataConnectorRun)
      .set({ heldDispatches: next })
      .where(eq(schema.DataConnectorRun.id, ref))
  } else {
    await tx
      .update(schema.ImportJob)
      .set({ heldDispatches: next })
      .where(eq(schema.ImportJob.id, ref))
  }

  const name = entry.workflowName ?? 'Workflow'
  if (action === 'deny') {
    return { message: `Skipped '${name}' for ${entry.count} records` }
  }

  const organizationId = request.organizationId
  const recordIds = entry.recordIds ?? []
  const target: WorkflowTriggerTarget = {
    workflowAppId: entry.workflowAppId,
    workflowId: entry.workflowId,
    workflowName: entry.workflowName,
    triggerType: entry.triggerType,
    jobEntityDefinitionId: entry.entityDefinitionId,
  }

  return {
    message: `Approved '${name}' — dispatching ${recordIds.length} records`,
    afterCommit: async () => {
      // Lazy imports per the registry's cycle rule — the enqueue seam lives in
      // the events handlers, which reach back into workflow execution.
      const { enqueueWorkflowTriggerJobs } = await import(
        '../events/handlers/trigger-resource-workflows'
      )
      const { fetchResourceById } = await import('../resources/resource-fetcher')
      let enqueued = 0
      for (let i = 0; i < recordIds.length; i += BULK_DISPATCH_ENQUEUE_CHUNK) {
        const chunk = recordIds.slice(i, i + BULK_DISPATCH_ENQUEUE_CHUNK)
        await Promise.all(
          chunk.map(async (recordId) => {
            try {
              const resourceData = await fetchResourceById(recordId as RecordId, organizationId)
              if (!resourceData) {
                logger.warn('bulk-dispatch approve: record vanished — skipping', {
                  approvalRequestId: request.id,
                  recordId,
                })
                return
              }
              await enqueueWorkflowTriggerJobs({ organizationId, targets: [target], resourceData })
              enqueued++
            } catch (error) {
              logger.error('bulk-dispatch approve: enqueue failed for record', {
                approvalRequestId: request.id,
                recordId,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          })
        )
      }
      logger.info('bulk-dispatch approved — held dispatches enqueued', {
        approvalRequestId: request.id,
        organizationId,
        workflowId: entry.workflowId,
        enqueued,
        of: recordIds.length,
      })
    },
  }
}
