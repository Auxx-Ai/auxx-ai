// packages/credentials/src/passport/verify-passport.ts

import { jwtVerify } from 'jose'
import { err, ok, type Result } from 'neverthrow'
import { _getPassportJwtSecret } from './issue-passport'
import type {
  ChatPassportPayload,
  PassportError,
  PassportScope,
  VerifiedChatPassport,
  VerifiedWorkflowPassport,
  WorkflowPassportPayload,
} from './types'

type VerifiedForScope<S extends PassportScope> = S extends 'workflow'
  ? VerifiedWorkflowPassport
  : S extends 'chat'
    ? VerifiedChatPassport
    : never

/**
 * Verify a JWT passport token and assert its scope matches.
 *
 * @param token - JWT passport token
 * @param expectedScope - Required scope ('workflow' | 'chat')
 */
export async function verifyPassport<S extends PassportScope>(
  token: string,
  expectedScope: S
): Promise<Result<VerifiedForScope<S>, PassportError>> {
  try {
    const { payload } = await jwtVerify(token, _getPassportJwtSecret())

    if ((payload as { scope?: PassportScope }).scope !== expectedScope) {
      return err({
        code: 'INVALID_PASSPORT' as const,
        message: 'Invalid passport scope',
      })
    }

    if (expectedScope === 'workflow') {
      const p = payload as unknown as WorkflowPassportPayload
      const verified: VerifiedWorkflowPassport = {
        endUserId: p.sub,
        shareToken: p.shareToken,
        workflowId: p.workflowId,
        organizationId: p.organizationId,
        accessMode: p.accessMode,
        userId: p.userId,
        externalId: p.externalId,
      }
      return ok(verified as VerifiedForScope<S>)
    }

    const p = payload as unknown as ChatPassportPayload
    const verified: VerifiedChatPassport = {
      visitorParticipantId: p.sub,
      channelId: p.channelId,
      organizationId: p.organizationId,
      sessionId: p.sessionId,
    }
    return ok(verified as VerifiedForScope<S>)
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
