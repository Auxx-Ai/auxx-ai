// packages/lib/src/workflow-engine/core/pause-resume.ts

import { type ApprovalOutcome, isApprovalOutcome } from '../../approval-requests/client'
import { type PauseReason, type WorkflowNode, WorkflowNodeType } from './types'
import { type WorkflowGraph, WorkflowGraphHelper } from './workflow-graph-builder'

export type { ApprovalOutcome }

/**
 * Determine if a pause should terminate the entire workflow vs just the branch
 *
 * @param pauseReason - The reason for the pause
 * @param isInBranchContext - Whether the pause occurred within a parallel branch
 * @returns True if the pause should terminate the workflow, false if only the branch
 */
export function shouldPauseBeTerminal(
  pauseReason: PauseReason,
  isInBranchContext: boolean
): boolean {
  // Sequential execution pauses are always terminal
  if (!isInBranchContext) {
    return true
  }
  // In parallel execution, check pause type and configuration
  switch (pauseReason.type) {
    case 'human_confirmation':
      // Manual confirmations in branches are typically non-terminal
      // unless explicitly configured as terminal
      return pauseReason.metadata?.terminalPause ?? false
    case 'wait':
      // Wait nodes in branches are typically non-terminal
      // unless it's a very long wait or explicitly configured
      return pauseReason.metadata?.terminalPause ?? false
    default:
      // Default to non-terminal for branch context
      return pauseReason.metadata?.terminalPause ?? false
  }
}

/**
 * The resume payload every approval producer hands to `resumeWorkflow`.
 *
 * Three producers write it — a reviewer's decision
 * (`approval-requests/registry.ts`), the expiry job
 * (`jobs/workflow/approval-timeout-job.ts`) and an administrative cancel
 * (`approval-requests/approval-request-mutations.ts`) — and each names its
 * responder and timestamp after its own event. `outcome` is the ONE field they
 * all spell identically, in the {@link ApprovalOutcome} vocabulary.
 */
export interface ApprovalResumePayload {
  outcome?: unknown
  approvalRequestId?: string
  respondedBy?: string | null
  respondedAt?: string | null
  comment?: string | null
  timedOutAt?: string | null
  cancelledBy?: string | null
  cancelledAt?: string | null
  cancelReason?: string | null
}

/**
 * The branch handle an outcome routes to.
 *
 * Identity by construction: the node's three canvas handles
 * (`nodes/core/human/node.tsx`) ARE the outcome vocabulary. This function exists
 * so that stays a checked fact rather than a coincidence — and so an unknown
 * value falls to `source` instead of silently matching a handle.
 */
export function handleForApprovalOutcome(
  outcome: unknown
): 'approved' | 'denied' | 'timeout' | 'source' {
  return isApprovalOutcome(outcome) ? outcome : 'source'
}

/**
 * Get next nodes for human confirmation based on output
 *
 * @param node - The human confirmation node
 * @param nodeOutput - The output from the node execution
 * @param graph - The workflow graph
 * @returns Array of next node IDs to execute
 */
export function getHumanConfirmationNextNodes(
  node: WorkflowNode,
  nodeOutput: any,
  graph: WorkflowGraph
): string[] {
  const handle = handleForApprovalOutcome(nodeOutput?.outcome)
  return WorkflowGraphHelper.getNextNodes(graph, node.nodeId, handle).map((n) => n.nodeId)
}

/**
 * The five reviewer-decision variables the human-confirmation node advertises
 * (`apps/web/src/components/workflow/nodes/core/human/schema.ts`), derived from
 * one decision.
 *
 * Every key is always written — a denial writes an empty `approved_by` rather
 * than leaving the path unresolvable, so a downstream `{{node.approved_by}}`
 * reads as "nobody" instead of "Unknown Var".
 *
 * Lives here, beside the branch routing, because both answer the same question:
 * what a resume payload MEANS. The node processor calls it directly on the
 * test-mode path (which decides in-process); production decides after the node
 * has paused, so `WorkflowEngine.resumeExecution` applies it on the way back in —
 * the processor is never re-entered on resume.
 */
export function buildApprovalDecisionVariables(decision: {
  outcome: ApprovalOutcome
  respondedBy?: string | null
  respondedAt?: string | number | Date | null
  requestedAt?: string | number | Date | null
  comment?: string | null
}): Record<string, unknown> {
  const at = (value: string | number | Date | null | undefined): number | null => {
    if (value == null) return null
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
    return Number.isNaN(time) ? null : time
  }
  const requestedAt = at(decision.requestedAt)
  const respondedAt = at(decision.respondedAt)
  const approved = decision.outcome === 'approved'
  const denied = decision.outcome === 'denied'
  return {
    outcome: decision.outcome,
    approved_by: approved ? (decision.respondedBy ?? '') : '',
    denied_by: denied ? (decision.respondedBy ?? '') : '',
    response_time:
      requestedAt !== null && respondedAt !== null
        ? Math.max(0, Math.round((respondedAt - requestedAt) / 1000))
        : 0,
    response_message: decision.comment ?? '',
  }
}

/**
 * Normalize a resume payload into the five decision variables.
 *
 * Each producer names the responder and the timestamp after its own event
 * (`respondedBy`/`respondedAt`, `timedOutAt`, `cancelledBy`/`cancelledAt`);
 * this is the one place that knows all three spellings. Returns `null` for a
 * payload that carries no routable outcome — a `wait` resume, or a caller that
 * invented a fourth spelling.
 *
 * `requestedAt` comes from the node's OWN pause output (`requested_at`), not
 * from the payload: when the request was raised is the node's fact, and reading
 * it there makes `response_time` real for all three producers without each of
 * them having to remember to send it.
 */
export function approvalDecisionVariablesFromResume(
  payload: ApprovalResumePayload | undefined,
  requestedAt?: string | number | Date | null
): Record<string, unknown> | null {
  if (!payload || !isApprovalOutcome(payload.outcome)) return null
  return buildApprovalDecisionVariables({
    outcome: payload.outcome,
    respondedBy: payload.respondedBy ?? payload.cancelledBy ?? null,
    respondedAt: payload.respondedAt ?? payload.timedOutAt ?? payload.cancelledAt ?? null,
    requestedAt,
    comment: payload.comment ?? payload.cancelReason ?? null,
  })
}

/**
 * Get next nodes for wait node
 *
 * @param node - The wait node
 * @param nodeOutput - The output from the node execution
 * @param graph - The workflow graph
 * @returns Array of next node IDs to execute
 */
export function getWaitNodeNextNodes(
  node: WorkflowNode,
  nodeOutput: any,
  graph: WorkflowGraph
): string[] {
  const handle = nodeOutput?.timeout ? 'timeout' : 'source'
  return WorkflowGraphHelper.getNextNodes(graph, node.nodeId, handle).map((n) => n.nodeId)
}

/**
 * Get next nodes for conditional node
 *
 * @param node - The conditional (if-else) node
 * @param nodeOutput - The output from the node execution
 * @param graph - The workflow graph
 * @returns Array of next node IDs to execute
 */
export function getConditionalNextNodes(
  node: WorkflowNode,
  nodeOutput: any,
  graph: WorkflowGraph
): string[] {
  const handle = nodeOutput?.outputHandle || (nodeOutput?.result ? 'true' : 'false')
  return WorkflowGraphHelper.getNextNodes(graph, node.nodeId, handle).map((n) => n.nodeId)
}

/**
 * Determine next nodes to execute when resuming from a paused node
 *
 * @param node - The paused node being resumed
 * @param nodeOutput - The output from the resumed node
 * @param graph - The workflow graph
 * @returns Array of next node IDs to execute
 */
export function determineNextNodesForResume(
  node: WorkflowNode,
  nodeOutput: any,
  graph: WorkflowGraph
): string[] {
  // Special handling for specific node types
  switch (node.type) {
    case WorkflowNodeType.HUMAN_CONFIRMATION:
      return getHumanConfirmationNextNodes(node, nodeOutput, graph)
    case WorkflowNodeType.WAIT:
      return getWaitNodeNextNodes(node, nodeOutput, graph)
    case WorkflowNodeType.IF_ELSE:
      return getConditionalNextNodes(node, nodeOutput, graph)
    default: {
      // Standard output handle resolution
      const outputHandle = nodeOutput?.outputHandle || 'source'
      return WorkflowGraphHelper.getNextNodes(graph, node.nodeId, outputHandle).map((n) => n.nodeId)
    }
  }
}
