// apps/web/src/components/accounting/ui/settings/mapping-scope-row.tsx
'use client'

import type { GlAccountSubtypeValue, GlAccountTypeValue } from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { TREE_ROW_NESTED_TINT, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { Check, Plus, RotateCcw, Sparkles, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { MappingAccountSelect, type MappingAccountValue } from './mapping-account-select'

export interface MappingScopeRowProps {
  /** Usually the scope's name; an editable `AutosizeInput` for an unconfirmed currency-code draft (59 §2.2). */
  title: ReactNode
  icon?: ReactNode
  /** Indent level. The Mapping tab nests under a statement-type header (role 1, scope 2, currency 3); the gateway editor has no header (role 1, currency 2). */
  depth?: 0 | 1 | 2 | 3
  /** Tint this row as a child of the row above it. Not derived from `depth` - the two screens number their levels differently. */
  nested?: boolean
  value: MappingAccountValue
  onChange: (value: string | 'inherit') => void
  /** Omit for a role with no default, e.g. `bank` (task 58 §3 rule 3) — a currency row's Inherit names the rail's own row, not the org default. */
  inheritedAccountName?: string | null
  filterTypes?: GlAccountTypeValue[]
  subtypePin?: GlAccountSubtypeValue
  /** `source: 'suggested'` (task 58/59 D5): an amber chip beside the picker and a hover Confirm action. */
  suggested?: boolean
  onConfirmSuggested?: () => void
  /** The sentence from task 58 §5.4 when a bank row's account disagrees with the payout's reported destination. */
  mismatchMessage?: string
  /** A `bank` rail with no linked feed: forces the picker disabled, drops Inherit, and shows this as secondary text. */
  noFeedLinked?: boolean
  /** A rail scope row: hover "+ currency" to add a currency sub-row. */
  onAddCurrency?: () => void
  /** Viewer lacks `ledgerControl` — every control disabled, no hover actions. */
  disabled?: boolean
  /** A role row with scopes beneath it. `TreeRow` renders its own chevron. */
  expandable?: boolean
  isOpen?: boolean
  onToggleOpen?: () => void
  /** A role row's "Mark unused"/"Mark used again" — the one hover action neither a scope nor a currency row carries. */
  extraActions?: ReactNode
  children?: ReactNode
}

/**
 * The shared scope row both the Mapping tab and the gateway editor render
 * (task 59 D1): a `TreeRow` with the picker inline and every affordance the
 * row's state calls for. Presentational only — the caller owns data and
 * staging, since the router this needs (`ledger.saveMapping`) doesn't exist yet.
 */
export function MappingScopeRow({
  title,
  icon,
  depth = 1,
  nested = false,
  value,
  onChange,
  inheritedAccountName,
  filterTypes,
  subtypePin,
  suggested = false,
  onConfirmSuggested,
  mismatchMessage,
  noFeedLinked = false,
  onAddCurrency,
  disabled = false,
  expandable = false,
  isOpen,
  onToggleOpen,
  extraActions,
  children,
}: MappingScopeRowProps) {
  const hasInherit =
    !noFeedLinked && inheritedAccountName !== undefined && inheritedAccountName !== null
  const isOverride = value !== 'inherit' && value !== 'unused' && value !== null
  const notMapped = value === null && !hasInherit
  const canRevert = !disabled && isOverride && hasInherit

  return (
    <TreeRow
      depth={depth}
      icon={icon}
      title={<span className='truncate'>{title}</span>}
      rowClassName={nested ? TREE_ROW_NESTED_TINT : undefined}
      expandable={expandable}
      isOpen={isOpen}
      onToggleOpen={onToggleOpen}
      secondary={
        <ScopeRowSecondary
          notMapped={notMapped}
          noFeedLinked={noFeedLinked}
          mismatchMessage={mismatchMessage}
        />
      }
      trailing={
        <div className='flex items-center gap-1.5'>
          {suggested && (
            <Badge variant='amber' size='xs' className='shrink-0'>
              <Sparkles className='size-3' />
              Suggested
            </Badge>
          )}
          <MappingAccountSelect
            value={value}
            onChange={onChange}
            inheritedAccountName={hasInherit ? inheritedAccountName : null}
            filterTypes={filterTypes}
            subtypePin={subtypePin}
            disabled={disabled || noFeedLinked}
          />
          {/* Fixed width, always rendered: a row with three actions and a row
              with none must put their pickers on the same column. */}
          <div className='flex w-[4.5rem] shrink-0 items-center justify-end gap-1'>
            {!disabled && (
              <>
                {onAddCurrency && (
                  <TreeRowButton tooltipText='Add a currency' onClick={onAddCurrency}>
                    <Plus />
                  </TreeRowButton>
                )}
                {suggested && onConfirmSuggested && (
                  <TreeRowButton
                    tooltipText='Confirm suggested account'
                    onClick={onConfirmSuggested}>
                    <Check />
                  </TreeRowButton>
                )}
                {canRevert && (
                  <TreeRowButton tooltipText='Use default' onClick={() => onChange('inherit')}>
                    <RotateCcw />
                  </TreeRowButton>
                )}
                {extraActions}
              </>
            )}
          </div>
        </div>
      }>
      {children}
    </TreeRow>
  )
}

/** One row's secondary slot: a mismatch warning wins over "no feed linked", which wins over the "Not mapped" chip. */
function ScopeRowSecondary({
  notMapped,
  noFeedLinked,
  mismatchMessage,
}: {
  notMapped: boolean
  noFeedLinked: boolean
  mismatchMessage?: string
}) {
  if (mismatchMessage) {
    return (
      <span className='flex min-w-0 items-center gap-1.5 text-amber-700 text-xs dark:text-amber-400'>
        <TriangleAlert className='size-3.5 shrink-0' />
        <span className='truncate'>{mismatchMessage}</span>
      </span>
    )
  }

  if (noFeedLinked) {
    return <span className='truncate text-muted-foreground text-xs'>no feed linked</span>
  }

  if (notMapped) {
    return (
      <Tooltip content='Every preview refuses until this is set'>
        <div className='p-[1px]'>
          <Badge variant='destructive' size='xs'>
            Not mapped
          </Badge>
        </div>
      </Tooltip>
    )
  }

  return null
}
