// apps/web/src/components/mail-suggestions/ui/mail-suggestion-content.tsx

'use client'

import type { MailSuggestionEvidence } from '@auxx/lib/mail-suggestions/client'
import {
  describeMailSuggestion,
  describeSubjectKey,
  MAIL_SUGGESTION_KIND_LABELS,
} from '@auxx/lib/mail-suggestions/client'
import { Button } from '@auxx/ui/components/button'
import { ShieldBan, SquareArrowOutUpRight } from 'lucide-react'
import Link from 'next/link'
import type { MailSuggestionCard } from '../hooks/use-mail-suggestions'

/**
 * The parts of a suggestion card that are identical in the Approvals tab and on
 * the thread chip (§8.2 / §8.3). The chrome differs; the sentence must not.
 *
 * Every string here is built from the row's denormalized `evidence` — no query,
 * ever. That is the entire reason `evidence` exists (§4).
 */

/**
 * Why we would refuse to unsubscribe from this group (§6.2), or `null` when the
 * safety gate passes.
 *
 * The mining job only ever mints `kind: 'unsubscribe'` for a group that PASSED
 * this gate, so a card that reaches the refusal branch always arrives as
 * `auto-archive` — which is why an unsubscribe button we would refuse is never
 * rendered in the first place. This restates the gate for the *explanation*, not
 * as a second authority: the executor re-runs it against the freshest message on
 * every real attempt.
 */
export function unsubscribeRefusalReason(evidence: MailSuggestionEvidence): string | null {
  if (!evidence.listId && !evidence.senderAuthenticated) {
    return (
      'This sender has no mailing-list identity and is not authenticated, so unsubscribing would ' +
      'only confirm your address is live.'
    )
  }
  if (evidence.unsubscribeMethod === null) {
    return 'This sender publishes no unsubscribe address.'
  }
  return null
}

/** Which buttons this card offers, given what the caller is allowed to do. */
export interface MailSuggestionButtonSpec {
  /** The main answer: unsubscribe (+ filter), or just the filter. */
  primaryLabel: string | null
  primaryIsUnsubscribe: boolean
  /** "Just archive" — only offered beside an unsubscribe. */
  secondaryLabel: string | null
}

/**
 * The card never offers what the router would refuse: the filter half disappears
 * without filter-authoring rights, and the unsubscribe half only exists on a
 * card the mining job already cleared through the safety gate.
 */
export function mailSuggestionButtonSpec(
  suggestion: Pick<MailSuggestionCard, 'kind' | 'canAuthorFilter' | 'canUnsubscribe'>
): MailSuggestionButtonSpec {
  if (suggestion.canUnsubscribe) {
    return {
      primaryLabel: suggestion.canAuthorFilter ? 'Unsubscribe & archive' : 'Unsubscribe',
      primaryIsUnsubscribe: true,
      secondaryLabel: suggestion.canAuthorFilter ? 'Just archive' : null,
    }
  }
  return {
    primaryLabel: suggestion.canAuthorFilter ? MAIL_SUGGESTION_KIND_LABELS[suggestion.kind] : null,
    primaryIsUnsubscribe: false,
    secondaryLabel: null,
  }
}

/** *"**Stripe updates** · 34 emails in 90 days · none opened · never replied"* */
export function MailSuggestionSummary({ suggestion }: { suggestion: MailSuggestionCard }) {
  return (
    <>
      <span className='font-medium text-foreground'>
        {describeSubjectKey(suggestion.subjectKey)}
      </span>
      <span className='text-muted-foreground'>
        {' '}
        · {describeMailSuggestion(suggestion.evidence)}
      </span>
    </>
  )
}

/**
 * The block-sender alternative, and the `http` tier's fallback link.
 *
 * Prevention lives one step earlier than a filter — a blocked sender's mail never
 * lands at all — so the refusal branch cross-links the "Blocked senders" card in
 * channel settings (filters plan §3.5) instead of pretending a filter is the same
 * thing.
 */
export function MailSuggestionNotice({
  suggestion,
  refusal,
  pendingOpenUrl,
  onBlockSender,
  isBlocking,
}: {
  suggestion: MailSuggestionCard
  /** A refusal the server returned just now, which wins over the derived one. */
  refusal?: string | null
  pendingOpenUrl?: string | null
  /** Omitted when the caller may not manage the channel — the button then hides. */
  onBlockSender?: () => void
  isBlocking?: boolean
}) {
  const reason =
    refusal ?? (suggestion.canUnsubscribe ? null : unsubscribeRefusalReason(suggestion.evidence))

  if (!reason && !pendingOpenUrl) return null

  return (
    <div className='mt-1.5 flex flex-col gap-1.5 rounded-md border border-border bg-muted/60 p-2 text-muted-foreground text-xs leading-5'>
      {reason ? (
        <div className='flex flex-col gap-1.5'>
          <div className='flex items-start gap-1.5'>
            <ShieldBan className='mt-0.5 size-3.5 shrink-0' />
            <span>{reason}</span>
          </div>
          {/* One click blocks the specific FROM-ADDRESS on the channel, never the
              group's domain: the refusal branch is dominated by consumer mail
              (gmail/outlook/yahoo), where a domain block would stop customers too.
              Blocking is prevention — it runs before the write, so the mail stops
              becoming a thread at all — hence the destructive confirm upstream. */}
          {onBlockSender ? (
            <Button
              variant='outline'
              size='sm'
              className='self-start'
              loading={isBlocking}
              loadingText='Blocking...'
              onClick={onBlockSender}>
              <ShieldBan />
              Block this sender
            </Button>
          ) : (
            <span>
              <Link
                href='/app/settings/channels'
                className='text-foreground underline underline-offset-2'>
                Block it on the channel
              </Link>{' '}
              to stop accepting it at all.
            </span>
          )}
        </div>
      ) : null}
      {pendingOpenUrl ? (
        <Button asChild variant='outline' size='sm' className='self-start'>
          <a href={pendingOpenUrl} target='_blank' rel='noopener noreferrer'>
            <SquareArrowOutUpRight />
            Open the unsubscribe page
          </a>
        </Button>
      ) : null}
    </div>
  )
}
