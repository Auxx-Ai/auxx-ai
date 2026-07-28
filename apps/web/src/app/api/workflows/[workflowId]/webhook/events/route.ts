// apps/web/src/app/api/workflows/[workflowId]/webhook/events/route.ts

import { WorkflowApp } from '@auxx/database'
import { getCapabilities } from '@auxx/lib/permissions'
import { and, eq } from 'drizzle-orm'
import { createSsePollRoute } from '~/lib/sse/create-sse-poll-route'

/**
 * SSE replay of the inbound webhook payloads captured by the sibling
 * `../webhook/route.ts` in test mode (`?test=true`) — the method, headers, query
 * string and **body** of real external calls, buffered on
 * `webhook:test:<workflowId>:events`.
 *
 * Gated on instance **`edit`** of the workflow. `[workflowId]` here is a
 * `WorkflowApp.id` — the id space per-workflow instance access keys on directly
 * (the sibling webhook ingress resolves the same segment via
 * `db.query.WorkflowApp`), so unlike `run/route.ts` and `files/[fileId]` there is
 * no version id to walk up from.
 *
 * `edit` rather than the `view` its read-only siblings use (`workflow/run/[runId]/events`,
 * `workflows/[workflowId]/files/[fileId]` GET): this buffer is written **only**
 * in test mode and read by exactly one client — the builder's webhook node panel,
 * whose "Test Webhook" button is `disabled={isReadOnly}`, and `useReadOnly()`
 * folds in `instanceReadOnly` = holds `view` but not `edit` (plan 30 §4). The
 * client already treats capturing test payloads as an authoring affordance, and
 * plan 30 §4 lists "Run single node / test" at the Edit tier, matching the
 * sibling test-run route's `canEditInstance`. Gating at `view` would leave the
 * server looser than the UI it serves.
 *
 * Before this, `authorize` returned true for **any** org member whose
 * `defaultOrganizationId` matched the workflow's org, so a member restricted from
 * this workflow — or composing `workflows: None` — could still replay its
 * captured payloads.
 *
 * `createSsePollRoute` collapses a `false` here to a clean **403** (there is no
 * 404 path), so a workflow in another org, a workflow that never existed, a
 * system-owned one and one the caller is restricted from are all indistinguishable
 * — `WorkflowApp.id`s stay unprobeable across orgs.
 *
 * No `FeatureKey.workflows` plan-AND, following the read-only REST precedent
 * (plan 32): an org mid-downgrade should not have a live SSE reconnect fail.
 */
export const GET = createSsePollRoute({
  getRedisKey: ({ workflowId }) => `webhook:test:${workflowId}:events`,
  authorize: async (session, params, db) => {
    const { workflowId } = params
    if (!workflowId) return false

    const organizationId = session.user.defaultOrganizationId

    const workflow = await db.query.WorkflowApp.findFirst({
      where: and(eq(WorkflowApp.id, workflowId), eq(WorkflowApp.organizationId, organizationId)),
      columns: { id: true, ownerType: true },
    })

    // System-owned apps (Sequences plan §3.4) are never addressable by org users,
    // regardless of how much workflow access the caller holds.
    if (!workflow || workflow.ownerType) return false

    const capabilities = await getCapabilities(session.user.id, organizationId)
    return capabilities.canEditInstance('workflow', workflow.id)
  },
})
