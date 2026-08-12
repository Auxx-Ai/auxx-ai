// packages/lib/src/approval-requests/registry.ts

import { createScopedLogger } from '@auxx/logger'
import { BadRequestError } from '../errors'
import { outcomeForAction } from './client'
import type { ApprovalKind, ApprovalKindHandler, ApprovalResolveContext } from './types'

const logger = createScopedLogger('approval-requests')

/**
 * Kind → handler. This is the seam that keeps the approval spine kind-agnostic:
 * the resolve path claims the decision and writes the `ApprovalResponse` row, then
 * hands off, so neither kind's side effect is spelled out in the shared code.
 *
 * Two properties are worth stating because they are the reason this is a registry
 * and not two `if` branches:
 *
 * 1. **`allowsTokenResolution` is a property of the KIND** (plan 28 H5). The
 *    unauthenticated approve-by-email-link lane is correct for a workflow
 *    human-confirmation and an escalation hole for a permission grant. Expressed
 *    as data, a future third kind cannot forget to opt out; expressed as a
 *    hand-written `if` in the router, it can.
 * 2. **Every handler's imports are LAZY.** `workflow` reaches
 *    `WorkflowExecutionService`, which imports this module's queries back — the
 *    cycle the deleted `// Removed ApprovalResponseService export to avoid
 *    circular dependency` comment in `workflow-engine/index.ts` was working
 *    around. `access` reaches the whole permissions/resource-access graph. Both
 *    stay out of this module's static graph.
 */
const HANDLERS: Record<ApprovalKind, ApprovalKindHandler> = {
  workflow: {
    kind: 'workflow',
    allowsTokenResolution: true,
    async onResolved(ctx: ApprovalResolveContext) {
      const { request, action, approverUserId, comment, tx } = ctx
      // Non-null by `ApprovalRequest_workflow_columns_check`: a `kind='workflow'`
      // row always carries its run, and the confirmation node writes `nodeId` in
      // the same insert.
      if (!request.workflowRunId || !request.nodeId) {
        throw new BadRequestError('Workflow approval request is missing its workflow run')
      }
      const { WorkflowExecutionService } = await import('../workflows/workflow-execution-service')
      const executionService = new WorkflowExecutionService(tx as never)
      try {
        await executionService.resumeWorkflow(request.workflowRunId, request.nodeId, {
          // The reviewer's VERB becomes the request's OUTCOME here, and only here.
          // `action` ('approve'/'deny') is the API input and the
          // `ApprovalResponse.action` column; everything downstream of a decision
          // — branch handles, the `outcome` variable, the run's resume reason —
          // speaks `ApprovalOutcome` ('approved'/'denied'/'timeout').
          outcome: outcomeForAction(action),
          approvalRequestId: request.id,
          respondedBy: approverUserId,
          respondedAt: new Date().toISOString(),
          comment,
        })
      } catch (resumeError) {
        logger.error('Failed to resume workflow after approval', {
          approvalRequestId: request.id,
          workflowRunId: request.workflowRunId,
          error: resumeError instanceof Error ? resumeError.message : String(resumeError),
        })
        // Re-throw to roll back the whole decision — including the status claim.
        throw new Error(
          `Failed to resume workflow: ${resumeError instanceof Error ? resumeError.message : 'Unknown error'}`
        )
      }
      return { message: `Workflow ${action}d successfully` }
    },
  },
  access: {
    kind: 'access',
    // NEVER. A permission grant must not be reachable from an unauthenticated
    // email link (plan 28 H5).
    allowsTokenResolution: false,
    async onResolved(ctx: ApprovalResolveContext) {
      const { applyAccessDecision } = await import('./access-request-mutations')
      return applyAccessDecision(ctx)
    },
  },
}

/** The handler for one kind. Unknown kinds refuse rather than defaulting. */
export function getApprovalKindHandler(kind: string): ApprovalKindHandler {
  const handler = (HANDLERS as Record<string, ApprovalKindHandler | undefined>)[kind]
  if (!handler) {
    throw new BadRequestError(`Unsupported approval kind "${kind}"`)
  }
  return handler
}

/** Whether the unauthenticated email-token lane may resolve this kind (H5). */
export function allowsTokenResolution(kind: string): boolean {
  return getApprovalKindHandler(kind).allowsTokenResolution
}
