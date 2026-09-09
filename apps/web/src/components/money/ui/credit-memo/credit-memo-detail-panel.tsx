// apps/web/src/components/money/ui/credit-memo/credit-memo-detail-panel.tsx
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
 * CreditMemoDetailPanel, the single-level `credit-memos` drill on an order or
 * contact detail page (plans/accounting/tasks/10-credit-memos.md §6.2), the
 * invoice drill's recipe applied to the memo. `itemId` carries the memo's
 * RecordId. Renders the SAME items as the credit memo drawer by replaying its
 * overview recipe: the Details fields block (number, status, source, contact,
 * invoice or order, issued date, reason, note, as the registry's `showInPanel`
 * set) plus the drawer config's overview cards (Lines with the actions cluster,
 * Settlement, Ledger) through the shared `TabCardSection` wrapper, so the drill
 * stays in lockstep with the drawer as cards are added or reordered.
 */
export function CreditMemoDetailPanel({ itemId }: RecordDrillContext) {
  const creditMemoRecordId = (itemId ?? '') as RecordId
  const { record } = useRecord({ recordId: creditMemoRecordId, enabled: Boolean(itemId) })
  // Before the early return, hooks may not sit behind it. An empty recordId
  // parses to empty halves, which resolves to `false` (nothing to restrict).
  const parsed = parseRecordId(creditMemoRecordId)
  // Per-ROW read-only, the same question the drawer asks: a `read`-only member
  // must not get a full edit affordance whose save then 403s.
  const readOnly = useRecordDrawerReadOnly(parsed.entityDefinitionId, parsed.entityInstanceId)

  if (!itemId) {
    return <div className='p-6 text-sm text-muted-foreground'>Credit memo not found.</div>
  }

  const { entityInstanceId } = parsed
  const cards = getEntityDrawerConfig('credit_memo').tabCards?.overview ?? []

  return (
    <ScrollArea className='h-full' scrollbarClassName='w-1.5 z-20' noFade>
      <Section
        title='Details'
        className='[&>[data-slot=section]>[data-slot=section-content]]:pe-4'
        initialOpen
        collapsible={false}
        icon={<HouseIcon className='size-4' />}>
        <EntityFields recordId={creditMemoRecordId} readOnly={readOnly} canEdit={!readOnly} />
      </Section>
      {cards.map((card) => (
        <TabCardSection
          key={card.value}
          card={card}
          entityType='credit_memo'
          entityInstanceId={entityInstanceId}
          recordId={creditMemoRecordId}
          record={record}
        />
      ))}
    </ScrollArea>
  )
}
