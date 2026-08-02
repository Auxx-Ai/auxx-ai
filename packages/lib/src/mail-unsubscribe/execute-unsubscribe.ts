// packages/lib/src/mail-unsubscribe/execute-unsubscribe.ts
// The three-tier unsubscribe executor (§6).
//
// ZERO permission checks (lib-module-guide §6). The router asserts §7.1 —
// personal inbox owned by the caller ⇒ ownership alone; shared inbox ⇒ inbox
// write authority and DELIBERATELY NOT `automationRules.manage` — and passes
// `isSharedInbox` in, which only drives the audit row. See
// `./unsubscribe-authority.ts` for the predicate the router calls.
//
// ⚠️ This is a ONE-SHOT COMMAND, never a `MailFilterAction` (S2 / invariant 1).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../errors'
import { guard } from './guard'
import { sendMailtoUnsubscribe } from './mailto-send'
import { postOneClickUnsubscribe } from './one-click-post'
import type { ExecuteUnsubscribeInput, ExecuteUnsubscribeOutcome } from './types'
import { upsertMailUnsubscribe } from './unsubscribe-mutations'
import { getMailUnsubscribe, resolveUnsubscribeTarget } from './unsubscribe-queries'
import { recordUnsubscribeSignal } from './unsubscribe-signal'

const logger = createScopedLogger('mail-unsubscribe')

/**
 * Unsubscribe one inbox from one bulk-mail group.
 *
 * The order is load-bearing:
 *
 * 1. **Already unsubscribed?** Short-circuit. The unique
 *    `(organizationId, inboxId, subjectKey)` index is the race-safe floor, but
 *    checking first is what stops us POSTing a third party twice.
 * 2. **Resolve the target and run the safety gate.** No `listId` and no
 *    `senderAuthenticated` ⇒ a typed REFUSAL (invariants 3 & 4), returned as an
 *    outcome rather than an error so the UI can render "block sender / filter to
 *    spam" instead of a failure toast.
 * 3. **Execute the tier chosen BY HEADER** (§6.1), never by provider:
 *    - `one-click` — we POST, server-side, hardened (`./one-click-post.ts`).
 *    - `http` — we POST NOTHING. The URL comes back as `openUrl` for the client
 *      to open in a new tab. A bare GET is usually a confirmation page, and
 *      POSTing an arbitrary URL on a user's behalf is not ours to do.
 *    - `mailto` — a real outbound send from that mailbox's own channel.
 * 4. **Record the row**, then the signal + audit.
 *
 * The `MailUnsubscribe` row is written AFTER the tier runs, so a failed POST
 * leaves no record claiming we unsubscribed. The `http` tier is the exception
 * worth naming: we record it as `requested` at the moment we hand the URL over,
 * because we will never learn whether the user completed it, and a row that only
 * appears on success would never appear at all.
 */
export async function executeUnsubscribe(
  db: Database,
  input: ExecuteUnsubscribeInput
): Promise<Result<ExecuteUnsubscribeOutcome, AuxxError>> {
  return guard(
    async () => {
      const existing = await getMailUnsubscribe(
        db,
        input.organizationId,
        input.inboxId,
        input.subjectKey
      )
      if (existing.isErr()) throw existing.error
      if (existing.value) {
        return { status: 'already-requested' as const, record: existing.value }
      }

      const targetResult = await resolveUnsubscribeTarget(
        db,
        input.organizationId,
        input.inboxId,
        input.subjectKey
      )
      if (targetResult.isErr()) throw targetResult.error
      const target = targetResult.value

      if (!target.offer.offered) {
        return { status: 'refused' as const, refusal: target.offer }
      }

      let openUrl: string | undefined

      switch (target.offer.method) {
        case 'one-click': {
          const posted = await postOneClickUnsubscribe(target.offer.httpUrl)
          if (!posted.accepted) {
            logger.warn('One-click unsubscribe endpoint rejected the request', {
              organizationId: input.organizationId,
              subjectKey: input.subjectKey,
              status: posted.status,
            })
          }
          break
        }
        case 'http':
          // Handed to the client. We never fetch it ourselves.
          openUrl = target.offer.httpUrl
          break
        case 'mailto':
          await sendMailtoUnsubscribe(db, {
            organizationId: input.organizationId,
            inboxId: input.inboxId,
            userId: input.userId,
            mailto: target.offer.mailto,
            preferredIntegrationId: target.integrationId,
          })
          break
      }

      const upserted = await upsertMailUnsubscribe(db, {
        organizationId: input.organizationId,
        inboxId: input.inboxId,
        subjectKey: input.subjectKey,
        method: target.offer.method,
        requestedByUserId: input.userId,
      })
      if (upserted.isErr()) throw upserted.error

      if (target.contactEntityInstanceId) {
        await recordUnsubscribeSignal({
          organizationId: input.organizationId,
          contactEntityInstanceId: target.contactEntityInstanceId,
          inboxId: input.inboxId,
          subjectKey: input.subjectKey,
          method: target.offer.method,
          threadId: target.threadId,
          messageId: target.messageId,
          title: target.subject ?? input.subjectKey,
        })
      }

      if (input.isSharedInbox) {
        await writeSharedInboxAudit(input, target.offer.method, target.senderIdentifier)
      }

      return {
        status: 'requested' as const,
        method: target.offer.method,
        ...(openUrl ? { openUrl } : {}),
        record: upserted.value,
      }
    },
    'executeUnsubscribe failed',
    { organizationId: input.organizationId, inboxId: input.inboxId, subjectKey: input.subjectKey }
  )
}

/** `AuditLog.action` for an unsubscribe on a SHARED inbox. Ad-hoc by design —
 * `AuditAction` keeps the `(string & {})` arm and the column is plain text. */
export const MAIL_UNSUBSCRIBE_AUDIT_ACTION = 'inbox.unsubscribed_from_list'

/**
 * Audit the shared-inbox case only (§6.4, invariant 11).
 *
 * A shared unsubscribe stops these emails for every colleague using that inbox,
 * none of whom saw the dialog — so it needs a name attached to it. A personal
 * inbox affects exactly the person who clicked, and auditing that would be noise
 * in the org's compliance feed.
 *
 * Best-effort: the unsubscribe already happened, so a failed audit write must
 * not turn a successful operation into an error the user retries.
 */
async function writeSharedInboxAudit(
  input: ExecuteUnsubscribeInput,
  method: string,
  senderIdentifier: string | null
): Promise<void> {
  try {
    const { recordAudit } = await import('../audit-log/record-audit')
    const result = await recordAudit({
      organizationId: input.organizationId,
      category: 'integrations',
      action: MAIL_UNSUBSCRIBE_AUDIT_ACTION,
      actorType: 'user',
      actorId: input.userId,
      targetType: 'inbox',
      targetId: input.inboxId,
      metadata: {
        subjectKey: input.subjectKey,
        method,
        ...(senderIdentifier ? { sender: senderIdentifier } : {}),
      },
      ...(input.auditContext ? { context: input.auditContext } : {}),
    })
    if (result.isErr()) {
      logger.warn('Failed to audit a shared-inbox unsubscribe', {
        organizationId: input.organizationId,
        inboxId: input.inboxId,
        error: result.error.message,
      })
    }
  } catch (error) {
    logger.warn('Failed to audit a shared-inbox unsubscribe', {
      organizationId: input.organizationId,
      inboxId: input.inboxId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
