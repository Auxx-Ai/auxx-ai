// packages/lib/src/channels/connect-inbox.ts
// Shared inbox validation for the channels-v2 inbox-first connect flow. Every shared
// (non-personal) channel connect chooses its destination inbox up-front in the UI and
// forwards it as `pc_inboxId` → the post-connect hook's `ctx.extra.inboxId`. The hook
// validates the inbox HERE, before it links the integration or seeds sync, so the first
// sync can never land mail in a wrong-visibility (or another org's) inbox.

import type { Database } from '@auxx/database'
import type { RecordId } from '@auxx/types/resource'
import { BadRequestError } from '../errors'
import { InboxService } from '../inboxes/inbox-service'

/**
 * Validate an inbox chosen for a SHARED channel connect and return its RecordId for linking.
 * Fail closed — a missing id, a cross-org inbox, or a personal inbox rejects the connect
 * (inside an OAuth hook this surfaces via the `oauth_error` redirect and no channel is created).
 */
export async function assertSharedConnectInbox(
  db: Database,
  organizationId: string,
  inboxId: string | null | undefined
): Promise<RecordId> {
  if (!inboxId) {
    throw new BadRequestError('Select an inbox before connecting this channel')
  }
  const inbox = await new InboxService(db, organizationId).getInboxById(inboxId)
  if (!inbox || inbox.organizationId !== organizationId) {
    throw new BadRequestError('Inbox not found in this organization')
  }
  if (inbox.isPersonal) {
    throw new BadRequestError('A shared channel cannot be connected to a personal inbox')
  }
  return inbox.recordId
}
