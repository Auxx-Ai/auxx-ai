// apps/web/src/components/data-connectors/ui/mapping-row.tsx
'use client'

import { GridTreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { ArrowRight, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { MAPPING_COLS } from './mapping-columns'
import { MergeStrategyToggle } from './merge-strategy-toggle'

/**
 * The `→` arrow state for a mapping row's second column:
 *  - `filled` — an active edge (bound leaf, header, link)
 *  - `dim` — the column is present but the row isn't bound yet (unmapped leaf)
 *  - `none` — no arrow (a passive container with no target action)
 */
type ArrowState = 'filled' | 'dim' | 'none'

interface MappingRowProps {
  depth: number
  icon?: ReactNode
  title: ReactNode
  expandable?: boolean
  isOpen?: boolean
  onToggleOpen?: () => void
  chevronOnHover?: boolean
  /** The `→` column state (default `none`). */
  arrow?: ArrowState
  /** The middle (target) cell — a picker, a def chip, or nothing. */
  target?: ReactNode
  /** Trailing action buttons — wrapped in the canonical right-aligned container. */
  actions?: ReactNode
  /** Nested rows. */
  children?: ReactNode
}

/** The `→` cell, rendered from the {@link ArrowState} enum. */
function ArrowCell({ state }: { state: ArrowState }) {
  if (state === 'none') return <span className='flex w-full justify-center' />
  return (
    <span
      className={`flex w-full justify-center ${
        state === 'filled' ? 'text-muted-foreground' : 'text-muted-foreground/40'
      }`}>
      <ArrowRight className='size-3.5' />
    </span>
  )
}

/**
 * The shared scaffold for every row in the mapping editor tree. Wraps
 * {@link GridTreeRow} with {@link MAPPING_COLS} and owns the two cells every row
 * was hand-rolling — the `→` arrow (driven by the {@link ArrowState} enum) and the
 * right-aligned actions container — so a row only supplies its distinct `title`,
 * `target`, and action buttons. Keeps the arrow/target columns aligned at every
 * depth without each row re-declaring the boilerplate.
 */
export function MappingRow({
  depth,
  icon,
  title,
  expandable,
  isOpen,
  onToggleOpen,
  chevronOnHover,
  arrow = 'none',
  target,
  actions,
  children,
}: MappingRowProps) {
  return (
    <GridTreeRow
      columns={MAPPING_COLS}
      depth={depth}
      icon={icon}
      title={title}
      expandable={expandable}
      isOpen={isOpen}
      onToggleOpen={onToggleOpen}
      chevronOnHover={chevronOnHover}
      cells={[
        <ArrowCell key='arrow' state={arrow} />,
        target ?? null,
        <div key='actions' className='flex w-full items-center justify-end gap-1 pr-1'>
          {actions}
        </div>,
      ]}>
      {children}
    </GridTreeRow>
  )
}

/**
 * The merge-strategy + clear cluster shared by every field-binding row (source
 * leaf, formula, drilled formula). The merge toggle only matters on a SHARED def —
 * an owned mapping is the sole writer, so it hides (an implicit overwrite). The
 * caller decides WHEN to render it (e.g. a leaf only shows it once mapped).
 */
export function FieldRowActions({
  isOwned = false,
  mergeStrategy,
  onMergeChange,
  onClear,
  clearTooltip = "Don't map this field",
}: {
  isOwned?: boolean
  mergeStrategy: string
  onMergeChange: (value: string) => void
  onClear: () => void
  clearTooltip?: string
}) {
  return (
    <>
      {!isOwned && <MergeStrategyToggle value={mergeStrategy} onValueChange={onMergeChange} />}
      <TreeRowButton variant='destructive' tooltipText={clearTooltip} onClick={onClear}>
        <Trash2 />
      </TreeRowButton>
    </>
  )
}
