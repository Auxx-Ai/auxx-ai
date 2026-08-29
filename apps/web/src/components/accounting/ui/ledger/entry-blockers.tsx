// apps/web/src/components/accounting/ui/ledger/entry-blockers.tsx

'use client'

import type { PostResultStatus } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { Ban, KeyRound, Lock, Map as MapIcon, Scale, Settings2, TriangleAlert } from 'lucide-react'
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
  action?: 'unlock'
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
    icon: MapIcon,
    title: 'An account role is not mapped',
    guidance:
      'A builder emits a role and the org chart maps it to an account code. The resolver fails closed on zero matches and on more than one, so the entry cannot be built until the named role points at exactly one account.',
    href: '/app/accounting/settings/accounts',
    actionLabel: 'Map the role',
  },
  period_closed: {
    icon: Lock,
    title: 'The period is locked',
    guidance:
      'Nothing may post into a month that has been declared shut. Unlocking permits posting into a month the accountant may already have seen, so it is a deliberate, named action rather than a toggle.',
    action: 'unlock',
    actionLabel: 'Review the lock',
  },
  unbalanced: {
    icon: Scale,
    title: 'The entry does not balance',
    guidance:
      'Debits and credits disagree, so the entry was refused before the period was claimed. This is a builder or subledger fault, not something a retry can change.',
  },
  error: {
    icon: Settings2,
    title: 'Accounting setup is still a draft',
    guidance:
      'The opening baseline, the book time zone and the absorption rates are what the month-end arithmetic is computed from. Finalize the setup before the first entry is posted.',
    href: '/app/accounting/settings/general',
    actionLabel: 'Finish setup',
  },
  disabled: {
    icon: Ban,
    title: 'Export to the accounting system is switched off',
    guidance:
      'The entry is still built, balanced and persisted here. Only the push to the provider is off, and it is a setting somebody can flip.',
  },
  not_connected: {
    icon: KeyRound,
    title: 'No accounting system is connected',
    guidance:
      'This is not a blocker. The entry is built, balanced and persisted identically with no provider at all.',
  },
}

const FALLBACK: BlockerRemedy = {
  icon: TriangleAlert,
  title: 'The entry could not be built',
  guidance: 'The reason is below, verbatim, so it can be acted on without reading the logs.',
}

interface EntryBlockersProps {
  blockers: LedgerBlocker[]
  /** Invoked by the `period_closed` remedy. */
  onReviewLock?: () => void
}

/**
 * Why this month cannot be posted, at the SAME visual weight as the entry.
 *
 * ⚠️ Not a warning strip above the entry. When a close is refused, the refusal
 * IS the screen's content: an operator who has to hunt for a thin yellow bar to
 * find out why the Post button does nothing has been given a puzzle instead of a
 * task (13-accounting-ui.md §5.2).
 */
export function EntryBlockers({ blockers, onReviewLock }: EntryBlockersProps) {
  if (blockers.length === 0) return null

  return (
    <div className='flex flex-col gap-3'>
      {blockers.map((blocker) => {
        const remedy = REMEDIES[blocker.status] ?? FALLBACK
        const Icon = remedy.icon
        return (
          <div
            key={`${blocker.status}-${blocker.error}`}
            className='flex flex-col gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 sm:flex-row sm:items-start'>
            <Icon className='mt-0.5 size-5 shrink-0 text-destructive' />
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
          </div>
        )
      })}
    </div>
  )
}
