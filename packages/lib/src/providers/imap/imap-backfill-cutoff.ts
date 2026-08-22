// packages/lib/src/providers/imap/imap-backfill-cutoff.ts
//
// The consume half of the received-time backfill cutoff for IMAP channels —
// the same contract Google/Outlook arm in their `initialize()` and the social
// providers resolve via `resolveSocialBackfillCutoff`. Like the social
// resolver (#1721), this FAILS CLOSED: a channel with neither
// `metadata.backfillCutoffAt` nor `metadata.initialBackfillCompletedAt` gets a
// cutoff of "now" rather than no suppression at all. The two failure modes are
// not symmetric — suppressing when we did not need to costs missed trigger
// fires on messages that are history by definition; not suppressing when we
// needed to fires thousands of workflow runs and billed classifications at
// real customer mail.

/** What `ImapProvider.initialize` should do about the backfill window. */
export interface ImapBackfillWindow {
  /**
   * The received-time cutoff to arm on the storage service, or `null` when the
   * initial backfill has completed (only an explicit
   * `initialBackfillCompletedAt` opens the gate).
   */
  cutoff: Date | null
  /**
   * True when the channel had NEITHER stamp and the computed "now" cutoff must
   * be written back onto `Integration.metadata`. A merely-computed cutoff would
   * drift forward on every `initialize()` — suppressing mail that arrived
   * between poll cycles — and the completion stamp
   * (`stampInitialBackfillCompleted`) is guarded on `backfillCutoffAt`
   * existing, so an unstamped window could never close (the #1587 incident
   * class). The caller stamps it durably, after which the window closes at the
   * next full drain.
   */
  needsDurableStamp: boolean
}

/**
 * Resolve the backfill window from `Integration.metadata`. Pure — the caller
 * owns the durable stamp write when `needsDurableStamp` is set.
 */
export function resolveImapBackfillCutoff(metadata: unknown): ImapBackfillWindow {
  const meta =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {}
  if (meta.initialBackfillCompletedAt) return { cutoff: null, needsDurableStamp: false }
  if (typeof meta.backfillCutoffAt === 'string' && meta.backfillCutoffAt) {
    return { cutoff: new Date(meta.backfillCutoffAt), needsDurableStamp: false }
  }
  return { cutoff: new Date(), needsDurableStamp: true }
}
