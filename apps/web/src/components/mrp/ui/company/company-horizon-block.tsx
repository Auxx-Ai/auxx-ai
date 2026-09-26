// apps/web/src/components/mrp/ui/company/company-horizon-block.tsx

'use client'

import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { SupplierHorizonChart } from '../charts/supplier-horizon'

/** The supplier's horizon chart on the Purchasing tab (16 §3, D38); the block supplies the title. */
export function CompanyHorizonBlock({ entityInstanceId: supplierId }: DrawerTabProps) {
  return <SupplierHorizonChart supplierId={supplierId} variant='section' bare />
}
