// packages/credentials/src/passport/verify-chat-passport.ts

import type { Result } from 'neverthrow'
import type { PassportError, VerifiedChatPassport } from './types'
import { verifyPassport } from './verify-passport'

/**
 * Verify a chat-scoped JWT passport token.
 *
 * Thin wrapper around the generic {@link verifyPassport} that asserts `scope === 'chat'`.
 */
export async function verifyChatPassport(
  token: string
): Promise<Result<VerifiedChatPassport, PassportError>> {
  return verifyPassport(token, 'chat')
}
