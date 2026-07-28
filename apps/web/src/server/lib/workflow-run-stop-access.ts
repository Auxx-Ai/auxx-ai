// apps/web/src/server/lib/workflow-run-stop-access.ts

import type { Database } from '@auxx/database'
// Type-only, so it is erased at runtime and never pulls the (vitest-hostile)
// permissions barrel into this module's import graph.
import type { CapabilityView } from '@auxx/lib/permissions'
import { getWorkflowRunCreatorId } from '@auxx/lib/workflows'

/**
 * Who may stop a workflow run (plan 30, user decision 2026-07-27):
 *
 *  - instance **`edit`** and above — may stop **any** run on that workflow.
 *  - instance **`view`** — may stop **only a run they started themselves**.
 *    This is the corollary of "`view` means you may RUN it" (plan 30 §2): a
 *    member who can start a run must be able to cancel the one they started,
 *    but must not reach anyone else's.
 *  - anything below `view` — nothing.
 *
 * **Runs with no owner cannot be stopped by a `view` holder.**
 * {@link getWorkflowRunCreatorId} returns `null` when the run is missing or
 * `WorkflowRun.createdBy` was nulled by `ON DELETE SET NULL` after the creator's
 * `User` row went away, and `null` never equals a caller's id, so those runs
 * need `edit`. Headless/system runs are covered by the same comparison rather
 * than a special case: every programmatic start writes the ORG'S SYSTEM USER id
 * into `createdBy` (see `system-workflow-run.ts` /
 * `WorkflowExecutionService.createRun`), which is a real `User.id` and never the
 * caller's — so a `view` holder can never stop a schedule/record-event/webhook
 * run they did not start.
 *
 * The ownership read is skipped entirely when `edit` already answers yes, so the
 * common path costs no extra query.
 *
 * Shared by BOTH stop surfaces — `workflow.stopWorkflowRun` and the REST
 * `DELETE /api/workflows/[workflowId]/run` — so the two can never drift.
 * Callers must resolve `workflowAppId` from the run first (via
 * `assertWorkflowRunNotSystemOwned`), since instance access keys on the parent
 * app while the request only carries a run id.
 */
export async function mayStopWorkflowRun(params: {
  db: Database
  capabilities: CapabilityView
  runId: string
  workflowAppId: string
  organizationId: string
  userId: string
}): Promise<boolean> {
  const { db, capabilities, runId, workflowAppId, organizationId, userId } = params
  if (capabilities.canEditInstance('workflow', workflowAppId)) return true
  if (!capabilities.canViewInstance('workflow', workflowAppId)) return false
  // `null` (missing run, or a creator whose `User` row was deleted) can never
  // equal a caller's id, so the unowned case falls out of the comparison.
  return (await getWorkflowRunCreatorId(db, { runId, organizationId })) === userId
}
