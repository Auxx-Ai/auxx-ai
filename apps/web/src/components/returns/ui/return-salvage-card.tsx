// apps/web/src/components/returns/ui/return-salvage-card.tsx
'use client'

// The salvage tree (plans/money/tasks/54-returns.md §6.6): the checklist the
// warehouse works down when a returned lift is torn down on the dock.
//
// 🛑 THIS IS A `CardBlock`, NOT A `RecordsBlock`, and §4.1's table is why.
// `RecordsBlockConfig` carries source, `statusAttr`, `emptyLabel` and
// `visibleLimit` and NOTHING else: it renders a read-only list with a status
// badge it DISPLAYS. This surface needs a number input per row, a status
// SELECTOR, a split button, lazy child expansion and the parent-implies-children
// rule, none of which is expressible in config — and `actionsComponent` does not
// change that, it is a section-level slot, not per-row controls.
//
// 🛑 PRESENTATIONAL ONLY, ON PURPOSE. Every byte comes in as a prop and every
// write goes out as a callback. Keeping it that way is what let the tree be
// built before any router existed, and it is why the thing the drawer registry
// holds is the CONTAINER, not this: the registry's value type is
// `ComponentType<DrawerTabProps>` (`{ entityInstanceId, recordId, record? }`)
// and a tree that takes its data as props is not one.
//
// WIRING: `return-salvage-container.tsx` reads `recordId`, picks a return LINE
// (the tree is line-grained, a return has many), runs `return.salvageTree` and
// the four mutations, and renders this. That container is what registers under
// `'return:salvage'` in `DRAWER_TAB_CARD_COMPONENTS` (the `tabCards` registry —
// NOT `DRAWER_TAB_COMPONENTS`, which is the whole-tab one), with the card
// declared in the `return` drawer config's `tabCards`.
// `drawer-card-parity.test.ts` only asserts declared -> registered, so
// registering ahead of the declaration is safe; declaring ahead of the
// component renders nothing, silently.

import type { SalvageNode, SalvageStatus } from '@auxx/lib/returns/client'
import { EmptySection } from '@auxx/ui/components/section'
import { Wrench } from 'lucide-react'
import { useCallback } from 'react'
import { LineGridFrame } from '~/components/line-grid/ui/line-grid-frame'
import { useConfirm } from '~/hooks/use-confirm'
import { decidedDescendantCount, useSalvageTree } from '../hooks/use-salvage-tree'
import { SALVAGE_COLS, SalvageTreeRow } from './salvage-tree-row'

export interface ReturnSalvageCardProps {
  /**
   * The top level of the tree: the return line's own parts. §6.6 —
   * "Create the top level only, and materialize a node's children on first
   * expand." A node whose `children` is `null` has never been opened.
   */
  nodes: SalvageNode[]
  /** The top level is still loading. Child loading is the row's own spinner. */
  isLoading?: boolean
  /**
   * Materialize this node's children, resolving once they are on the tree.
   * Called at most once per node; a rejection raises an error toast and leaves
   * the row closed.
   */
  onExpand: (node: SalvageNode) => void | Promise<void>
  /** Quantity is prefilled as BOM quantity times the return line's quantity, then edited here. */
  onChangeQuantity: (node: SalvageNode, quantity: number) => void
  /**
   * Write a node's condition. A node with no row is `undecided` by absence, so
   * the first non-`undecided` write on an unmaterialized node is what creates
   * its `return_part_line`.
   */
  onChangeStatus: (node: SalvageNode, status: SalvageStatus) => void
  /**
   * Divide this row into two siblings whose quantities sum to the row's
   * current quantity — for when the units diverge and one has to be drilled
   * into. Only offered when `quantity >= 2`, which is what keeps §6.6's second
   * invariant ("a parent's quantity bounds the sum of its children's") true by
   * construction on this side.
   */
  onSplit: (node: SalvageNode) => void
  /** No write access, or a return past the point of being edited. */
  readOnly?: boolean
}

/** The frame's `onAddRow`, which the tree never reaches: nothing here is tagged for nav. */
function noop() {}

/**
 * A multi-level condition checklist over a returned lift's bill of materials.
 *
 * A lift is built from subassemblies which have their own subassemblies and the
 * tree can be deep, so nothing is rendered that has not been asked for: the
 * card is handed the top level and asks for a node's children the first time
 * somebody opens it.
 */
export function ReturnSalvageCard({
  nodes,
  isLoading = false,
  onExpand,
  onChangeQuantity,
  onChangeStatus,
  onSplit,
  readOnly = false,
}: ReturnSalvageCardProps) {
  const tree = useSalvageTree({ onExpand })
  const [confirm, ConfirmDialog] = useConfirm()

  /**
   * A `good` answers for the whole branch beneath it, so selecting one closes
   * that branch rather than leaving a subtree on screen whose controls no
   * longer decide anything (§6.6: do not make the user check every descendant).
   *
   * When rows below it already carry a decision, that decision is about to stop
   * counting — one recovery, not two — so it is confirmed first. Best effort by
   * construction: only LOADED descendants can be counted, and a branch nobody
   * has opened in this session holds no rows in memory to warn about.
   */
  const changeStatus = useCallback(
    (node: SalvageNode, status: SalvageStatus) => {
      if (status !== 'good') {
        onChangeStatus(node, status)
        return
      }

      const superseded = decidedDescendantCount(node)
      const apply = () => {
        onChangeStatus(node, 'good')
        tree.collapse(node.key)
      }

      if (superseded === 0) {
        apply()
        return
      }

      void confirm({
        title: 'Mark the whole subassembly good?',
        description: `${superseded} component${superseded === 1 ? '' : 's'} below ${node.partName} already ${superseded === 1 ? 'has' : 'have'} a condition. A good subassembly is recovered whole, so those rows stop counting.`,
        confirmText: 'Mark good',
        cancelText: 'Cancel',
        destructive: true,
      }).then((confirmed) => {
        if (confirmed) apply()
      })
    },
    [confirm, onChangeStatus, tree]
  )

  if (isLoading) return <EmptySection loading />

  if (nodes.length === 0) {
    return (
      <EmptySection
        icon={<Wrench className='size-5' />}
        title='Nothing to inspect'
        description='This return line has no bill of materials, so there are no components to salvage.'
      />
    )
  }

  return (
    <div className='space-y-2'>
      {/* The kit's frame (money/tasks/56 section 3.3): header and rows share one
          bordered box over ONE column template. This card used to hand-copy
          the builder's frame classes, which is the copy 56 exists to stop.
          The tree rows carry no `data-line-*` tags, so the frame's spreadsheet
          nav is inert here and `onAddRow` never fires; the tree has no "add a
          row" concept, a node is materialized by deciding it. */}
      <LineGridFrame
        cols={SALVAGE_COLS}
        // `gap-x-2` matches `GridTreeRow`'s gap in `salvage-tree-row.tsx`:
        // the header uses the same template and the same gap as the rows,
        // never a second copy of either, which is how a header drifts off.
        headerClassName='gap-x-2'
        header={[
          { label: 'Component' },
          { label: 'Qty', align: 'end' },
          { label: 'Condition' },
          { label: '' },
        ]}
        rowCount={nodes.length}
        colCount={0}
        onAddRow={noop}
        readOnly={readOnly}>
        {/* `py-1` and never `p-1`: `GridTreeRow` carries its own `px-1`, and a
            second horizontal inset here would shift every row's flexible first
            column off the header's. */}
        <div className='flex flex-col gap-0.5 py-1'>
          {nodes.map((node) => (
            <SalvageTreeRow
              key={node.key}
              node={node}
              tree={tree}
              impliedGood={false}
              readOnly={readOnly}
              onChangeQuantity={onChangeQuantity}
              onChangeStatus={changeStatus}
              onSplit={onSplit}
            />
          ))}
        </div>
      </LineGridFrame>

      {/* The absence rule, said out loud. A row nobody touches never becomes a
          `return_part_line`, and the salvage writer only ever sees real rows. */}
      <p className='px-1 text-muted-foreground text-xs'>
        Components you do not touch stay undecided and are not restocked. A subassembly marked good
        is recovered whole, so there is no need to open it.
      </p>

      <ConfirmDialog />
    </div>
  )
}
