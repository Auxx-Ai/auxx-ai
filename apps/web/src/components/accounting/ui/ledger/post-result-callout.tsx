// apps/web/src/components/accounting/ui/ledger/post-result-callout.tsx

'use client'

import type { PostResult, PostResultStatus } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { CheckCircle2, CircleSlash, ExternalLink, PlugZap, TriangleAlert } from 'lucide-react'
import type { ComponentType } from 'react'
import { fixtureProviderEntryUrl } from '~/components/accounting/fixtures'

interface OutcomeCopy {
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
 */
const OUTCOMES: Record<PostResultStatus, OutcomeCopy> = {
  posted: {
    icon: CheckCircle2,
    title: 'Posted',
    detail: 'The entry was recorded here and pushed to the accounting system.',
    tone: 'success',
  },
  already_posted: {
    icon: CheckCircle2,
    title: 'Already posted',
    detail:
      'The accounting system already held this entry, so nothing was sent. A converged re-run, not a failure.',
    tone: 'success',
  },
  healed: {
    icon: CheckCircle2,
    title: 'Reconciled with the accounting system',
    detail:
      'The provider held the entry but our record of its id did not. The id was written back rather than posting a second time.',
    tone: 'success',
  },
  not_connected: {
    icon: PlugZap,
    title: 'Posted. No accounting system is connected',
    detail:
      'The entry is built, balanced and recorded here exactly as it would be with a provider. There is simply nowhere to push it.',
    tone: 'success',
  },
  disabled: {
    icon: CircleSlash,
    title: 'Posted. Export is switched off',
    detail:
      'An accounting system is connected but export is turned off at the integration. The entry is recorded here.',
    tone: 'neutral',
  },
  period_closed: {
    icon: TriangleAlert,
    title: 'Refused: the period is locked',
    detail: 'Nothing was written. The month must be unlocked before it can be posted into.',
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
  error: {
    icon: TriangleAlert,
    title: 'The post failed',
    detail: 'The reason is below, verbatim.',
    tone: 'failure',
  },
}

const TONE_CLASS: Record<OutcomeCopy['tone'], string> = {
  success: 'border-green-500/40 bg-green-500/5',
  neutral: 'border-border bg-muted/40',
  failure: 'border-destructive/40 bg-destructive/5',
}

const TONE_ICON_CLASS: Record<OutcomeCopy['tone'], string> = {
  success: 'text-green-600 dark:text-green-400',
  neutral: 'text-muted-foreground',
  failure: 'text-destructive',
}

interface PostResultCalloutProps {
  result: PostResult
  providerLabel: string
}

/**
 * The provider result, inline with the entry it belongs to.
 *
 * Two systems that never link to each other is how reconciliation becomes
 * copy-paste, so a posted entry carries a deep link straight into the
 * provider's own register (gap-g §3).
 */
export function PostResultCallout({ result, providerLabel }: PostResultCalloutProps) {
  const copy = OUTCOMES[result.status]
  const Icon = copy.icon

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start',
        TONE_CLASS[copy.tone]
      )}>
      <Icon className={cn('mt-0.5 size-5 shrink-0', TONE_ICON_CLASS[copy.tone])} />
      <div className='flex min-w-0 flex-1 flex-col gap-1'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='font-medium'>{copy.title}</span>
          {result.docNumber && (
            <span className='font-mono text-xs text-muted-foreground'>{result.docNumber}</span>
          )}
        </div>
        <p className='text-sm text-muted-foreground'>{copy.detail}</p>
        {result.error && <p className='text-sm'>{result.error}</p>}
        {result.retryable && (
          <p className='text-xs text-muted-foreground'>
            This was a transport failure, so it is worth trying again.
          </p>
        )}
      </div>
      {result.providerEntryId && (
        <Button asChild variant='outline' size='sm' className='shrink-0'>
          {/* PLACEHOLDER: the real deep link comes from the connected provider's
              adapter. `fixtureProviderEntryUrl` stands in until `ledger.get`
              returns the provider entry id alongside the stored draft. */}
          <a
            href={fixtureProviderEntryUrl(result.providerEntryId)}
            target='_blank'
            rel='noreferrer'>
            <ExternalLink />
            Open in {providerLabel}
          </a>
        </Button>
      )}
    </div>
  )
}
