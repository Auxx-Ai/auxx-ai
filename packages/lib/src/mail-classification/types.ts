// packages/lib/src/mail-classification/types.ts
// Server-side shapes for the classifier: the guard's verdict, the resolved
// context it hands to the call, and the call's outcome.

import type { MailClassificationLabel, MailClassificationSkipReason } from './client'

/** The message fields the prompt is built from (§3.2 — truncated, no history). */
export interface MailClassificationMessage {
  subject: string | null
  /** Sender identifier, taken from the `message:received` payload. */
  from: string | null
  textPlain: string | null
}

/** Everything past the guard, resolved once so the call re-reads nothing. */
export interface MailClassificationContext {
  organizationId: string
  messageId: string
  threadId: string
  inboxId: string
  /** Eligible, `thread`-scoped tags — the enum the model chooses from (Q1/Q3). */
  labels: MailClassificationLabel[]
  message: MailClassificationMessage
}

/**
 * The guard's verdict (§3.1). `proceed: false` is the overwhelmingly common
 * answer and is never an error — an org that never opts in exits at step 3
 * having issued zero queries.
 */
export type MailClassificationGate =
  | { proceed: false; reason: MailClassificationSkipReason }
  | { proceed: true; context: MailClassificationContext }

/**
 * One model call's outcome. `tagId` is null whenever nothing is to be applied —
 * the model declined, returned an id outside the eligible set, or landed below
 * {@link import('./client').MAIL_CLASSIFY_CONFIDENCE_THRESHOLD}.
 *
 * `confidence` is populated even when `tagId` is null: those are the most
 * informative rows for tuning the threshold (Q4).
 */
export interface MailClassificationResult {
  tagId: string | null
  confidence: number
  /** Set when nothing is applied, so the job's log line explains itself. */
  reason?: MailClassificationSkipReason
  model?: string
  /**
   * Did a model call COMPLETE and return an answer?
   *
   * ⚠️ This is the sole gate on stamping the C9 marker, and it is a field rather
   * than a check against {@link reason} on purpose: a new failure arm added to
   * that union must be forced to state its answer here, instead of inheriting
   * "stamp" by default. Inheriting the wrong default is precisely the bug this
   * flag replaced — `'error'` was stamped like a completed inference, so a
   * single provider 429 marked the message classified forever, having neither
   * classified it nor cost anything.
   *
   * True for an applied tag, and equally for a deliberate "apply nothing"
   * (`'below-threshold'`, `'no-category'`) — the answer was bought and re-asking
   * would pay twice for it. False for every path where `invoke` threw, because
   * usage is only metered against a response that actually came back.
   */
  inferred: boolean
}
