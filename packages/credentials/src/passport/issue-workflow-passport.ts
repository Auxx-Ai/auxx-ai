// packages/credentials/src/passport/issue-workflow-passport.ts

import { SignJWT } from 'jose'
import { err, ok, type Result } from 'neverthrow'
import type {
  IssueWorkflowPassportOptions,
  PassportError,
  WorkflowPassportPayload,
  WorkflowPassportResult,
} from './types'

const JWT_SECRET = new TextEncoder().encode(
  process.env.PUBLIC_WORKFLOW_JWT_SECRET || 'public-workflow-secret-change-me'
)

const DEFAULT_EXPIRY = '7d'

/**
 * Issue JWT passport token for public workflow access
 *
 * @param options - Passport options
 * @returns Result with passport token or error
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
    expiresIn = DEFAULT_EXPIRY,
  } = options

  try {
    const payload: Omit<WorkflowPassportPayload, 'iat' | 'exp'> = {
      sub: endUserId,
      iss: 'auxx',
      type: 'workflow_passport',
      shareToken,
      workflowId,
      organizationId,
      accessMode,
      userId: userId || undefined,
      externalId: externalId || undefined,
    }

    const token = await new SignJWT(payload as Record<string, unknown>)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(JWT_SECRET)

    return ok({
      token,
      expiresIn,
      payload,
    })
  } catch (error) {
    return err({
      code: 'INVALID_PASSPORT' as const,
      message: `Failed to issue passport: ${(error as Error).message}`,
    })
  }
}
