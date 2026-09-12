// apps/web/src/components/returns/ui/salvage-tree-row.tsx
'use client'

// One node of the salvage tree, and its children (plans/money/tasks/54-returns.md §6.6).
//
// The row carries a NUMBER INPUT and a STATUS BADGE SELECTOR and nothing else,
// which is the owner's spec verbatim: "we don't want all these fields for each
// row, it would be just one status and the qty. All the photos, notes etc would
// be on the return item itself" (§3.6). The only other affordance is the split
// button, and it is on the row because splitting is a property of the row.
//
// 🛑 `GridTreeRow`, not `TreeRow`. This tree goes 20 levels deep (`MAX_BOM_DEPTH`)
// and `TreeRow`'s indent shifts the WHOLE row, so the quantity box and the status
// badge would walk 1.5rem to the right per level and fall off a phone by level
// four. `GridTreeRow` puts the indent inside the first cell only, so every
// control stays at a fixed x at every depth — which is exactly the case the
// design guide (§7) says to use it for. Both come out of
// `@auxx/ui/components/tree-row` and both carry `group/tree-row`, so
// `TreeRowButton` is valid inside either.

import { FieldType } from '@auxx/database/enums'
import { Badge } from '@auxx/ui/components/badge'
import { Spinner } from '@auxx/ui/components/spinner'
import { GridTreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Boxes, Package, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { Tooltip } from '~/components/global/tooltip'
import {
  canSplitNode,
  MAX_INDENT_DEPTH,
  MIN_SPLITTABLE_QUANTITY,
  type SalvageTreeState,
} from '../hooks/use-salvage-tree'
import {
  SALVAGE_STATUS_OPTIONS,
  type SalvageNode,
  type SalvageStatus,
  toSalvageStatus,
} from '../types'

/**
 * Shared `grid-template-columns` for the header and every row, at every depth
 * (the `OPENING_STOCK_COLS` idiom).
 *
 * 🛑 ONE template is what makes the tree a table. Columns: part (fills and
 * truncates, and absorbs the indent) | quantity | status | split. The bounds
 * are container-driven, so the middle columns shrink toward a floor on a phone
 * instead of pushing the row wider than the card.
 */
export const SALVAGE_COLS =
  'minmax(6rem, 1fr) minmax(3.5rem, 4.5rem) minmax(6.5rem, 8.5rem) 1.75rem'

export interface SalvageTreeRowProps {
  node: SalvageNode
  tree: SalvageTreeState
  /**
   * An ancestor is already `good`, so this row is covered by it and decides
   * nothing. §6.6 invariant 1: only the highest `good` node in a branch
   * produces a movement.
   */
  impliedGood: boolean
  /** Nothing on this card can be edited (no write access, a settled return). */
  readOnly: boolean
  onChangeQuantity: (node: SalvageNode, quantity: number) => void
  /** Already wrapped by the card: confirms a superseding `good` and collapses the branch. */
  onChangeStatus: (node: SalvageNode, status: SalvageStatus) => void
  onSplit: (node: SalvageNode) => void
}

export function SalvageTreeRow({
  node,
  tree,
  impliedGood,
  readOnly,
  onChangeQuantity,
  onChangeStatus,
  onSplit,
}: SalvageTreeRowProps) {
  const expanded = tree.isExpanded(node.key)
  const expanding = tree.isExpanding(node.key)
  const loaded = node.children !== null

  // A `good` node has already answered for everything beneath it, so drilling
  // into it would materialize rows that decide nothing. The chevron stays only
  // when the children are already in memory, so a person can still audit what
  // they just covered without paying for a fetch.
  const coveredFromHere = impliedGood || node.status === 'good'
  const expandable = node.hasChildren && !expanding && (!coveredFromHere || loaded)

  const disabled = readOnly || impliedGood

  return (
    <GridTreeRow
      columns={SALVAGE_COLS}
      // `gap-x-2` keeps the two bordered cells (quantity, status) off each
      // other — flush borders read as one merged control, and padding inside a
      // bordered box cannot fix that. The header row carries the same gap.
      rowClassName={cn('gap-x-2 rounded-md hover:bg-primary-100/60', impliedGood && 'opacity-60')}
      // Capped: see MAX_INDENT_DEPTH. The connector line reads the same value,
      // so the line and the indent cannot disagree.
      depth={Math.min(node.depth, MAX_INDENT_DEPTH)}
      expandable={expandable}
      chevronOnHover
      isOpen={expanded && loaded}
      onToggleOpen={expandable ? () => tree.toggle(node) : undefined}
      icon={
        expanding ? (
          <Spinner className='size-4 text-muted-foreground' />
        ) : node.hasChildren ? (
          <Boxes className='size-4 text-muted-foreground' />
        ) : (
          <Package className='size-4 text-muted-foreground' />
        )
      }
      title={
        <span className='flex min-w-0 items-center gap-1.5'>
          <span className='min-w-0 truncate text-sm'>{node.partName}</span>
          {node.partNumber && (
            <span className='shrink-0 text-muted-foreground text-xs tabular-nums'>
              {node.partNumber}
            </span>
          )}
          {/* Only a `good` row posts a movement, so the salvage percentage is
              the one place it means anything. Read-only here: it is a policy on
              the return line, not a per-row control (§6.4). */}
          {node.status === 'good' && !impliedGood && node.salvagePercent !== 100 && (
            <Tooltip content={`Valued at ${node.salvagePercent}% of this part's standard cost.`}>
              <span className='shrink-0 text-muted-foreground text-xs tabular-nums'>
                {node.salvagePercent}%
              </span>
            </Tooltip>
          )}
        </span>
      }
      cells={[
        impliedGood ? (
          <span
            key='quantity'
            className='w-full pr-1.5 text-right text-muted-foreground text-sm tabular-nums'>
            {node.quantity}
          </span>
        ) : (
          <QuantityCell key='quantity'>
            <FieldInputAdapter
              fieldType={FieldType.NUMBER}
              value={node.quantity}
              onChange={(value) => onChangeQuantity(node, toQuantity(value))}
              placeholder='0'
              disabled={readOnly}
            />
          </QuantityCell>
        ),

        <div key='status' className='flex w-full min-w-0 items-center'>
          {impliedGood ? (
            <Tooltip content='Covered by a subassembly above that is marked good. Only the highest good node in a branch is recovered.'>
              <Badge variant='green' size='sm' className='shrink-0'>
                Good, implied
              </Badge>
            </Tooltip>
          ) : (
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: SALVAGE_STATUS_OPTIONS }}
              triggerProps={{ className: 'ps-0 pe-1 w-full' }}
              value={node.status}
              onChange={(value) => {
                const next = toSalvageStatus(value)
                if (next) onChangeStatus(node, next)
              }}
              placeholder='Undecided'
              disabled={disabled}
            />
          )}
        </div>,

        // 🛑 `persistent`. A `TreeRowButton` is hover-revealed by default, and
        // the split is not a secondary action here — it is how the warehouse
        // records that four units of one subassembly did not all survive. There
        // is no hover on the phone the dock actually uses.
        <div key='split' className='flex w-full items-center justify-center'>
          {!disabled && (
            <Tooltip
              content={
                canSplitNode(node)
                  ? 'Split into two rows, so one part of this quantity can be judged separately.'
                  : `Needs at least ${MIN_SPLITTABLE_QUANTITY} units to split.`
              }>
              {/* The span keeps the tooltip alive over a disabled button. */}
              <span className='inline-flex'>
                <TreeRowButton
                  persistent
                  aria-label={`Split ${node.partName}`}
                  disabled={!canSplitNode(node)}
                  className='disabled:cursor-not-allowed disabled:opacity-40'
                  onClick={() => onSplit(node)}>
                  <Plus />
                </TreeRowButton>
              </span>
            </Tooltip>
          )}
        </div>,
      ]}>
      {node.children?.map((child) => (
        <SalvageTreeRow
          key={child.key}
          node={child}
          tree={tree}
          impliedGood={coveredFromHere}
          readOnly={readOnly}
          onChangeQuantity={onChangeQuantity}
          onChangeStatus={onChangeStatus}
          onSplit={onSplit}
        />
      ))}
    </GridTreeRow>
  )
}

/** A quantity the input can round-trip: never negative, never NaN. */
function toQuantity(value: unknown): number {
  const next = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(next) && next > 0 ? next : 0
}

/**
 * The bordered 28px box that stops an editable cell reading as loose text —
 * the `opening-stock-list.tsx` / `receive-purchase-order-dialog.tsx` recipe.
 *
 * ⚠️ THE CELL CARRIES THE BORDER, never the input: the field inside is
 * chromeless on purpose (`border-0 bg-transparent!` in `node-inputs`), and
 * `FieldInputAdapter` takes no `className`, so every class below has to be
 * pushed onto it from out here. The increment arrows are hidden because nobody
 * counting a pallet presses one and the pair costs 24px of a fixed column.
 */
function QuantityCell({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex h-7 w-full shrink-0 items-center rounded-md border border-primary-200 ring-1 ring-transparent transition-colors focus-within:bg-muted/60 focus-within:ring-ring/30 hover:bg-muted/60',
        '[&_[data-slot=input-group]]:h-full [&_[data-slot=input-group]]:min-h-0',
        '[&_input]:tabular-nums [&_input]:text-right',
        '[&_div:has(>button[aria-label=Increment])]:hidden'
      )}>
      {children}
    </div>
  )
}
