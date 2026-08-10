// packages/lib/src/mail-unsubscribe/execute-unsubscribe.ts
// The three-tier unsubscribe executor (§6).
//
// ZERO permission checks (lib-module-guide §6). The router asserts §7.1 —
// personal inbox owned by the caller ⇒ ownership alone; shared inbox ⇒ inbox
// READ authority and DELIBERATELY NOT `automationRules.manage` — and passes
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
import type {
  ExecuteUnsubscribeInput,
  ExecuteUnsubscribeOutcome,
  MailUnsubscribeRow,
  SynchronousUnsubscribeStatus,
} from './types'
import { setMailUnsubscribeStatus, upsertMailUnsubscribe } from './unsubscribe-mutations'
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
 *    checking first is what stops us POSTing a third party twice. A `failed`
 *    row is the one that does NOT short-circuit — see below.
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
 * 4. **Record the row**, stamp the tier's verdict on it, then the signal + audit.
 *
 * **The returned status is what the tier actually achieved**, not a blanket "we
 * asked". Only tier 1 gets an acknowledgement, so only tier 1 can reach a
 * terminal state synchronously: 2xx ⇒ `confirmed`, anything else ⇒ `failed`.
 * `http` and `mailto` have nothing that answers them and stay `requested`. A
 * rejected POST recorded as `requested` is what made a sender answering 410
 * indistinguishable from one that honored us.
 *
 * A `failed` row is deliberately RETRYABLE: the short-circuit in step 1 skips
 * it, because we never got through, so a second attempt is a first request
 * rather than a duplicate — the upsert's conflict branch already documents the
 * `failed → requested` upgrade as the case worth reflecting.
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
      // A `failed` row means the endpoint REFUSED us, so nothing was ever
      // requested and re-offering is correct. Every other status did reach the
      // sender (or is the sweep's verdict on one that did), and asking twice is
      // what the short-circuit exists to prevent.
      if (existing.value && existing.value.status !== 'failed') {
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
      /**
       * What the tier achieved. `requested` is the floor and the only answer
       * tiers 2 and 3 can give: neither is acknowledged, so claiming anything
       * stronger would be a guess.
       */
      let status: SynchronousUnsubscribeStatus = 'requested'

      switch (target.offer.method) {
        case 'one-click': {
          const posted = await postOneClickUnsubscribe(target.offer.httpUrl)
          status = posted.accepted ? 'confirmed' : 'failed'
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
      const record =
        status === 'requested'
          ? upserted.value
          : await stampTerminalStatus(db, input, upserted.value, status)

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
        status,
        method: target.offer.method,
        ...(openUrl ? { openUrl } : {}),
        record,
      }
    },
    'executeUnsubscribe failed',
    { organizationId: input.organizationId, inboxId: input.inboxId, subjectKey: input.subjectKey }
  )
}

/**
 * Stamp tier 1's verdict onto the row the upsert just created.
 *
 * **A separate write, on purpose.** The upsert is the RACE-SAFE FLOOR — the
 * `(organizationId, inboxId, subjectKey)` uniqueness is what stops two tabs
 * POSTing a third party twice — and it must still fail loudly when it cannot
 * write, because a missing row is a real failure. This is BOOKKEEPING layered on
 * an operation that already happened: the POST went out and the sender already
 * answered. So it is best-effort, the same posture as
 * {@link writeSharedInboxAudit} — a failed status write must not turn a
 * completed attempt into an error the user retries.
 *
 * The caller still reports the real status either way. The endpoint's answer is
 * the truth about the attempt whether or not we managed to persist it; only the
 * returned `record` falls back to the un-stamped row.
 */
async function stampTerminalStatus(
  db: Database,
  input: ExecuteUnsubscribeInput,
  record: MailUnsubscribeRow,
  status: SynchronousUnsubscribeStatus
): Promise<MailUnsubscribeRow> {
  try {
    const updated = await setMailUnsubscribeStatus(db, input.organizationId, record.id, status)
    if (updated.isOk()) return updated.value
    logger.warn('Failed to record the unsubscribe outcome', {
      organizationId: input.organizationId,
      inboxId: input.inboxId,
      subjectKey: input.subjectKey,
      status,
      error: updated.error.message,
    })
  } catch (error) {
    logger.warn('Failed to record the unsubscribe outcome', {
      organizationId: input.organizationId,
      inboxId: input.inboxId,
      subjectKey: input.subjectKey,
      status,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return record
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
