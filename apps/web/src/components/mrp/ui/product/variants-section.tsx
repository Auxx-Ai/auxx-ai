// apps/web/src/components/mrp/ui/product/variants-section.tsx
'use client'

import { MRP_SUGGESTION_KIND_LABELS } from '@auxx/lib/mrp/client'
import { PartKind, toRecordId } from '@auxx/lib/resources/client'
import { Section } from '@auxx/ui/components/section'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { Package, PanelRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { EMPTY_CELL } from '~/components/global/module-toolbar'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'
import { RecordLink } from '~/components/resources/ui/record-link'
import { useRecordLink } from '~/components/resources/utils/get-record-link'
import { api, type RouterOutputs } from '~/trpc/react'
import { formatDay, formatDays, formatQty, StockStatusDot } from '../part/key-numbers'

type ProductVariant = RouterOutputs['mrp']['productItem']['variants'][number]

const KIND_LABEL: Record<string, string> = Object.fromEntries(
  PartKind.values.map((v) => [v.value, v.label])
)

interface VariantsSectionProps {
  productId: string
  runId: string | null
}

/** The family's variants in run rank order, services last and greyed (15 §3.3, D38). */
export function VariantsSection({ productId, runId }: VariantsSectionProps) {
  const query = api.mrp.productItem.useQuery({ productId, runId })
  const variants = query.data?.variants ?? []
  if (!query.isLoading && variants.length === 0) return null

  return (
    <Section title='Variants'>
      <TreeRowList
        className='gap-px'
        loading={query.isLoading}
        skeletonCount={3}
        items={variants}
        getKey={(v) => v.partId}
        renderRow={(v) => <VariantRow variant={v} />}
      />
    </Section>
  )
}

function VariantRow({ variant: v }: { variant: ProductVariant }) {
  const recordId = toRecordId('part', v.partId)
  const href = useRecordLink(recordId, { tab: 'mrp' })
  const openRecord = useOpenRecord()
  const router = useRouter()
  const open = () => {
    if (openRecord) openRecord(recordId, { tab: 'mrp' })
    else if (href) router.push(href)
  }

  const item = v.item
  const kindLabel = v.kind ? (KIND_LABEL[v.kind] ?? v.kind) : null

  return (
    <TreeRow
      icon={<Package className='size-4 text-muted-foreground' />}
      onToggleOpen={open}
      description={v.sku ?? undefined}
      title={
        <span className='flex min-w-0 items-center gap-1.5'>
          {/* The row click opens too; stop it so a link click pushes once. */}
          <span className='min-w-0 truncate text-sm' onClick={(e) => e.stopPropagation()}>
            <RecordLink recordId={recordId} link={{ tab: 'mrp' }} openInStack>
              {v.name ?? 'Unnamed part'}
            </RecordLink>
          </span>
          {kindLabel && (
            <span className={cn(recordBadgeVariants({ size: 'sm' }), 'w-fit shrink-0 px-1.5')}>
              {kindLabel}
            </span>
          )}
        </span>
      }
      secondary={
        <span className='inline-flex min-w-0 items-center gap-2 text-muted-foreground text-xs'>
          {!v.stocked ? (
            'not planned'
          ) : !item ? (
            'not in this run'
          ) : (
            <>
              <StockStatusDot status={v.stockStatus} />
              {item.daysOfCover !== null && (
                <span className='tabular-nums'>{formatDays(item.daysOfCover)} cover</span>
              )}
              {item.isOverdue ? (
                <span className='text-destructive'>overdue</span>
              ) : item.orderByDate ? (
                <span>order by {formatDay(item.orderByDate)}</span>
              ) : null}
            </>
          )}
        </span>
      }
      actions={
        <div className='flex shrink-0 items-center gap-3 font-mono text-xs tabular-nums'>
          <span>{v.stocked ? formatQty(item?.onHand ?? v.quantityOnHand) : EMPTY_CELL}</span>
          <span className='w-20 truncate text-right'>
            {item?.suggestionKind && item.suggestedQty !== null
              ? `${MRP_SUGGESTION_KIND_LABELS[item.suggestionKind]} ${formatQty(item.suggestedQty)}`
              : EMPTY_CELL}
          </span>
          <span className='w-10 text-right'>
            {v.stocked ? `${Math.round(v.share * 100)} %` : EMPTY_CELL}
          </span>
          <TreeRowButton persistent tooltipText='Open details' onClick={open}>
            <PanelRight />
          </TreeRowButton>
        </div>
      }
      rowClassName={cn(!v.stocked && 'text-muted-foreground opacity-60')}
    />
  )
}
