// apps/web/src/components/drawers/tabs/product-parts-tab.tsx
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type { RecordId } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { formatCurrency } from '@auxx/utils/currency'
import { Package } from 'lucide-react'
import Link from 'next/link'
import { useMemo } from 'react'
import { toRecordId, useRecordList, useResourceProperty } from '~/components/resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import type { DrawerTabProps } from '../drawer-tab-registry'

/** What each variant row shows — the company-parts-tab column recipe. */
const VARIANT_ROW_ATTRIBUTES = [
  'part_title',
  'part_sku',
  'part_cost',
  'part_quantity_on_hand',
] as const

/**
 * Variants tab for the product drawer AND detail page — the product's parts as
 * rows via the single family edge (`part.product` / `product.parts`,
 * plans/products/01-product-family.md §5). Rows are plain `part` records
 * filtered on the belongs_to side (`part:product`), the same read the part
 * drawer's Family card uses for siblings.
 *
 * Read-only by design: a part joins a family from its own Details panel
 * (`product` relation field); this list has no create/detach affordance in v1.
 */
export function ProductPartsTab({ entityInstanceId }: DrawerTabProps) {
  const partDefId = useResourceProperty('part', 'id')

  // Parts belonging to this product family
  const filters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'product-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'product-match',
            fieldId: 'part:product' as ResourceFieldId,
            operator: 'is' as const,
            value: entityInstanceId,
          },
        ],
      },
    ],
    [entityInstanceId]
  )

  const { records, isLoading } = useRecordList({
    entityDefinitionId: partDefId ?? '',
    filters,
    enabled: !!entityInstanceId && !!partDefId,
  })

  if (isLoading) {
    return (
      <div className='p-4 space-y-4'>
        <Skeleton className='h-6 w-32' />
        <Skeleton className='h-40 w-full' />
      </div>
    )
  }

  return (
    <ScrollArea className='flex-1'>
      <Section
        title={`Variants (${records.length})`}
        className='flex flex-col flex-1 min-h-0 w-full [&_[data-slot=section]]:flex-1 [&_[data-slot=section]]:border-b-0 [&_[data-slot=section-content]]:flex-1'
        collapsible={false}
        icon={<Package className='size-4 text-muted-foreground/50' />}>
        {records.length === 0 ? (
          <div className='flex h-24 flex-col items-center justify-center text-center border rounded-lg bg-muted/30'>
            <Package className='mb-2 h-6 w-6 text-muted-foreground' />
            <p className='text-sm text-muted-foreground'>No variants yet</p>
            <p className='text-xs text-muted-foreground'>
              Link parts to this product via the part&apos;s Product field
            </p>
          </div>
        ) : (
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Part</TableHead>
                  <TableHead className='text-right'>Cost</TableHead>
                  <TableHead className='text-right'>On Hand</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <ProductPartRow
                    key={record.id}
                    partId={record.id}
                    recordId={toRecordId(partDefId!, record.id)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </ScrollArea>
  )
}

/** One variant row: title + SKU (links to the part), cost, quantity on hand. */
function ProductPartRow({ partId, recordId }: { partId: string; recordId: RecordId }) {
  const { values } = useSystemValues(recordId, VARIANT_ROW_ATTRIBUTES, { autoFetch: true })
  const title = values.part_title as string | undefined
  const sku = values.part_sku as string | undefined
  const cost = values.part_cost as number | null | undefined
  const quantityOnHand = values.part_quantity_on_hand as number | null | undefined

  return (
    <TableRow>
      <TableCell className='font-medium'>
        <div className='flex flex-col'>
          <Link href={`/app/parts?id=${partId}`} className='truncate hover:underline'>
            {title ?? 'Loading...'}
          </Link>
          {sku && <span className='text-xs text-muted-foreground'>{sku}</span>}
        </div>
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {cost != null ? formatCurrency(cost) : <span className='text-muted-foreground'>—</span>}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {quantityOnHand != null ? quantityOnHand : <span className='text-muted-foreground'>—</span>}
      </TableCell>
    </TableRow>
  )
}
