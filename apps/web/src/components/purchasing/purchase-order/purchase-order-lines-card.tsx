// apps/web/src/components/purchasing/purchase-order/purchase-order-lines-card.tsx
'use client'

// The purchase order drawer's Overview "Lines" card — the `purchase_order:lines`
// entry of `drawer-config.ts` (plans/purchasing/01-build-plan.md §4.4).
//
// One prop away from the detail page's Lines section, which is the same relation
// `order`/`quote` have between their tab and their drawer card: forcing
// `variant='section'` height-caps the table inside the Overview scroll column
// instead of letting it own a full-height scroll of its own. The "Lines" title
// itself is rendered by the drawer's `TabCardSection` wrapper, so this card must
// not draw one.

import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { PurchaseOrderLinesTab } from './purchase-order-lines-tab'

export function PurchaseOrderLinesCard(props: DrawerTabProps) {
  return <PurchaseOrderLinesTab {...props} variant='section' />
}
