// apps/web/src/components/purchasing/vendor-bill/page/vendor-bill-page-panel.tsx
'use client'

// The right pane of the vendor bill's page (plans/money/tasks/58 §6.3):
// `invoice-detail-panel.tsx` copied with the entity type swapped, plus the
// optional read banner slot the bill's page threads in above the cards.

import { getEntityDrawerConfig } from '@auxx/lib/resources/client'
import type { RecordId } from '@auxx/types/resource'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { HouseIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { TabCardSection } from '~/components/drawers/base-entity-drawer'
import EntityFields from '~/components/fields/entity-fields'
import { useRecordDrawerReadOnly } from '~/components/records/use-record-drawer-read-only'
import { parseRecordId, useCanViewRecordResource, useRecord } from '~/components/resources'
import { useAccess } from '~/providers/capabilities-provider'

interface VendorBillPagePanelProps {
  vendorBillRecordId: RecordId
  /** The read banner, when a bill-intake run exists for this bill (§6.3). */
  banner?: ReactNode
}

export function VendorBillPagePanel({ vendorBillRecordId, banner }: VendorBillPagePanelProps) {
  const { record } = useRecord({ recordId: vendorBillRecordId })
  const parsed = parseRecordId(vendorBillRecordId)
  // Per-ROW read-only, the same question the drawer asks. `EntityFields`
  // defaults `readOnly` to `false`, so without this a `read`-only member got a
  // full edit affordance here and the save 403'd.
  const readOnly = useRecordDrawerReadOnly(parsed.entityDefinitionId, parsed.entityInstanceId)

  const { can } = useAccess()
  const canViewRecordResource = useCanViewRecordResource()

  const { entityInstanceId } = parsed
  // Same two gates `detail-view-sidebar.tsx` applies to `sidebarCards`: a
  // Layer-2 capability key and a Layer-3 per-definition presence check, so a
  // member missing either sees the same card set here as in the drawer.
  const cards = (getEntityDrawerConfig('vendor_bill').tabCards?.overview ?? [])
    .filter((card) => !card.permissionKey || can(card.permissionKey))
    .filter((card) => canViewRecordResource(card.recordResource))

  return (
    <ScrollArea className='h-full' scrollbarClassName='w-1.5 z-20' noFade>
      {banner}
      <Section
        title='Details'
        className='[&>[data-slot=section]>[data-slot=section-content]]:pe-4'
        initialOpen
        collapsible={false}
        icon={<HouseIcon className='size-4' />}>
        <EntityFields recordId={vendorBillRecordId} readOnly={readOnly} canEdit={!readOnly} />
      </Section>
      {cards.map((card) => (
        <TabCardSection
          key={card.value}
          card={card}
          entityType='vendor_bill'
          entityInstanceId={entityInstanceId}
          recordId={vendorBillRecordId}
          record={record}
        />
      ))}
    </ScrollArea>
  )
}
