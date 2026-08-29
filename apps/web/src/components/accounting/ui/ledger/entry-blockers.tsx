// apps/web/src/components/accounting/ui/ledger/entry-blockers.tsx

'use client'

import type { PostResultStatus } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import {
  Ban,
  CircleSlash,
  KeyRound,
  Lock,
  Map as MapIcon,
  Scale,
  Settings2,
  TriangleAlert,
} from 'lucide-react'
import Link from 'next/link'
import type { ComponentType } from 'react'

/** One reason a preview or a post refused, as the console renders it. */
export interface LedgerBlocker {
  status: PostResultStatus
  error: string
}

interface BlockerRemedy {
  icon: ComponentType<{ className?: string }>
  title: string
  /** What to do about it, in the operator's terms. */
  guidance: string
  href?: string
  actionLabel?: string
  /** For the remedies that are a control on this page rather than another page. */
  action?: 'unlock' | 'next-period'
  /**
   * 🛑 `neutral` is not a softer `failure`. Two refusals here are the most
   * ORDINARY things an organization meets - a month in which nothing moved, and
   * a setup still in draft on day one - and a destructive box around either
   * teaches an operator that this screen alarms about nothing
   * (14-drive-the-close.md section 1.3). Only something actually broken is
   * `failure`.
   */
  tone: 'neutral' | 'failure'
}

/**
 * What each refusal means and where it is fixed.
 *
 * 🛑 Every status gets its own line with its own destination. A single generic
 * "preview failed" is what sends an operator to the logs for a string that is
 * already in the database (13-accounting-ui.md §5.2).
 */
const REMEDIES: Partial<Record<PostResultStatus, BlockerRemedy>> = {
  account_unmapped: {
    tone: 'failure',
    icon: MapIcon,
    title: 'An account role is not mapped',
    guidance:
      'A builder emits a role and the org chart maps it to an account code. The resolver fails closed on zero matches and on more than one, so the entry cannot be built until the named role points at exactly one account.',
    href: '/app/accounting/settings/accounts',
    actionLabel: 'Map the role',
  },
  period_closed: {
    tone: 'failure',
    icon: Lock,
    title: 'The period is locked',
    guidance:
      'Nothing may post into a month that has been declared shut. Unlocking permits posting into a month the accountant may already have seen, so it is a deliberate, named action rather than a toggle.',
    action: 'unlock',
    actionLabel: 'Review the lock',
  },
  unbalanced: {
    tone: 'failure',
    icon: Scale,
    title: 'The entry does not balance',
    guidance:
      'Debits and credits disagree, so the entry was refused before the period was claimed. This is a builder or subledger fault, not something a retry can change.',
  },
  setup_incomplete: {
    tone: 'neutral',
    icon: Settings2,
    title: 'Finish the accounting setup first',
    guidance:
      'The opening baseline, the book time zone and the absorption rates are what the month-end arithmetic is computed from. The message above names exactly which rows are still blank. Nothing was written.',
    href: '/app/accounting/settings/general',
    actionLabel: 'Finish setup',
  },
  nothing_to_close: {
    tone: 'neutral',
    icon: CircleSlash,
    title: 'Nothing moved this month',
    guidance:
      'Every inventory balance and activity total is unchanged, so there is no month-end entry to build. This is a skip, not a fault: an organization whose cutoff predates its first movement walks through a run of these.',
    action: 'next-period',
    actionLabel: 'Go to the next month',
  },
  error: {
    tone: 'failure',
    icon: TriangleAlert,
    title: 'The entry could not be built',
    guidance:
      'Something failed that is not one of the named refusals. The reason is above, verbatim, so it can be acted on without reading the logs.',
  },
  disabled: {
    tone: 'neutral',
    icon: Ban,
    title: 'Export to the accounting system is switched off',
    guidance:
      'The entry is still built, balanced and persisted here. Only the push to the provider is off, and it is a setting somebody can flip.',
  },
  not_connected: {
    tone: 'neutral',
    icon: KeyRound,
    title: 'No accounting system is connected',
    guidance:
      'This is not a blocker. The entry is built, balanced and persisted identically with no provider at all.',
  },
}

const FALLBACK: BlockerRemedy = {
  tone: 'failure',
  icon: TriangleAlert,
  title: 'The entry could not be built',
  guidance: 'The reason is below, verbatim, so it can be acted on without reading the logs.',
}

/** Neutral reads like the rest of the page; only a fault gets the destructive box. */
const TONE_CLASS: Record<BlockerRemedy['tone'], string> = {
  neutral: 'border-border bg-muted/40',
  failure: 'border-destructive/40 bg-destructive/5',
}

const TONE_ICON_CLASS: Record<BlockerRemedy['tone'], string> = {
  neutral: 'text-muted-foreground',
  failure: 'text-destructive',
}

interface EntryBlockersProps {
  blockers: LedgerBlocker[]
  /** Invoked by the `period_closed` remedy. */
  onReviewLock?: () => void
  /** Invoked by the `nothing_to_close` remedy. Absent on the newest month. */
  onNextPeriod?: () => void
}

/**
 * Why this month cannot be posted, at the SAME visual weight as the entry.
 *
 * ⚠️ Not a warning strip above the entry. When a close is refused, the refusal
 * IS the screen's content: an operator who has to hunt for a thin yellow bar to
 * find out why the Post button does nothing has been given a puzzle instead of a
 * task (13-accounting-ui.md §5.2).
 */
export function EntryBlockers({ blockers, onReviewLock, onNextPeriod }: EntryBlockersProps) {
  if (blockers.length === 0) return null

  return (
    <div className='flex flex-col gap-3'>
      {blockers.map((blocker) => {
        const remedy = REMEDIES[blocker.status] ?? FALLBACK
        const Icon = remedy.icon
        return (
          <div
            key={`${blocker.status}-${blocker.error}`}
            className={cn(
              'flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start',
              TONE_CLASS[remedy.tone]
            )}>
            <Icon className={cn('mt-0.5 size-5 shrink-0', TONE_ICON_CLASS[remedy.tone])} />
            <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
              <div className='flex flex-wrap items-center gap-2'>
                <span className='font-medium'>{remedy.title}</span>
                <span className='font-mono text-xs text-muted-foreground'>{blocker.status}</span>
              </div>
              {/* The server's own text, verbatim: on `account_unmapped` it names
                  every offending role, and on an uncosted movement it names the
                  row. Paraphrasing it here would throw away the only part that
                  identifies what to go and fix. */}
              <p className='text-sm'>{blocker.error}</p>
              <p className='text-xs text-muted-foreground'>{remedy.guidance}</p>
            </div>
            {remedy.href && remedy.actionLabel && (
              <Button asChild variant='outline' size='sm' className='shrink-0'>
                <Link href={remedy.href}>{remedy.actionLabel}</Link>
              </Button>
            )}
            {remedy.action === 'unlock' && onReviewLock && (
              <Button variant='outline' size='sm' className='shrink-0' onClick={onReviewLock}>
                {remedy.actionLabel}
              </Button>
            )}
            {remedy.action === 'next-period' && onNextPeriod && (
              <Button variant='outline' size='sm' className='shrink-0' onClick={onNextPeriod}>
                {remedy.actionLabel}
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}
