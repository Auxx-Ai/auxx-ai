// packages/credentials/src/passport/issue-workflow-passport.ts

import type { Result } from 'neverthrow'
import { issuePassport } from './issue-passport'
import type {
  IssueWorkflowPassportOptions,
  PassportError,
  WorkflowPassportPayload,
  WorkflowPassportResult,
} from './types'

/**
 * Issue a JWT passport for public workflow access.
 *
 * Thin wrapper around the generic {@link issuePassport} with `scope: 'workflow'`.
 */
export async function issueWorkflowPassport(
  options: IssueWorkflowPassportOptions
): Promise<Result<WorkflowPassportResult, PassportError>> {
  const {
    endUserId,
    shareToken,
    workflowId,
    organizationId,
    accessMode,
    userId,
    externalId,
    expiresIn,
  } = options

  return issuePassport<WorkflowPassportPayload>({
    scope: 'workflow',
    subjectId: endUserId,
    claims: {
      shareToken,
      workflowId,
      organizationId,
      accessMode,
      userId: userId || undefined,
      externalId: externalId || undefined,
    },
    expiresIn,
  })
}
