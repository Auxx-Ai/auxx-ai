// packages/credentials/src/passport/verify-workflow-passport.ts

import { jwtVerify } from 'jose'
import { err, ok, type Result } from 'neverthrow'
import { configService } from '../config'
import type { PassportError, VerifiedPassport, WorkflowPassportPayload } from './types'

/**
 * Verify JWT passport token
 *
 * @param token - JWT passport token
 * @returns Result with verified passport data or error
 */
export async function verifyWorkflowPassport(
  token: string
): Promise<Result<VerifiedPassport, PassportError>> {
  try {
    const jwtSecret = new TextEncoder().encode(
      configService.get<string>('PUBLIC_WORKFLOW_JWT_SECRET') || 'public-workflow-secret-change-me'
    )

    const { payload } = await jwtVerify(token, jwtSecret)

    if (payload.type !== 'workflow_passport') {
      return err({
        code: 'INVALID_PASSPORT' as const,
        message: 'Invalid passport type',
      })
    }

    const p = payload as unknown as WorkflowPassportPayload

    return ok({
      endUserId: p.sub,
      shareToken: p.shareToken,
      workflowId: p.workflowId,
      organizationId: p.organizationId,
      accessMode: p.accessMode,
      userId: p.userId,
      externalId: p.externalId,
    })
  } catch (error) {
    const errorMessage = (error as Error).message

    if (errorMessage.includes('expired')) {
      return err({
        code: 'PASSPORT_EXPIRED' as const,
        message: 'Passport has expired',
      })
    }

    return err({
      code: 'INVALID_PASSPORT' as const,
      message: `Invalid passport: ${errorMessage}`,
    })
  }
}
