// packages/credentials/src/passport/issue-chat-passport.ts

import type { Result } from 'neverthrow'
import { issuePassport } from './issue-passport'
import type {
  ChatPassportPayload,
  ChatPassportResult,
  IssueChatPassportOptions,
  PassportError,
} from './types'

const DEFAULT_CHAT_EXPIRY = '1h'

/**
 * Issue a JWT passport for a chat widget visitor.
 *
 * Chat passports expire faster than workflow passports (1h vs 7d) because
 * chat sessions churn faster and refreshing is cheap.
 */
export async function issueChatPassport(
  options: IssueChatPassportOptions
): Promise<Result<ChatPassportResult, PassportError>> {
  const {
    visitorParticipantId,
    channelId,
    organizationId,
    sessionId,
    identify,
    expiresIn = DEFAULT_CHAT_EXPIRY,
  } = options

  return issuePassport<ChatPassportPayload>({
    scope: 'chat',
    subjectId: visitorParticipantId,
    claims: {
      channelId,
      organizationId,
      sessionId,
      ...(identify ? { identify } : {}),
    },
    expiresIn,
  })
}
