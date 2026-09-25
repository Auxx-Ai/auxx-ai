// apps/web/src/components/mrp/ui/company/company-next-order-block.tsx

'use client'

import { EmptySection } from '@auxx/ui/components/section'
import { TreeRowSkeleton } from '@auxx/ui/components/tree-row'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { api } from '~/trpc/react'
import { SupplierOrderCard } from '../suppliers/supplier-order-card'

/** The supplier's next order from the latest run (07 §4.2, D28). */
export function CompanyNextOrderBlock({ entityInstanceId: supplierId }: DrawerTabProps) {
  const performance = api.mrp.supplierPerformance.useQuery({ supplierId })
  if (performance.isPending) return <TreeRowSkeleton />
  if (!performance.data?.vendorParts.length) {
    return <EmptySection orientation='horizontal' title='No vendor parts from this supplier yet' />
  }
  return <SupplierOrderCard supplierId={supplierId} variant='block' />
}
