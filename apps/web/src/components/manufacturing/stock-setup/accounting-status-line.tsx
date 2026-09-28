// apps/web/src/components/manufacturing/stock-setup/accounting-status-line.tsx
'use client'

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { BookOpen } from 'lucide-react'
import Link from 'next/link'
import { useSettings } from '~/hooks/use-settings'
import { useAccess } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

export const OPENING_INVENTORY_DIFFERENCE_HREF = '/app/accounting/settings/opening?s=inventory'

/** `'2025-11'` → `'Dec 2025'`: the books start the month after the cutoff. */
export function booksStartLabel(cutoffPeriod: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(cutoffPeriod)
  if (!match) return cutoffPeriod
  const start = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1))
  return start.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export interface AccountingSetupState {
  /** Off when the org has no accounting feature; nothing is shown then. */
  enabled: boolean
  cutoffPeriod: string | null
  finalized: boolean
  canManage: boolean
}

/** Accounting's setup state as the stock side sees it (plans/mrp/17 §5.5). */
export function useAccountingSetupState(): AccountingSetupState {
  const { hasAccess } = useFeatureFlags()
  const { can } = useAccess()
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const cutoffPeriod = (getSetting('accounting.cutoffPeriod') as string | null) || null
  return {
    enabled: hasAccess(FeatureKey.accounting),
    cutoffPeriod,
    finalized: getSetting('accounting.setupState') === 'finalized',
    canManage: can(PermissionKey.ledgerControl),
  }
}

/** One line at the top of Stock setup naming where accounting stands, with a link onward. */
export function AccountingStatusLine() {
  const accounting = useAccountingSetupState()
  if (!accounting.enabled) return null

  const { text, linkText, href } = !accounting.cutoffPeriod
    ? {
        text: "Accounting isn't set up. Stock moves, but nothing posts to the books yet.",
        linkText: 'Set up accounting',
        href: '/app/accounting?setup=wizard',
      }
    : !accounting.finalized
      ? {
          text: `Books start ${booksStartLabel(accounting.cutoffPeriod)}. Builds and counts before then post nothing.`,
          linkText: 'Continue accounting setup',
          href: '/app/accounting?setup=wizard',
        }
      : {
          text: `Books start ${booksStartLabel(accounting.cutoffPeriod)} and are open. From here on, stock changes post.`,
          linkText: 'Opening inventory difference',
          href: OPENING_INVENTORY_DIFFERENCE_HREF,
        }

  return (
    <div className='flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/40 px-4 py-2 text-muted-foreground text-xs'>
      <BookOpen className='size-3.5 shrink-0' />
      <span>{text}</span>
      {accounting.canManage ? (
        <Link
          href={href}
          className='font-medium text-foreground underline-offset-2 hover:underline'>
          {linkText} →
        </Link>
      ) : (
        <span>Ask whoever manages accounting.</span>
      )}
    </div>
  )
}
