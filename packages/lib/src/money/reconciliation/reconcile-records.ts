// packages/lib/src/money/reconciliation/reconcile-records.ts
import { type Database, schema } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { getCachedResources } from '../../cache'
import { reconcileOrderPaymentEvidence } from '../customer-money/record-evidence'
import {
  type FinancialReconciliationRequest,
  reconcileFinancialRecords as reconcilePayoutRecords,
} from '../payouts/reconcile-records'

/** Route changed records to their financial owners, resolving child relationships in batches. */
export async function reconcileFinancialRecords(
  db: Database,
  request: FinancialReconciliationRequest & { previousOrderIds?: string[] }
): Promise<number> {
  const resources = await getCachedResources(request.organizationId)
  const byId = new Map(resources.map((resource) => [resource.id, resource]))
  const orders = new Set(request.previousOrderIds ?? [])
  const lines = new Set<string>()
  const payouts: typeof request.recordIds = []
  for (const recordId of new Set(request.recordIds)) {
    const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
    const type = byId.get(entityDefinitionId)?.entityType
    if (type === 'order') orders.add(entityInstanceId)
    else if (type === 'line_item' || type === 'customer_transaction') lines.add(entityInstanceId)
    else if (type === 'payout' || type === 'processor_balance_entry') payouts.push(recordId)
  }
  const lineIds = [...lines]
  for (let start = 0; start < lineIds.length; start += 1000) {
    const parents = await db
      .select({ id: schema.FieldValue.relatedEntityId })
      .from(schema.FieldValue)
      .innerJoin(
        schema.CustomField,
        and(
          eq(schema.CustomField.organizationId, schema.FieldValue.organizationId),
          eq(schema.CustomField.id, schema.FieldValue.fieldId)
        )
      )
      .where(
        and(
          eq(schema.FieldValue.organizationId, request.organizationId),
          inArray(schema.CustomField.systemAttribute, [
            'line_item_order',
            'customer_transaction_order',
          ]),
          inArray(schema.FieldValue.entityId, lineIds.slice(start, start + 1000))
        )
      )
    for (const parent of parents) if (parent.id) orders.add(parent.id)
  }
  let examined = 0
  if (orders.size) {
    const result = await reconcileOrderPaymentEvidence(db, {
      organizationId: request.organizationId,
      orderInstanceIds: [...orders],
    })
    examined += result.examined
  }
  if (payouts.length)
    examined += await reconcilePayoutRecords(db, { ...request, recordIds: payouts })
  return examined
}
