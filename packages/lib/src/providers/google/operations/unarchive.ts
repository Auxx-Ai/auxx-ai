// packages/lib/src/providers/google/operations/unarchive.ts

import { createScopedLogger } from '@auxx/logger'
import type { gmail_v1 } from 'googleapis'
import type { UniversalThrottler } from '../../../utils/rate-limiter'
import { modifyWithThrottling } from '../shared/utils'

const logger = createScopedLogger('google-unarchive')

/**
 * Unarchive a Gmail message or thread — put it back in the inbox. Also clears
 * SPAM and TRASH so reopen-from-spam/trash lands in the inbox. If Gmail ever
 * rejects removing TRASH via modify on an actually-trashed thread, the
 * fallback is threads.untrash first (see impl plan §2a) — restore()'s untrash
 * step, NOT restore() itself, which adds UNREAD (wrong for a status push).
 *
 * Unlike the legacy boolean operations (archive/trash/restore), this THROWS on
 * failure so the thread status-sync job can classify 404 / auth / rate-limit.
 */
export async function unarchive(
  gmail: gmail_v1.Gmail,
  externalId: string,
  type: 'message' | 'thread',
  integrationId: string,
  throttler: UniversalThrottler
): Promise<void> {
  logger.debug(`Unarchiving Gmail ${type}: ${externalId}`)
  await modifyWithThrottling(
    gmail,
    type,
    externalId,
    { addLabelIds: ['INBOX'], removeLabelIds: ['SPAM', 'TRASH'] },
    integrationId,
    throttler
  )
}
