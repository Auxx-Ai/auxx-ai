// packages/lib/src/permissions/capabilities/record-view-scope.ts

import { database, schema } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { getWorkOrderProjections } from '../../dispatch/work-order-fields'
import { resolveUserWorkerIds } from '../../dispatch/workers'

/**
 * The row-scoped read set for a field (worker) seat (§4.1) — the entity-instance
 * ids a member holding `recordsViewLinked` (but NOT `recordsView`) may READ.
 *
 * Reach, phase 2: the member's assigned visits → their work orders → the work
 * order's linked contact. The work-order instances themselves are included so
 * the drawer can open the job. Invoked ONLY when the caller's
 * {@link import('./capability-set').CapabilitySet} lacks `recordsView` — full
 * seats never pay this cost.
 *
 * TODO(capabilities): extend linked reach — sites and other work-order relations
 * are not yet included; invoices/payments are deliberately excluded (§11.2 open
 * item). Widen here once the reach decision lands.
 */
async function computeLinkedRecordIds(
  userId: string,
  organizationId: string
): Promise<Set<string>> {
  const readable = new Set<string>()

  // Assignee scope — same `myWorkerIds` rule my-schedule enforces (§5.3).
  const myWorkerIds = await resolveUserWorkerIds(organizationId, userId)
  if (myWorkerIds.length === 0) return readable

  // ONE indexed read: every visit on my worker rows → its work order.
  const visits = await database
    .select({ workOrderId: schema.WorkOrderVisit.workOrderId })
    .from(schema.WorkOrderVisit)
    .where(
      and(
        eq(schema.WorkOrderVisit.organizationId, organizationId),
        inArray(schema.WorkOrderVisit.assigneeWorkerId, myWorkerIds)
      )
    )

  const workOrderIds = Array.from(new Set(visits.map((v) => v.workOrderId)))
  if (workOrderIds.length === 0) return readable
  for (const id of workOrderIds) readable.add(id)

  // Work order → linked contact (cache-backed batch projection, reused from dispatch).
  const projections = await getWorkOrderProjections(organizationId, userId, workOrderIds, [
    'contact',
  ])
  for (const projection of projections.values()) {
    if (projection.contactRecordId) {
      readable.add(parseRecordId(projection.contactRecordId).entityInstanceId)
    }
  }

  return readable
}

/** Per-request memo: `memoScope` object (e.g. the tRPC `ctx`) → `${orgId}:${userId}` → set. */
const requestMemo = new WeakMap<object, Map<string, Promise<Set<string>>>>()

/**
 * Resolve (and memoize on the request) the set of entity-instance ids a field
 * seat may READ. Pass a stable per-request object as `memoScope` (the router
 * `ctx`) so the drawer, peek stack, and batch fetch of one request share a
 * single query; omit it for a one-shot resolve.
 */
export function resolveLinkedRecordIds(
  userId: string,
  organizationId: string,
  memoScope?: object
): Promise<Set<string>> {
  if (!memoScope) return computeLinkedRecordIds(userId, organizationId)

  let byKey = requestMemo.get(memoScope)
  if (!byKey) {
    byKey = new Map()
    requestMemo.set(memoScope, byKey)
  }
  const key = `${organizationId}:${userId}`
  const existing = byKey.get(key)
  if (existing) return existing

  const pending = computeLinkedRecordIds(userId, organizationId)
  byKey.set(key, pending)
  return pending
}
