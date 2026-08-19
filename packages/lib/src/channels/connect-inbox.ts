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
import type { Inbox } from '../inboxes/types'

/**
 * The shared checks, applied to an already-resolved inbox.
 *
 * ⚠️ The two exported wrappers exist because these functions take DIFFERENT ID SPACES, and the
 * output of one is NOT valid input to the other. A `RecordId` is `"<defId>:<instanceId>"`, so
 * feeding this function's return value back into {@link assertSharedConnectInbox} double-prefixes
 * it (`inbox:inbox:abc`) and resolves nothing — reported to the user as the thoroughly misleading
 * "Inbox not found in this organization". Any two-phase flow that persists an inbox choice
 * between phases stores a RecordId and must re-validate with
 * {@link assertSharedConnectInboxByRecordId}.
 */
function assertShared(inbox: Inbox | null, organizationId: string): RecordId {
  if (!inbox || inbox.organizationId !== organizationId) {
    throw new BadRequestError('Inbox not found in this organization')
  }
  // SHARED-ONLY. `isPersonal` is def-derived (plan 40 §3.4): the lookup
  // resolves the instance's actual definition, so this rejects a
  // `personal_inbox` instance after data migration 060 and the legacy
  // `inbox_is_personal` marker before it — no def literal needed here.
  if (inbox.isPersonal) {
    throw new BadRequestError('A shared channel cannot be connected to a personal inbox')
  }
  return inbox.recordId
}

/**
 * Validate an inbox chosen for a SHARED channel connect and return its RecordId for linking.
 * Fail closed — a missing id, a cross-org inbox, or a personal inbox rejects the connect
 * (inside an OAuth hook this surfaces via the `oauth_error` redirect and no channel is created).
 *
 * Takes a bare `EntityInstance` id — what the connect UI forwards as `pc_inboxId`. It RETURNS a
 * RecordId, which is a different id space; see {@link assertShared}.
 */
export async function assertSharedConnectInbox(
  db: Database,
  organizationId: string,
  inboxId: string | null | undefined
): Promise<RecordId> {
  if (!inboxId) {
    throw new BadRequestError('Select an inbox before connecting this channel')
  }
  return assertShared(
    await new InboxService(db, organizationId).getInboxById(inboxId),
    organizationId
  )
}

/**
 * The same checks, addressed by RecordId — for re-validating a choice made in an earlier phase.
 *
 * A two-phase connect (which Facebook Page becomes the channel) parks the destination inbox on the
 * credential as a RecordId and links it only once the user has answered, so the inbox must be
 * checked again at that point: it could have been deleted, moved to another org, or turned
 * personal in between, and this must fail closed.
 */
export async function assertSharedConnectInboxByRecordId(
  db: Database,
  organizationId: string,
  recordId: RecordId | string | null | undefined
): Promise<RecordId> {
  if (!recordId) {
    throw new BadRequestError('Select an inbox before connecting this channel')
  }
  return assertShared(
    await new InboxService(db, organizationId).getInbox(recordId as RecordId),
    organizationId
  )
}
