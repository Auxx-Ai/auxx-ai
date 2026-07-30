// packages/lib/src/approval-requests/index.ts

/**
 * `ApprovalRequest` / `ApprovalResponse` — the shared approval spine, for BOTH
 * kinds (`workflow` human-confirmations and `access` permission requests).
 *
 * Server entrypoint for `@auxx/lib/approval-requests`. This module REPLACES
 * `workflow-engine/services/approval-{query,response}-service.ts`, whose class shape
 * was debt (module guide §2) and whose home was wrong once the table served two
 * kinds: the access lane would have had to import the workflow engine to answer
 * "what is pending for me", and the workflow engine would have had to import the
 * permissions grant services to resolve an access request. The
 * `// Removed ApprovalResponseService export to avoid circular dependency` comment
 * at `workflow-engine/index.ts` was that cycle, worked around rather than removed.
 *
 * **Do not confuse this with `packages/lib/src/approvals/`.** That module owns
 * Kopilot proposed-action bundles / headless-suggestion approvals — a different
 * domain with no `kind` discriminator and no relationship to this table. The
 * distinct name is the point.
 *
 * **No permission logic lives behind this barrel** (module guide §6). The router
 * asserts approval-audience membership and then calls. The ONE assert inside is
 * `applyAccessDecision`'s `assertCanManageMailSharing` revalidation, which is an
 * integrity requirement of the grant it writes: it has to run in the same
 * transaction as the decision claim, so a router-level check could not replace it
 * (plan 42 §3 — the assignee snapshot must never become an authorization token).
 */

export {
  applyAccessDecision,
  createThreadAccessRequest,
  withdrawAccessRequest,
} from './access-request-mutations'
export {
  buildThreadSubjectLabel,
  findPendingThreadAccessRequest,
  findThreadDenyCooldown,
  getThreadAccessRequestApproverView,
  loadThreadAuthorityContext,
  preflightThreadAccessRequest,
  resolveThreadApprovers,
  resolveThreadFrontDoor,
  threadLensFromContext,
} from './access-request-queries'
export { approvalEmailEnabled, getApprovalAssigneeUserIds } from './approval-recipients'
export {
  cancelApprovalRequest,
  cleanupApprovalsForWorkflowRun,
  cleanupExpiredApprovals,
  cleanupOrphanedApprovals,
  generateApprovalToken,
  generateApprovalTokens,
  resolveApprovalByToken,
  resolveApprovalRequest,
  resolveApprovalRequests,
  validateApprovalToken,
} from './approval-request-mutations'
export {
  canUserApprove,
  canUserViewApproval,
  getApprovalMetrics,
  getApprovalRequestById,
  getApprovalRequestWithContext,
  getApprovalsByStatus,
  getPendingApprovalsForUser,
  getPendingApprovers,
  getPendingCount,
  getUserApprovalStats,
  getWorkflowApprovalHistory,
} from './approval-request-queries'
export type {
  AccessLens,
  AccessRefusalReason,
  AccessRequestMetadata,
  AccessTargetKind,
  ApprovalKind,
} from './client'
export {
  ACCESS_DENY_COOLDOWN_DAYS,
  ACCESS_REFUSAL_COPY,
  ACCESS_REQUEST_EXPIRY_DAYS,
  ACCESS_TARGET_KINDS,
  APPROVAL_KINDS,
} from './client'
export { allowsTokenResolution, getApprovalKindHandler } from './registry'
export type {
  AccessRequestApproverView,
  AccessRequestPreflight,
  ApprovalAudience,
  ApprovalKindHandler,
  ApprovalRequestEntity,
  ApprovalResolveContext,
  ApprovalResponseResult,
  CreateAccessRequestResult,
  CreateThreadAccessRequestInput,
  ThreadApproverResolution,
  ThreadAuthorityContext,
} from './types'
