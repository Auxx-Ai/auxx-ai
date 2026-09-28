// apps/web/src/components/manufacturing/stock-setup/stock-setup-progress.tsx
'use client'

// Accounting → stock cross-links (plans/mrp/17 §5.5): where Stock setup stands, and a link
// into it for whoever may edit parts.

import { cn } from '@auxx/ui/lib/utils'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useResourceProperty } from '~/components/resources'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { type StockSetupStep, stockSetupHref } from './stock-setup-href'
import { resolveStepStates, STOCK_SETUP_STEPS } from './use-stock-setup'

/** Stock links need edit on the `part` def, the Stock setup page's own guard. */
export function useCanManageStock(): boolean {
  const partDefId = useResourceProperty('part', 'id')
  const { canEditEntity } = useAccess()
  return partDefId ? canEditEntity(partDefId) : false
}

/** Stock setup's progress; `visible` only for an org with stocked parts that moved. */
export function useStockSetupProgress() {
  // Gated on viewing stock movements; a refusal just hides the lines.
  const status = api.purchasing.stockSetupStatus.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
  })
  const canManageStock = useCanManageStock()
  const states = resolveStepStates(status.data)
  const total = STOCK_SETUP_STEPS.length
  const done = STOCK_SETUP_STEPS.filter((step) => states[step.id] !== 'todo').length
  const firstOpen: StockSetupStep | undefined = STOCK_SETUP_STEPS.find(
    (step) => states[step.id] === 'todo'
  )?.id
  return {
    status: status.data,
    visible: !!status.data?.hasStockedMovements,
    done,
    total,
    complete: done === total,
    firstOpen,
    canManageStock,
  }
}

/** A link into Stock setup, or "Ask whoever manages stock" without part edit. */
export function StockSetupLink({
  href,
  canManageStock,
  children,
  className,
}: {
  href: string
  canManageStock: boolean
  children: ReactNode
  className?: string
}) {
  if (!canManageStock) {
    return <span className={cn('text-muted-foreground', className)}>Ask whoever manages stock</span>
  }
  return (
    <Link href={href} className={cn('font-medium text-primary-600 hover:underline', className)}>
      {children}
    </Link>
  )
}

/** "Stock setup: 2 of 3 steps done. …" → Continue stock setup; nothing once it is done. */
export function StockSetupProgressLine({
  note = 'The inventory value below is only complete once it is.',
  className,
}: {
  note?: string
  className?: string
}) {
  const progress = useStockSetupProgress()
  if (!progress.visible || progress.complete) return null
  return (
    <p
      data-testid='stock-setup-progress'
      className={cn('text-muted-foreground text-xs', className)}>
      Stock setup: {progress.done} of {progress.total} steps done. {note}{' '}
      <StockSetupLink
        href={stockSetupHref(progress.firstOpen)}
        canManageStock={progress.canManageStock}>
        Continue stock setup
      </StockSetupLink>
    </p>
  )
}
