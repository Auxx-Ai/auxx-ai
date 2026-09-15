// packages/lib/src/postings/source-work.ts
import { type Database, schema } from '@auxx/database'
import { and, asc, eq } from 'drizzle-orm'

/** Show original and correction obligations, including incomplete undated shipments. */
export async function listOrderAccountingWork(
  db: Database,
  organizationId: string,
  orderId: string
) {
  return db
    .selectDistinct({
      id: schema.AccountingWork.id,
      fulfillmentId: schema.AccountingWork.entityInstanceId,
      operation: schema.AccountingWork.operation,
      state: schema.AccountingWork.state,
      eligibility: schema.AccountingWork.eligibility,
      reason: schema.AccountingWork.blockedReason,
      effectiveDate: schema.AccountingWorkBasis.effectiveDate,
    })
    .from(schema.AccountingWork)
    .innerJoin(
      schema.FieldValue,
      and(
        eq(schema.FieldValue.entityId, schema.AccountingWork.entityInstanceId),
        eq(schema.FieldValue.organizationId, organizationId)
      )
    )
    .innerJoin(
      schema.CustomField,
      and(
        eq(schema.CustomField.id, schema.FieldValue.fieldId),
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.systemAttribute, 'fulfillment_order')
      )
    )
    .innerJoin(
      schema.AccountingWorkBasis,
      and(
        eq(schema.AccountingWorkBasis.organizationId, organizationId),
        eq(schema.AccountingWorkBasis.workId, schema.AccountingWork.id),
        eq(schema.AccountingWorkBasis.version, schema.AccountingWork.basisVersion)
      )
    )
    .where(
      and(
        eq(schema.AccountingWork.organizationId, organizationId),
        eq(schema.FieldValue.relatedEntityId, orderId)
      )
    )
    .orderBy(asc(schema.AccountingWork.id))
}
