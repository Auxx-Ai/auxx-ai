// packages/lib/src/mail-unsubscribe/unsubscribe-signal.ts
// The `mail:unsubscribed_from` signal write (§3, §6.4).
//
// ⚠️ INVARIANT 2 LIVES HERE. Our OUTBOUND unsubscribe is NEVER recorded as
// `contact:unsubscribed`. That kind means THEY unsubscribed from US, and
// `signals/unsubscribe.ts` upserts an org-wide SUPPRESSION row on it — reusing
// it would silence our own outbound mail to that address, a silent and
// hard-to-trace deliverability bug. The direction is opposite and so is the
// consequence. `mail:unsubscribed_from` is registered with `rollup: 'none'`
// precisely so it cannot move `unsubscribedAt` even by accident.

import { createScopedLogger } from '@auxx/logger'
import type { UnsubscribeMethod } from './client'
import { MAIL_UNSUBSCRIBED_FROM_SIGNAL_KIND } from './client'

const logger = createScopedLogger('mail-unsubscribe:signal')

export interface UnsubscribeSignalInput {
  organizationId: string
  /** The CRM contact the sender maps to. No contact ⇒ no signal (see below). */
  contactEntityInstanceId: string
  inboxId: string
  subjectKey: string
  method: UnsubscribeMethod
  threadId?: string | null
  messageId?: string | null
  /** Subject of the sample message — the timeline row's title. */
  title: string
}

/**
 * The exact `recordSignal` payload for one outbound unsubscribe. Pure, so a
 * test can assert the kind without a database.
 *
 * `dedupeKey` mirrors the `MailUnsubscribe` unique key: one signal per
 * (inbox, list) forever, so a retry after a partial failure re-runs the write
 * harmlessly instead of stacking timeline rows.
 */
export function buildUnsubscribeSignalInput(input: UnsubscribeSignalInput) {
  return {
    organizationId: input.organizationId,
    // NEVER 'contact:unsubscribed' — see the file header.
    kind: MAIL_UNSUBSCRIBED_FROM_SIGNAL_KIND,
    subtype: input.method,
    dedupeKey: `mail-unsub:${input.inboxId}:${input.subjectKey}`,
    contactEntityInstanceId: input.contactEntityInstanceId,
    threadId: input.threadId ?? undefined,
    messageId: input.messageId ?? undefined,
    title: input.title,
    metadata: { subjectKey: input.subjectKey, inboxId: input.inboxId, method: input.method },
    links: [`contact:${input.contactEntityInstanceId}`],
  }
}

/**
 * Write the signal, best-effort.
 *
 * The unsubscribe itself already happened — a POST went out, or a mail did — so
 * a failure here is logged and swallowed rather than surfaced: telling the user
 * "unsubscribe failed" after we successfully unsubscribed them would be a lie,
 * and retrying would re-POST a third party.
 *
 * `recordSignal` is imported dynamically: `signals/record-signal.ts` pulls the
 * events publisher and the rollup writer, and this module is on the router's
 * import path.
 */
export async function recordUnsubscribeSignal(input: UnsubscribeSignalInput): Promise<void> {
  try {
    const { recordSignal } = await import('../signals/record-signal')
    const result = await recordSignal(buildUnsubscribeSignalInput(input))
    if (!result.ok) {
      logger.warn('Failed to record mail:unsubscribed_from signal', {
        organizationId: input.organizationId,
        subjectKey: input.subjectKey,
        error: result.error.message,
      })
    }
  } catch (error) {
    logger.warn('Failed to record mail:unsubscribed_from signal', {
      organizationId: input.organizationId,
      subjectKey: input.subjectKey,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
