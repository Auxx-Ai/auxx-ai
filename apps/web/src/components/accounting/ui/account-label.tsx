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
  /**
   * `full` density only: pin the code to this many characters so every NAME in
   * a column starts at the same x, including on the accounts that have no code.
   *
   * 🛑 A number of characters, never a hardcoded four. Four digits is the
   * common small-business default, but Xero's stock chart is three, ERPs run
   * five to eight, and QuickBooks Online ships numbering OFF - so a real chart
   * mixes lengths and blanks. The caller measures its own longest code
   * (`maxAccountCodeLength`) and passes that; `ch` on a `font-mono` span makes
   * it exact.
   *
   * Omit outside a column: a badge or a picker trigger has no siblings to line
   * up with, and a fixed track there is just dead space.
   */
  codeWidthCh?: number
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
  codeWidthCh,
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

  // With a track, the span renders even when the account has no code - an empty
  // box of the same width is the whole point, and dropping it is what let a
  // codeless account's name slide left into the code column.
  const showCodeTrack = codeWidthCh !== undefined && codeWidthCh > 0

  return (
    <span className={cn('flex min-w-0 items-baseline gap-1.5', className)} title={full}>
      {(code || showCodeTrack) && (
        <span
          className='shrink-0 font-mono text-muted-foreground text-xs tabular-nums'
          style={showCodeTrack ? { width: `${codeWidthCh}ch` } : undefined}>
          {code}
        </span>
      )}
      <span className='truncate'>{target.name}</span>
    </span>
  )
}
