// apps/web/src/components/kopilot/ui/messages/prose-table.tsx

'use client'

import { Dialog, DialogContent, DialogTitle } from '@auxx/ui/components/dialog'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { VisuallyHidden } from '@auxx/ui/components/visually-hidden'
import { cn } from '@auxx/ui/lib/utils'
import { type ReactNode, useState } from 'react'
import type { Components } from 'react-markdown'
import { BlockCard } from '../blocks/block-card'
import { ExpandButton } from '../blocks/table-block'
import {
  tableBodyCellClass,
  tableClass,
  tableHeaderCellClass,
  tableRowClass,
} from '../blocks/table-styles'

/**
 * Table-level chrome replicating `table-block.tsx`'s per-cell extras (sticky
 * header, sticky first column with edge shadow, 2xl corner rounding, last-row
 * border removal) via arbitrary variants — the GFM cell components don't know
 * their row/column position, so position-dependent styling lives here.
 */
const proseTableChrome = cn(
  '[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10',
  '[&_thead_th:first-child]:left-0 [&_thead_th:first-child]:z-20',
  '[&_thead_th:first-child]:rounded-tl-2xl [&_thead_th:last-child]:rounded-tr-2xl',
  '[&_thead_th:first-child]:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]',
  '[&_tbody_td:first-child]:sticky [&_tbody_td:first-child]:left-0',
  '[&_tbody_td:first-child]:z-10 [&_tbody_td:first-child]:bg-card',
  '[&_tbody_td:first-child]:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]',
  '[&_tbody_tr:last-child>td]:border-b-0',
  '[&_tbody_tr:last-child>td:first-child]:rounded-bl-2xl',
  '[&_tbody_tr:last-child>td:last-child]:rounded-br-2xl'
)

/** Minimal hast shape — avoids a direct dependency on the `hast` package. */
interface HastNode {
  tagName?: string
  children?: HastNode[]
}

/** Count body rows from the markdown AST node (cells are opaque React children). */
function countTableRows(node: unknown): number | undefined {
  const tbody = (node as HastNode | undefined)?.children?.find((c) => c.tagName === 'tbody')
  if (!tbody?.children) return undefined
  return tbody.children.filter((c) => c.tagName === 'tr').length
}

/**
 * Plain GFM markdown tables in assistant prose, rendered with the same
 * `BlockCard` chrome as the `auxx:table` block so both table paths look
 * identical. Cell *content* still comes from the markdown tree (no typed
 * cells), which is the remaining difference from `auxx:table`.
 */
export function ProseTable({ rowCount, children }: { rowCount?: number; children: ReactNode }) {
  const [isExpanded, setIsExpanded] = useState(false)

  const table = (
    <table
      className={cn(tableClass, proseTableChrome)}
      style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
      {children}
    </table>
  )

  const rowLabel =
    rowCount !== undefined ? `${rowCount} ${rowCount === 1 ? 'row' : 'rows'}` : undefined

  return (
    // No `not-prose`: cell content is markdown (links, inline code) and should
    // keep prose styling — unlike auxx:table, whose cells are typed components.
    <div className='my-2'>
      <BlockCard
        data-slot='prose-table-block'
        className='**:data-[slot=block-card-body]:p-0'
        primaryText='Table'
        hasFooter={false}
        hasHeader
        secondaryText={
          rowLabel && <span className='text-xs text-muted-foreground'>{rowLabel}</span>
        }
        headerActions={
          <ExpandButton isExpanded={false} onExpandChange={setIsExpanded} insetHeader />
        }>
        <ScrollArea
          orientation='horizontal'
          allowScrollChaining
          className='overflow-hidden rounded-xl'>
          <div className='pb-2'>{table}</div>
        </ScrollArea>
      </BlockCard>

      <Dialog open={isExpanded} onOpenChange={setIsExpanded}>
        <DialogContent size='3xl' innerClassName='h-[80vh] flex flex-col p-0' showClose={false}>
          <VisuallyHidden>
            <DialogTitle>Table</DialogTitle>
          </VisuallyHidden>
          <div className='flex shrink-0 items-center justify-between border-b px-4 py-3'>
            <span className='text-xs font-semibold text-foreground/90'>Table</span>
            <span className='flex items-center gap-1.5'>
              {rowLabel && <span className='text-xs text-muted-foreground'>{rowLabel}</span>}
              <ExpandButton isExpanded onExpandChange={setIsExpanded} />
            </span>
          </div>
          <div className='min-h-0 flex-1 overflow-hidden'>
            <ScrollArea orientation='both' className='h-full'>
              <div className='pb-2'>{table}</div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * react-markdown component overrides that route GFM tables through
 * {@link ProseTable}. Spread into any components map that renders assistant
 * prose (kopilot chat, eval traces) so tables look the same everywhere.
 * `className` merges so remark-gfm's `:---:` alignment (passed as style/align
 * props) survives the spread.
 */
export const proseTableComponents: Components = {
  table({ node, children }) {
    return <ProseTable rowCount={countTableRows(node)}>{children}</ProseTable>
  },
  th({ node: _node, className, ...props }) {
    return <th {...props} className={cn(tableHeaderCellClass, className)} />
  },
  td({ node: _node, className, ...props }) {
    return <td {...props} className={cn(tableBodyCellClass, 'border-b', className)} />
  },
  tr({ node: _node, className, ...props }) {
    return <tr {...props} className={cn(tableRowClass, className)} />
  },
}
