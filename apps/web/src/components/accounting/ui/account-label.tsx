// apps/web/src/components/accounting/ui/account-label.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import {
  accountChipText,
  accountMatchesSearch,
  formatAccountLabel,
  type LabelAccount,
} from './account-label-format'
import { useChartAccounts } from './use-chart-accounts'

export { accountChipText, accountMatchesSearch, formatAccountLabel, type LabelAccount }

/**
 * Resolve one chart account by id against the one `ledger.chartAccounts`
 * fetch every picker on the screen shares. Null while the chart is loading
 * and for an id the chart no longer holds.
 */
export function useChartAccount(glAccountId: string | null | undefined) {
  const { accounts, isLoading } = useChartAccounts()
  const account = glAccountId ? (accounts.find((row) => row.id === glAccountId) ?? null) : null
  return { account, isLoading }
}

export type AccountLabelDensity = 'full' | 'compact' | 'chip'

interface AccountLabelProps {
  /** The account itself, when the caller already holds it. Skips the lookup. */
  account?: LabelAccount | null
  /** Resolved against the shared chart fetch when `account` is not given. */
  glAccountId?: string | null
  /**
   * `full`: muted code, then the name. Tables, tree rows, anywhere with a
   * column to itself.
   *
   * `compact`: the name alone, with the code in the tooltip. Secondary lines
   * at `text-xs`, picker triggers inside a `FieldPanelRow`, and any slot where
   * a code that survives while the name is clipped to `Inventory Ra…` is
   * worse than no code at all.
   *
   * `chip`: {@link accountChipText}, clamped, for a badge or a 10px chip. The
   * caller supplies the chrome.
   */
  density?: AccountLabelDensity
  /** Rendered when nothing resolves. Defaults to the raw id, then nothing. */
  fallback?: string
  className?: string
}

/**
 * A GL account as an inline label. Every screen that names an account renders
 * through this so the layout decision - which part yields when the row is
 * narrow - is made once.
 *
 * In every density the name is the part that keeps the room. The code is a
 * hint: four characters that sort a chart and that a bookkeeper who numbered
 * it recognises, but not what identifies the account to anyone else. The full
 * `code · name` always sits in `title`, so hovering answers what a clamp hid.
 *
 * @example
 * <AccountLabel account={line} />                             // 1310 · Inventory Raw Materials
 * <AccountLabel glAccountId={rule.glAccountId} density='compact' />
 * <Badge variant='outline' size='xs'><AccountLabel account={mapped} density='chip' /></Badge>
 */
export function AccountLabel({
  account,
  glAccountId,
  density = 'full',
  fallback,
  className,
}: AccountLabelProps) {
  const resolved = useChartAccount(account ? null : glAccountId)
  const target = account ?? resolved.account

  if (!target) {
    const text = fallback ?? glAccountId ?? ''
    if (!text) return null
    return <span className={cn('truncate', className)}>{text}</span>
  }

  const full = formatAccountLabel(target)
  const code = target.code?.trim() || null

  if (density === 'chip') {
    return (
      <span className={cn('inline-block max-w-24 truncate align-bottom', className)} title={full}>
        {accountChipText(target)}
      </span>
    )
  }

  if (density === 'compact') {
    return (
      <span className={cn('truncate', className)} title={full}>
        {target.name}
      </span>
    )
  }

  return (
    <span className={cn('flex min-w-0 items-baseline gap-1.5', className)} title={full}>
      {code && (
        <span className='shrink-0 font-mono text-muted-foreground text-xs tabular-nums'>
          {code}
        </span>
      )}
      <span className='truncate'>{target.name}</span>
    </span>
  )
}
