// apps/web/src/components/accounting/ui/ledger/post-result-callout.tsx

'use client'

import type { PostResult, PostResultStatus } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { CheckCircle2, CircleSlash, ExternalLink, PlugZap, TriangleAlert } from 'lucide-react'
import type { ComponentType } from 'react'

/**
 * A deep link into the provider's own register.
 *
 * Two systems that never link to each other is how reconciliation becomes
 * copy-paste (gap-g section 3), so a posted entry gets a way back to the entry
 * the provider actually holds.
 *
 * ⚠️ Returns `null` for anything but a provider whose URL shape we know. A
 * guessed link that 404s is worse than no link: it reads as "the entry is not
 * there", which is the one conclusion this button exists to prevent. `none` is
 * the id `postEntry` records when nothing was pushed, so it never gets a link.
 *
 * 🛑 **And a link into the wrong COMPANY is the same guess one dimension over.**
 * A QuickBooks entry id is a per-company sequence - entry `147` exists in every
 * company and means something different in each - and the URL cannot carry a
 * company: `&companyId=` is ignored and `/app/switchcompany` 404s, verified
 * against the sandbox. So the browser resolves this against whatever company its
 * QuickBooks session happens to be in, and from the wrong one it reports a live
 * entry as deleted. There is no honest link to build, so the caller passes the
 * tenants and this returns `null` unless they are the same one (task 24 §4).
 *
 * @param providerId which system holds the entry, from the posting.
 * @param entryId that system's own id for the entry.
 * @param entryTenantId which instance of it the entry was exported to. NULL on a
 *   row no export ever reached a provider for, which is also no link.
 * @param connectedTenantId which instance this workspace is connected to now.
 */
function providerEntryUrl(
  providerId: string | undefined,
  entryId: string,
  entryTenantId: string | null,
  connectedTenantId: string | null
): string | null {
  if (providerId !== 'quickbooks') return null
  if (!entryTenantId || entryTenantId !== connectedTenantId) return null
  return `https://app.qbo.intuit.com/app/journal?txnId=${encodeURIComponent(entryId)}`
}

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
 *
 * 🛑 `nothing_to_close` and `setup_incomplete` are `neutral`, never `failure`
 * (14-drive-the-close.md §1.3). They are the two most ORDINARY things an
 * organization meets: a month in which nothing moved, and a setup still in
 * draft on day one. Both were previously reachable only as `error`, which is the
 * one tone reserved for something actually breaking. An org whose cutoff
 * predates its first movement walks through a run of `nothing_to_close`; the
 * console must skip them, not alarm on each one.
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
  // 🛑 NOT `not_connected`, and the difference is the whole point of the value.
  // This entry's posting type is never exported - an opening balance or an
  // entry read back off the provider's own ledger - so the org's connection is
  // irrelevant and may well be healthy. Saying "no accounting system is
  // connected" here sent a reader to debug a working QuickBooks link on
  // DemoOrg1's first wizard drive. Brief 22 §5.
  not_exported: {
    icon: CheckCircle2,
    title: 'Posted. This entry is not exported',
    detail:
      'An opening balance and an entry synced from your accounting system are both kept here only. Pushing either back would hand the provider a second copy of a figure it already has.',
    tone: 'success',
  },
  not_enabled: {
    icon: PlugZap,
    title: 'Nothing posted. Accounting is not enabled for this organization',
    detail:
      'The ledger is off for this organization, so no entry was built or recorded. Enable the accounting module and run its setup to start posting.',
    tone: 'neutral',
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
  inventory_role_refused: {
    icon: TriangleAlert,
    title: 'Refused: a line names an inventory account',
    detail:
      'Nothing was written. The three inventory accounts are asserted by the month-end close and cannot be hand-keyed; a manual line there would be reversed by the next close.',
    tone: 'failure',
  },
  account_invalid: {
    icon: TriangleAlert,
    title: 'Refused: a line names an account the chart does not hold',
    detail: 'Nothing was written. The message names the row; fix the code or restore the account.',
    tone: 'failure',
  },
  // 🛑 A refusal, and `failure`, but the sentence is about work rather than a
  // fault: the month is short of revenue somebody still has to post or void.
  // Nothing was written, and nothing is broken.
  revenue_incomplete: {
    icon: TriangleAlert,
    title: 'Refused: the month still holds revenue that is not in the books',
    detail:
      'Nothing was written. Post the shipments and issue or void the channel credit memos dated in this month first - once it is closed, the entries they owe cannot be written into it.',
    tone: 'failure',
  },
  nothing_to_close: {
    icon: CircleSlash,
    title: 'Nothing to close',
    detail:
      'No inventory balance or activity total changed this month, so there is no entry to post. Move on to the next month.',
    tone: 'neutral',
  },
  setup_incomplete: {
    icon: PlugZap,
    title: 'Finish the accounting setup first',
    detail:
      'There is no reconciled opening baseline yet, so a month-end delta cannot be computed. Nothing was written.',
    tone: 'neutral',
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
  /**
   * Which company this workspace is connected to now, from
   * `useAccountingProviderStatus`. Null when nothing is connected.
   *
   * 🛑 Compared, never rendered. See {@link providerEntryUrl}.
   */
  connectedTenantId: string | null
}

/**
 * The provider result, inline with the entry it belongs to.
 *
 * Two systems that never link to each other is how reconciliation becomes
 * copy-paste, so a posted entry carries a deep link straight into the
 * provider's own register (gap-g §3) - when, and only when, it went to the
 * company this workspace is connected to.
 *
 * 🛑 **An absent button is the complete answer**, and there is deliberately no
 * copy in its place (task 24 §4). Naming the company on the button, explaining
 * that the entry went to one this workspace no longer holds, or saying that a
 * row predates a column are all narrating our internals at somebody who did not
 * ask. The company is named in one place, the connection's label in app
 * settings, and the realm id is named nowhere at all.
 */
export function PostResultCallout({
  result,
  providerLabel,
  connectedTenantId,
}: PostResultCalloutProps) {
  const copy = OUTCOMES[result.status]
  const Icon = copy.icon
  const entryUrl = result.providerEntryId
    ? providerEntryUrl(
        result.providerId,
        result.providerEntryId,
        result.providerTenantId ?? null,
        connectedTenantId
      )
    : null

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
      {entryUrl && (
        <Button asChild variant='outline' size='sm' className='shrink-0'>
          <a href={entryUrl} target='_blank' rel='noreferrer'>
            <ExternalLink />
            Open in {providerLabel}
          </a>
        </Button>
      )}
    </div>
  )
}
