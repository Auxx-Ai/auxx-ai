// apps/web/src/components/drawers/cards/part-inventory-tab.tsx
'use client'

import type { DrawerTabProps } from '../drawer-tab-registry'
import { PartInventoryCard } from './part-inventory-card'
import { PartLinkedInventoryCard } from './part-linked-inventory-card'

/**
 * The part "Inventory" tab: the stock/movements card plus the linked inventory-sources console
 * (v9 bridge — renders only when the part has links).
 */
export function PartInventoryTab(props: DrawerTabProps) {
  return (
    <div className='flex flex-col gap-3'>
      <PartInventoryCard {...props} />
      <PartLinkedInventoryCard partId={props.entityInstanceId} />
    </div>
  )
}
