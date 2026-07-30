// apps/web/src/components/money/ui/invoice/invoice-detail-panel.tsx
'use client'

import { getEntityDrawerConfig } from '@auxx/lib/resources/client'
import type { RecordId } from '@auxx/types/resource'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { HouseIcon } from 'lucide-react'
import { TabCardSection } from '~/components/drawers/base-entity-drawer'
import EntityFields from '~/components/fields/entity-fields'
import type { RecordDrillContext } from '~/components/records/record-drill-panels'
import { useRecordDrawerReadOnly } from '~/components/records/use-record-drawer-read-only'
import { parseRecordId, useRecord } from '~/components/resources'

/**
 * InvoiceDetailPanel — the single-level `invoices` drill on a work order
 * (deliberately NO list level; surfaces list invoices themselves and drill
 * straight in). `itemId` carries the invoice's RecordId. Renders the SAME
 * items as the regular invoice drawer by replaying its overview recipe: the
 * Details fields block plus the invoice drawer config's overview cards (Line
 * items with the document actions cluster, Billing context, Payments) through
 * the shared `TabCardSection` wrapper — so the drill stays in lockstep with
 * the drawer as cards are added or reordered.
 */
export function InvoiceDetailPanel({ itemId }: RecordDrillContext) {
  const invoiceRecordId = (itemId ?? '') as RecordId
  const { record } = useRecord({ recordId: invoiceRecordId, enabled: Boolean(itemId) })
  // Before the early return — hooks may not sit behind it. An empty recordId
  // parses to empty halves, which resolves to `false` (nothing to restrict).
  const parsed = parseRecordId(invoiceRecordId)
  // Per-ROW read-only, the same question the drawer asks. `EntityFields`
  // defaults `readOnly` to `false`, so without this a `read`-only member got a
  // full edit affordance here and the save 403'd.
  const readOnly = useRecordDrawerReadOnly(parsed.entityDefinitionId, parsed.entityInstanceId)

  if (!itemId) {
    return <div className='p-6 text-sm text-muted-foreground'>Invoice not found.</div>
  }

  const { entityInstanceId } = parsed
  const cards = getEntityDrawerConfig('invoice').tabCards?.overview ?? []

  return (
    <ScrollArea className='h-full' scrollbarClassName='w-1.5 z-20' noFade>
      <Section
        title='Details'
        className='[&>[data-slot=section]>[data-slot=section-content]]:pe-4'
        initialOpen
        collapsible={false}
        icon={<HouseIcon className='size-4' />}>
        <EntityFields recordId={invoiceRecordId} readOnly={readOnly} canEdit={!readOnly} />
      </Section>
      {cards.map((card) => (
        <TabCardSection
          key={card.value}
          card={card}
          entityType='invoice'
          entityInstanceId={entityInstanceId}
          recordId={invoiceRecordId}
          record={record}
        />
      ))}
    </ScrollArea>
  )
}
