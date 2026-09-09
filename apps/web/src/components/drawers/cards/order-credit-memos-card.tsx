// apps/web/src/components/drawers/cards/order-credit-memos-card.tsx
'use client'

// Order drawer overview block for the credit memos taken against this order
// (plans/accounting/tasks/10-credit-memos.md §6.1): the card task 47 planned as
// "refunds inside the order", under the entity's real name. Read-only: a channel
// memo is created by the connector and reviewed in the Credit memos list, and a
// native memo is raised from an invoice, so there is no create action to mirror.
//
// `order_credit_memos` is hidden from the Details field panel, so this card is
// where the relation surfaces.

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSettings } from '~/hooks/use-settings'
import type { DrawerTabProps } from '../drawer-tab-registry'
import { CreditMemoRow } from './credit-memo-row'
import { EmptyRow, RowSkeleton, TREE_SECONDARY_NOTRUNCATE } from './related-record-row'

export function OrderCreditMemosCard({ recordId }: DrawerTabProps) {
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const { values, isLoading } = useSystemValues(recordId, ['order_credit_memos'], {
    autoFetch: true,
  })
  const memoRecordIds = extractRelationshipRecordIds(values.order_credit_memos)

  if (isLoading) return <RowSkeleton />
  if (memoRecordIds.length === 0) return <EmptyRow label='No credit memos' />

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      {memoRecordIds.map((id) => (
        <CreditMemoRow key={id} recordId={id} currencyCode={currencyCode} showIssuedAt />
      ))}
    </div>
  )
}
