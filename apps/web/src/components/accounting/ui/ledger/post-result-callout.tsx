// apps/web/src/components/accounting/ui/ledger/post-result-callout.tsx

'use client'

import type { PostResult, PostResultStatus } from '@auxx/lib/accounting/ledger/client'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { CheckCircle2, CircleSlash, PlugZap, TriangleAlert, X } from 'lucide-react'
import type { ComponentType } from 'react'

export interface OutcomeCopy {
  icon: ComponentType<{ className?: string }>
  title: string
  detail: string
  /** Successes read as successes. Only a genuine failure gets the destructive treatment. */
  tone: 'success' | 'neutral' | 'failure'
}

/**
 * How each outcome reads.
 *
 * 🛑 `already_posted` and `not_connected` are SUCCESSES and must never render as
 * errors. `already_posted` is a converged re-run (the provider already held the
 * entry and nothing was sent), and logging a routine convergence as a failure
 * trains everyone to ignore the channel that a real double-post would arrive on.
 * `not_connected` is first-class by decision `P1`: an org with no accounting
 * system has its entry built, balanced and persisted identically
 * (13-accounting-ui.md §5.3).
 *
 * `disabled` is kept separate from `not_connected` on purpose: one is a setting
 * somebody can flip, the other is a missing integration, and merging them makes
 * the remedy unguessable from the record.
 *
 * 🛑 `nothing_to_close` and `setup_incomplete` are `neutral`, never `failure`
 * (14-drive-the-close.md §1.3). They are the two most ORDINARY things an
 * organization meets: a month in which nothing moved, and a setup still in
 * draft on day one. Both were previously reachable only as `error`, which is the
 * one tone reserved for something actually breaking. An org whose cutoff
 * predates its first movement walks through a run of `nothing_to_close`; the
 * console must skip them, not alarm on each one.
 */
export const OUTCOMES: Record<PostResultStatus, OutcomeCopy> = {
  posted: {
    icon: CheckCircle2,
    title: 'Posted',
    detail: 'Recorded here and pushed to the accounting system.',
    tone: 'success',
  },
  already_posted: {
    icon: CheckCircle2,
    title: 'Already posted',
    detail: 'The accounting system already held it, so nothing was sent. A converged re-run.',
    tone: 'success',
  },
  not_enabled: {
    icon: PlugZap,
    title: 'Nothing posted. Accounting is not enabled for this organization',
    detail: 'No entry was built or recorded. Enable the accounting module and run its setup.',
    tone: 'neutral',
  },
  // A SUCCESS, not a refusal: the entry holds no claim and no doc number by
  // design, because its avenue's `autoPost` setting is off. `postDraft`
  // promotes it - see the Drafts tab (step 1c).
  drafted: {
    icon: CheckCircle2,
    title: 'Saved as a draft',
    detail: 'Recorded here, held for review before it posts. Nothing in the books yet.',
    tone: 'neutral',
  },
  period_closed: {
    icon: TriangleAlert,
    title: 'Refused: the period is locked',
    detail: 'Nothing was written. Unlock the month before posting into it.',
    tone: 'failure',
  },
  account_unmapped: {
    icon: TriangleAlert,
    title: 'Refused: an account role is not mapped',
    detail: 'Nothing was written. The period was never claimed.',
    tone: 'failure',
  },
  unbalanced: {
    icon: TriangleAlert,
    title: 'Refused: the entry does not balance',
    detail: 'Nothing was written. A retry cannot change this answer.',
    tone: 'failure',
  },
  inventory_role_refused: {
    icon: TriangleAlert,
    title: 'Refused: a line names an inventory account',
    detail:
      'Nothing was written. The inventory accounts are asserted by the close, never hand-keyed.',
    tone: 'failure',
  },
  account_invalid: {
    icon: TriangleAlert,
    title: 'Refused: a line names an account the chart does not hold',
    detail: 'Nothing was written. Fix the code or restore the account named below.',
    tone: 'failure',
  },
  // 🛑 A refusal, and `failure`, but the sentence is about work rather than a
  // fault: the month is short of revenue somebody still has to post or void.
  // Nothing was written, and nothing is broken.
  revenue_incomplete: {
    icon: TriangleAlert,
    title: 'Refused: the month still holds revenue that is not in the books',
    detail:
      "Nothing was written. Post the shipments and issue or void this month's credit memos first.",
    tone: 'failure',
  },
  nothing_to_close: {
    icon: CircleSlash,
    title: 'Nothing to close',
    detail: 'No balance or activity total changed this month, so there is no entry to post.',
    tone: 'neutral',
  },
  nothing_to_recognise: {
    icon: CircleSlash,
    title: 'Nothing to post',
    detail: 'This document recognises nothing, so there is no entry to build. The reason follows.',
    tone: 'neutral',
  },
  setup_incomplete: {
    icon: PlugZap,
    title: 'Finish the accounting setup first',
    detail:
      'Nothing was written. There is no reconciled opening baseline to compute a delta against.',
    tone: 'neutral',
  },
  error: {
    icon: TriangleAlert,
    title: 'The post failed',
    detail: 'The reason follows, verbatim.',
    tone: 'failure',
  },
}

/** Washes echo the `Alert` tones; solid `bg-background` beneath so the row under it does not bleed through. */
const TONE_CLASS: Record<OutcomeCopy['tone'], string> = {
  success: 'bg-green-500/10 text-green-700 dark:text-green-400',
  neutral: 'bg-muted/80 text-foreground',
  failure: 'bg-destructive/10 text-destructive',
}

interface PostResultOverlayProps {
  result: PostResult
  onDismiss: () => void
}

/**
 * The provider result laid over the row it belongs to, so the list never
 * grows under it. The parent must be `relative`.
 */
export function PostResultOverlay({ result, onDismiss }: PostResultOverlayProps) {
  const copy = OUTCOMES[result.status]
  const Icon = copy.icon

  return (
    <div className='absolute inset-0 z-10 rounded-md bg-background'>
      <div
        className={cn(
          'flex size-full min-w-0 items-center gap-2 rounded-md px-2 text-sm',
          TONE_CLASS[copy.tone]
        )}>
        <Icon className='size-4 shrink-0' />
        <span className='shrink-0 font-medium'>{copy.title}</span>
        {result.docNumber && (
          <span className='shrink-0 font-mono text-xs opacity-70'>{result.docNumber}</span>
        )}
        {result.error && (
          <span className='min-w-0 truncate text-xs' title={result.error}>
            {result.error}
          </span>
        )}
        <Button
          variant='ghost'
          size='icon-xs'
          aria-label='Dismiss'
          className='ml-auto shrink-0'
          onClick={onDismiss}>
          <X />
        </Button>
      </div>
    </div>
  )
}
