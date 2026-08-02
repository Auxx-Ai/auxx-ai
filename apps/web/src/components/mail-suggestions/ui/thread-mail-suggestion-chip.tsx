// apps/web/src/components/mail-suggestions/ui/thread-mail-suggestion-chip.tsx

'use client'

import { describeSubjectKey } from '@auxx/lib/mail-suggestions/client'
import { Button } from '@auxx/ui/components/button'
import { Sparkles, X } from 'lucide-react'
import { useMailSuggestionActions } from '../hooks/use-mail-suggestion-actions'
import { type MailSuggestionCard, useMailSuggestions } from '../hooks/use-mail-suggestions'
import { MailSuggestionNotice, mailSuggestionButtonSpec } from './mail-suggestion-content'

/**
 * The in-context suggestion chip — *"You've never opened the last 12 of these"*
 * (plans/mail-filter/03-suggestions-plan.md §8.3, phase E).
 *
 * It converts better than the panel because it appears at the moment of
 * annoyance, which is exactly why it has to be **gated hard**:
 *
 * - **Only above threshold.** There is no separate rule here at all — the chip
 *   renders only when the weekly mining job already wrote a card for this
 *   thread's group, so every threshold and every suppression rule (one reply
 *   ever ⇒ nothing, already filtered ⇒ nothing, capped at five per inbox) is
 *   inherited rather than restated.
 * - **Only once per `subjectKey`.** A group can carry several cards (an
 *   unsubscribe *and* an auto-tag); the thread shows one, and unsubscribe wins.
 * - **Dismissible forever.** Dismiss writes the source row's status, which is
 *   the same permanent suppression the panel's Dismiss performs — not a local
 *   "hide for now".
 *
 * Reads the same cached list the panel does and matches on the evidence's own
 * `sampleThreadIds`, so a chip costs no query beyond the one the badge already
 * makes.
 */
export function ThreadMailSuggestionChip({ threadId }: { threadId: string }) {
  const { data } = useMailSuggestions()
  const suggestion = pickForThread(data, threadId)
  if (!suggestion) return null
  return <Chip key={suggestion.id} suggestion={suggestion} />
}

/** Unsubscribe wins when a group carries more than one card. */
function pickForThread(
  suggestions: MailSuggestionCard[] | undefined,
  threadId: string
): MailSuggestionCard | null {
  const matches = (suggestions ?? []).filter((row) =>
    row.evidence.sampleThreadIds.includes(threadId)
  )
  if (matches.length === 0) return null
  return matches.find((row) => row.canUnsubscribe) ?? matches[0] ?? null
}

function Chip({ suggestion }: { suggestion: MailSuggestionCard }) {
  const actions = useMailSuggestionActions(suggestion)
  const { ConfirmDialog } = actions
  const spec = mailSuggestionButtonSpec(suggestion)
  const subject = describeSubjectKey(suggestion.subjectKey)
  const { threadCount, unreadRate } = suggestion.evidence

  const headline =
    unreadRate >= 0.999
      ? `You've never opened the last ${threadCount} of these`
      : `You've left ${Math.round(unreadRate * 100)}% of the last ${threadCount} from ${subject} unread`

  return (
    <div className='flex flex-col gap-1.5 rounded-lg border border-border bg-secondary/40 px-2.5 py-2 text-xs sm:flex-row sm:items-center sm:gap-2'>
      <div className='flex min-w-0 flex-1 items-start gap-1.5'>
        <Sparkles className='mt-0.5 size-3.5 shrink-0 text-muted-foreground' />
        <div className='min-w-0'>
          <p className='text-foreground leading-5'>
            {headline}
            {unreadRate >= 0.999 ? (
              <span className='text-muted-foreground'> · {subject}</span>
            ) : null}
          </p>
          <MailSuggestionNotice
            suggestion={suggestion}
            refusal={actions.refusal}
            pendingOpenUrl={actions.pendingOpenUrl}
            onBlockSender={actions.runBlockSender}
            isBlocking={actions.isBlocking}
          />
        </div>
      </div>
      <div className='flex shrink-0 items-center gap-1 self-end sm:self-auto'>
        {spec.secondaryLabel ? (
          <Button
            variant='ghost'
            size='sm'
            disabled={actions.isPending}
            onClick={actions.runAccept}>
            {spec.secondaryLabel}
          </Button>
        ) : null}
        {spec.primaryLabel ? (
          <Button
            variant='outline'
            size='sm'
            loading={actions.isPending}
            loadingText='Working...'
            onClick={
              spec.primaryIsUnsubscribe ? actions.runUnsubscribeAndArchive : actions.runAccept
            }>
            {spec.primaryLabel}
          </Button>
        ) : null}
        <Button
          variant='ghost'
          size='icon-sm'
          disabled={actions.isPending}
          onClick={actions.runDismiss}>
          <X />
          <span className='sr-only'>Dismiss this suggestion</span>
        </Button>
      </div>

      <ConfirmDialog />
    </div>
  )
}
