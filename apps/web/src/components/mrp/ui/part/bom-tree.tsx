// apps/web/src/components/mrp/ui/part/bom-tree.tsx
'use client'

import { MRP_SUGGESTION_KIND_LABELS } from '@auxx/lib/mrp/client'
import { toRecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { SECTION_BLEED, Section } from '@auxx/ui/components/section'
import { Spinner } from '@auxx/ui/components/spinner'
import { GridTreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Boxes, Package } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { useMemo } from 'react'
import { EMPTY_CELL } from '~/components/global/module-toolbar'
import { Tooltip } from '~/components/global/tooltip'
import { LineGridFrame } from '~/components/line-grid/ui/line-grid-frame'
import { useDrawerTabParam, useOpenRecord } from '~/components/records/record-drill-panels'
import { useRecordLink } from '~/components/resources/utils/get-record-link'
import { type LazyTreeState, useLazyTree } from '~/hooks/use-lazy-tree'
import { api, type RouterOutputs } from '~/trpc/react'
import { formatDay, formatQty, StockStatusDot } from './key-numbers'

type BomNodeData = RouterOutputs['mrp']['partItem']['bom'][number]

interface BomTreeNode extends BomNodeData {
  children: BomTreeNode[]
}

/** part | status | on hand | order by | suggestion, for the header and every row at every depth. */
export const MRP_BOM_COLS =
  'minmax(7rem, 1fr) minmax(4.5rem, 6.5rem) minmax(3rem, 4.5rem) minmax(3.5rem, 5rem) minmax(4.5rem, 7rem)'

/** The part's `Components` tab, where the BOM is edited. */
const COMPONENTS_TAB = 'subparts'

interface BomTreeSectionProps {
  partId: string
  runId?: string | null
}

/** The part's bill of materials with each node's run values, read-only (07 §4.6). */
export function BomTreeSection({ partId, runId }: BomTreeSectionProps) {
  const partItem = api.mrp.partItem.useQuery({ partId, runId })
  const sellThrough = api.mrp.sellThrough.useQuery({ partId, runId })
  const [, setTab] = useQueryState(useDrawerTabParam())

  const bom = partItem.data?.bom
  const roots = useMemo(() => (bom ? buildTree(bom) : []), [bom])

  if (!bom || bom.length === 0) return null

  return (
    <Section
      title='Bill of materials'
      className={SECTION_BLEED}
      actions={
        <Button variant='ghost' size='sm' onClick={() => void setTab(COMPONENTS_TAB)}>
          Edit on Components
        </Button>
      }>
      <BomTree roots={roots} limitingPartId={sellThrough.data?.limiting?.partId ?? null} />
    </Section>
  )
}

/** Header gap matches the rows; `pr-7` leaves room for the rows' trailing drill chevron. */
function BomTree({
  roots,
  limitingPartId,
}: {
  roots: BomTreeNode[]
  limitingPartId: string | null
}) {
  const tree = useLazyTree<BomTreeNode>({
    initialExpanded: roots.filter((n) => n.children.length > 0).map((n) => n.key),
  })

  return (
    <LineGridFrame
      cols={MRP_BOM_COLS}
      className='rounded-none border-x-0'
      headerClassName='gap-x-2 rounded-none pr-7'
      header={[
        { label: 'Part' },
        { label: 'Status' },
        { label: 'On hand', align: 'end' },
        { label: 'Order by', align: 'end' },
        { label: 'Suggestion', align: 'end' },
      ]}
      rowCount={roots.length}
      colCount={0}
      onAddRow={noop}
      readOnly>
      <div className='flex flex-col gap-0.5 py-1'>
        {roots.map((node) => (
          <BomTreeRow key={node.key} node={node} tree={tree} limitingPartId={limitingPartId} />
        ))}
      </div>
    </LineGridFrame>
  )
}

function BomTreeRow({
  node,
  tree,
  limitingPartId,
}: {
  node: BomTreeNode
  tree: LazyTreeState<BomTreeNode>
  limitingPartId: string | null
}) {
  const recordId = toRecordId('part', node.partId)
  const push = useOpenRecord()
  const href = useRecordLink(recordId)
  const router = useRouter()

  const expandable = node.children.length > 0
  const expanding = tree.isExpanding(node.key)
  const item = node.item
  const limiting = node.partId === limitingPartId
  const suggestion =
    item?.suggestionKind && item.suggestedQty
      ? `${MRP_SUGGESTION_KIND_LABELS[item.suggestionKind]} ${formatQty(item.suggestedQty)}`
      : EMPTY_CELL

  const drill = push ? () => push(recordId) : href ? () => router.push(href) : undefined

  return (
    <GridTreeRow
      columns={MRP_BOM_COLS}
      rowClassName='gap-x-2'
      depth={node.depth - 1}
      expandable={expandable}
      chevronOnHover
      isOpen={tree.isExpanded(node.key)}
      onToggleOpen={expandable ? () => tree.toggle(node) : undefined}
      onDrill={drill}
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
          <span className='min-w-0 truncate text-sm'>{node.name ?? 'Unnamed part'}</span>
          {node.parentCount > 1 && (
            <Badge variant='outline' size='xs' className='shrink-0'>
              shared ×{node.parentCount}
            </Badge>
          )}
        </span>
      }
      cells={[
        <span key='status' className='truncate pl-2 text-xs'>
          <StockStatusDot status={node.stockStatus} />
        </span>,
        <span key='onHand' className='w-full pr-2 text-right font-mono text-xs tabular-nums'>
          {formatQty(item?.onHand)}
        </span>,
        <span
          key='orderBy'
          className={cn(
            'w-full pr-2 text-right font-mono text-xs tabular-nums',
            limiting && 'font-medium text-amber-600',
            item?.isOverdue && 'text-destructive'
          )}>
          {limiting ? (
            <Tooltip content='Limiting part: the first component to run out.'>
              <span>{formatDay(item?.orderByDate)} ◂</span>
            </Tooltip>
          ) : (
            formatDay(item?.orderByDate)
          )}
        </span>,
        <span key='suggestion' className='w-full truncate pr-2 text-right text-xs tabular-nums'>
          {suggestion}
        </span>,
      ]}>
      {node.children.map((child) => (
        <BomTreeRow key={child.key} node={child} tree={tree} limitingPartId={limitingPartId} />
      ))}
    </GridTreeRow>
  )
}

/** The frame's `onAddRow`; a read-only tree never reaches it. */
function noop() {}

/** Nest `partItem`'s depth-first rows by `parentKey`. */
function buildTree(rows: readonly BomNodeData[]): BomTreeNode[] {
  const byKey = new Map<string, BomTreeNode>()
  const roots: BomTreeNode[] = []
  for (const row of rows) {
    const node: BomTreeNode = { ...row, children: [] }
    byKey.set(row.key, node)
    const parent = row.parentKey ? byKey.get(row.parentKey) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}
