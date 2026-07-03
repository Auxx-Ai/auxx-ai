// apps/web/src/components/drawers/cards/part-inventory-tab.tsx
'use client'

import type { DrawerTabProps } from '../drawer-tab-registry'
import { PartInventoryCard } from './part-inventory-card'

/**
 * The part "Inventory" tab: the stock/movements card, which now also folds in the linked
 * inventory-sources console (v9 bridge) as a section when the part has synced feeds.
 */
export function PartInventoryTab(props: DrawerTabProps) {
  return (
    <div className='flex flex-col gap-3'>
      <PartInventoryCard {...props} />
    </div>
  )
}
