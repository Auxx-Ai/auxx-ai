// apps/web/src/components/mrp/ui/company/company-supply-block.tsx

'use client'

import { MRP_MIN_RECEIPTS } from '@auxx/lib/mrp/client'
import { Badge } from '@auxx/ui/components/badge'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { Package } from 'lucide-react'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { EMPTY_CELL } from '~/components/global/module-toolbar'
import { api, type RouterOutputs } from '~/trpc/react'
import { formatDays, formatQty } from '../part/key-numbers'

type VendorPartSupply = RouterOutputs['mrp']['supplierPerformance']['vendorParts'][number]

function percent(value: number | null): string {
  return value === null ? EMPTY_CELL : `${Math.round(value * 100)} %`
}

/** One row per vendor part: stated vs observed supply (07 §4.7, 02 §6.2); nothing without vendor parts. */
export function CompanySupplyBlock({ entityInstanceId: supplierId }: DrawerTabProps) {
  const performance = api.mrp.supplierPerformance.useQuery({ supplierId })
  const vendorParts = performance.data?.vendorParts ?? []
  if (vendorParts.length === 0) return null

  return (
    <TreeRowList
      className='@container gap-px'
      items={vendorParts}
      getKey={(vp, i) => vp.vendorPartId ?? `${vp.partId ?? 'part'}:${i}`}
      renderRow={(vp) => <SupplyRow vp={vp} />}
    />
  )
}

function SupplyRow({ vp }: { vp: VendorPartSupply }) {
  const { stated, stats } = vp
  const thin = stats.count < MRP_MIN_RECEIPTS
  return (
    <TreeRow
      icon={<Package className='size-4 text-muted-foreground' />}
      title={<span className='truncate text-sm'>{vp.partName ?? 'Unnamed part'}</span>}
      description={vp.partSku ?? undefined}
      secondary={
        vp.leadTimeDrift ? (
          <SimpleTooltip
            content={`Observed median ${formatDays(stats.medianLeadTimeDays)} vs stated ${formatDays(stated.leadTimeDays)}`}>
            <Badge variant='amber' size='xs'>
              lead time drift
            </Badge>
          </SimpleTooltip>
        ) : undefined
      }
      actions={
        <div className='flex items-center gap-3 pe-1 font-mono text-muted-foreground text-xs tabular-nums'>
          <SimpleTooltip content='Stated lead time → observed median / p90'>
            <span>
              {formatDays(stated.leadTimeDays)} →{' '}
              <span className='text-foreground'>{formatDays(stats.medianLeadTimeDays)}</span> /{' '}
              {formatDays(stats.p90LeadTimeDays)}
            </span>
          </SimpleTooltip>
          <SimpleTooltip content='On time'>
            <span className='hidden @md:inline'>{percent(stats.onTimeRate)}</span>
          </SimpleTooltip>
          <SimpleTooltip content='Fill rate'>
            <span className='hidden @md:inline'>{percent(stats.avgFill)}</span>
          </SimpleTooltip>
          <SimpleTooltip content='Typical order size vs MOQ'>
            <span className='hidden @lg:inline'>
              {formatQty(vp.medianLineQuantity)} / {formatQty(stated.minOrderQty)}
            </span>
          </SimpleTooltip>
          <SimpleTooltip
            content={
              thin
                ? `Fewer than ${MRP_MIN_RECEIPTS} clean receipts: not trusted yet`
                : 'Clean receipts'
            }>
            <span className={cn('w-8 text-right', thin && 'text-amber-600')}>{stats.count}×</span>
          </SimpleTooltip>
        </div>
      }
    />
  )
}
