// packages/lib/src/accounting/money/customer-money/record-marks.ts

import { parseRecordId, type RecordId } from '@auxx/types/resource'
import type { DefEntityTypeResolver } from '../../../events/handlers/passes/fulfillment-log-pass'
import type { FieldChangeRef, MarkHandler } from '../../../field-hooks/types'
import { relationshipInstanceIds } from '../../../field-values/relationship-field'
import { markPayoutForAssessment } from '../payouts/payout-reconciler'
import { BRIDGE_ATTRIBUTES } from './bridge'
import { markOrderEvidence, type OrderEvidenceKind } from './order-evidence-reconciler'

const SYSTEM_ACTOR = 'system'

// Not `BRIDGE_ATTRIBUTES.order`: its `order_payment_source_updated_at` moves on every order sync.
const ORDER_ATTRS = new Set([
  'order_payment_source_complete',
  'order_total',
  'order_contact',
  'order_currency',
])

const attributeOf = (event: FieldChangeRef): string | undefined =>
  event.field.systemAttribute ?? undefined

const instanceIdOf = (event: FieldChangeRef): string =>
  parseRecordId(event.recordId).entityInstanceId

/** A bridged transaction field moved: its order's evidence is stale. */
export const markEvidenceOnCustomerTransactionChange: MarkHandler = async (event) => {
  const attr = attributeOf(event)
  if (!attr || !BRIDGE_ATTRIBUTES.customer_transaction.has(attr)) return
  await markOrderEvidence(
    event.organizationId,
    event.userId,
    'customer_transaction',
    instanceIdOf(event)
  )
}

/** A line re-parented: mark it, and the vacated order when the lane carries `oldValue`. */
export const markEvidenceOnLineItemChange: MarkHandler = async (event) => {
  if (attributeOf(event) !== 'line_item_order') return
  await markOrderEvidence(event.organizationId, event.userId, 'line_item', instanceIdOf(event))
  for (const orderInstanceId of relationshipInstanceIds(event.oldValue))
    await markOrderEvidence(event.organizationId, event.userId, 'order', orderInstanceId)
}

/** One of the order inputs the evidence assessment reads moved. */
export const markEvidenceOnOrderChange: MarkHandler = async (event) => {
  const attr = attributeOf(event)
  if (!attr || !ORDER_ATTRS.has(attr)) return
  await markOrderEvidence(event.organizationId, event.userId, 'order', instanceIdOf(event))
}

/** A bridged payout field moved: reassess the payout. */
export const assessOnPayoutChange: MarkHandler = async (event) => {
  const attr = attributeOf(event)
  if (!attr || !BRIDGE_ATTRIBUTES.payout.has(attr)) return
  await markPayoutForAssessment(event.organizationId, event.userId, instanceIdOf(event))
}

/** A bridged balance-entry field moved: reassess the payout it settles in. */
export const assessOnProcessorBalanceEntryChange: MarkHandler = async (event) => {
  const attr = attributeOf(event)
  if (!attr || !BRIDGE_ATTRIBUTES.processor_balance_entry.has(attr)) return
  await markPayoutForAssessment(event.organizationId, event.userId, instanceIdOf(event))
}

const ORDER_EVIDENCE_TYPES = new Set<string>(['order', 'line_item', 'customer_transaction'])
const PAYOUT_TYPES = new Set<string>(['payout', 'processor_balance_entry'])

/** Mark archived financial records, which fire no field change, onto their reconcilers. */
export async function markArchivedFinancialRecords(
  organizationId: string,
  recordIds: RecordId[],
  resolveDef: DefEntityTypeResolver
): Promise<void> {
  for (const recordId of recordIds) {
    const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
    const entityType = (await resolveDef(entityDefinitionId))?.entityType
    if (!entityType) continue
    if (ORDER_EVIDENCE_TYPES.has(entityType))
      await markOrderEvidence(
        organizationId,
        SYSTEM_ACTOR,
        entityType as OrderEvidenceKind,
        entityInstanceId
      )
    else if (PAYOUT_TYPES.has(entityType))
      await markPayoutForAssessment(organizationId, SYSTEM_ACTOR, entityInstanceId)
  }
}
