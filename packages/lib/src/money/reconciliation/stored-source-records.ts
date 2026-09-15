// packages/lib/src/money/reconciliation/stored-source-records.ts

import { schema, type Transaction } from '@auxx/database'
import { readEnvelope } from '@auxx/types/field-value'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { ConflictError } from '../../errors'
import { accountingBasisHash } from '../../postings/effect-basis'
import { stageOrderPaymentEvidenceInTx } from '../customer-money/record-evidence'
import type { PayoutRecordEvidence, ProcessorRecordEvidence } from '../payouts/record-contracts'
import {
  type FinancialRecordWrite,
  type FinancialWriteProvenance,
  writeFinancialRecords,
} from '../payouts/record-storage'
import { StaleFinancialSourceRevisionError } from '../payouts/source-write-errors'

export const FINANCIAL_SOURCE_TYPES = new Set([
  'payout',
  'processor_balance_entry',
  'customer_transaction',
])

/** Read normal stored record fields in a bounded set, using registered system attributes. */
export async function readStoredSourceFields(
  tx: Transaction,
  organizationId: string,
  ids: string[]
) {
  const result = new Map<string, Record<string, unknown>>()
  if (!ids.length) return result
  for (let start = 0; start < ids.length; start += 200) {
    const rows = await tx
      .select({ value: schema.FieldValue, attribute: schema.CustomField.systemAttribute })
      .from(schema.FieldValue)
      .innerJoin(
        schema.CustomField,
        and(
          eq(schema.CustomField.id, schema.FieldValue.fieldId),
          eq(schema.CustomField.organizationId, organizationId)
        )
      )
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          inArray(schema.FieldValue.entityId, ids.slice(start, start + 200))
        )
      )
    for (const { value, attribute } of rows) {
      if (!attribute) continue
      const fields = result.get(value.entityId) ?? {}
      fields[attribute] =
        value.relatedEntityId ??
        value.valueText ??
        (value.valueNumber == null ? null : Number(value.valueNumber)) ??
        value.valueBoolean ??
        value.optionId ??
        value.valueDate ??
        (value.valueJson ? readEnvelope(value.valueJson).v : null)
      const updatedAt = value.updatedAt instanceof Date ? value.updatedAt.getTime() : 0
      fields.__updatedAt = Math.max(Number(fields.__updatedAt ?? 0), updatedAt)
      result.set(value.entityId, fields)
    }
  }
  return result
}

/** Assess the shared source fields, independent of connector and provider payload shapes. */
export function storedFinancialFacts(
  type: 'payout' | 'processor_balance_entry',
  values: Record<string, unknown>,
  now: Date
) {
  const prefix = type === 'payout' ? 'payout_source_' : 'processor_balance_'
  const fields = Object.fromEntries(
    Object.entries(values)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key.slice(prefix.length), value])
  )
  if (!fields.external_id || !fields.provider_key || !fields.account_id || !fields.environment)
    return null
  const sourceAccount = {
    providerKey: fields.provider_key,
    externalAccountId: fields.account_id,
    environment: fields.environment,
  }
  const acquisition = {
    id: fields.acquisition_id ?? accountingBasisHash(fields),
    startedAt: fields.acquired_at ?? now.toISOString(),
  }
  const common = {
    version: 2 as const,
    externalId: fields.external_id,
    sourceAccount,
    acquisition,
    raw: fields.raw ?? null,
    rejectionReason: fields.rejection_reason ?? null,
  }
  if (type === 'payout') {
    if (fields.amount == null && !fields.rejection_reason) return null
    return {
      ...common,
      payout: fields.rejection_reason
        ? null
        : {
            id: fields.external_id,
            amount: fields.amount,
            currency: fields.currency,
            currencyExponent: fields.currency_exponent,
            status: fields.status,
            issuedAt: fields.issued_at ?? null,
            issuedOn: fields.issued_on ?? null,
            destinationExternalId: fields.destination_id ?? null,
            raw: fields.raw ?? null,
          },
      membership: fields.membership ?? {
        providerReady: false,
        complete: false,
        reason: 'Payout membership has not been supplied',
        page: null,
        entries: [],
        rejections: [],
        rawRows: [],
      },
    } as PayoutRecordEvidence
  }
  if (
    (fields.gross == null || fields.fee == null || fields.net == null) &&
    !fields.rejection_reason
  )
    return null
  return {
    ...common,
    page: fields.page ?? { id: acquisition.id, index: 0, rowIndex: 0 },
    entry: fields.rejection_reason
      ? null
      : {
          id: fields.external_id,
          type: fields.type,
          providerType: fields.provider_type ?? fields.type,
          gross: fields.gross,
          fee: fields.fee,
          net: fields.net,
          currency: fields.currency,
          currencyExponent: fields.currency_exponent,
          transactionDate: fields.transaction_date ?? null,
          payoutId: fields.payout_id ?? null,
          sourceTransactionId: fields.transaction_id ?? null,
          sourceOrderId: fields.order_id ?? null,
          sourceId: fields.source_id ?? null,
          sourceType: fields.source_type ?? null,
          sourceReference: fields.source_reference ?? null,
          raw: fields.raw ?? null,
        },
  } as ProcessorRecordEvidence
}

/** Capture financial observations after standard field writes in their existing transaction. */
export async function stageStoredFinancialRecordsInTx(
  tx: Transaction,
  input: {
    organizationId: string
    actorUserId: string
    records: Array<{ recordId: RecordId; entityType: string }>
    provenance: FinancialWriteProvenance
  }
) {
  const records = [...new Map(input.records.map((record) => [record.recordId, record])).values()]
  const stored = await readStoredSourceFields(
    tx,
    input.organizationId,
    records.map((record) => parseRecordId(record.recordId).entityInstanceId)
  )
  const now = new Date()
  const writes: FinancialRecordWrite[] = records.flatMap((record): FinancialRecordWrite[] => {
    if (record.entityType !== 'payout' && record.entityType !== 'processor_balance_entry') return []
    const { entityDefinitionId, entityInstanceId } = parseRecordId(record.recordId)
    const values = { ...(stored.get(entityInstanceId) ?? {}) }
    if (!['connector', 'import'].includes(input.provenance.source)) {
      const prefix = record.entityType === 'payout' ? 'payout_source_' : 'processor_balance_'
      delete values[`${prefix}acquisition_id`]
      delete values[`${prefix}acquired_at`]
    }
    const evidence = storedFinancialFacts(
      record.entityType,
      values,
      values.__updatedAt ? new Date(Number(values.__updatedAt)) : now
    )
    if (!evidence) return []
    return [
      {
        entityType: record.entityType,
        entityDefinitionId,
        recordId: entityInstanceId,
        evidence,
      },
    ]
  })
  const incompleteIds = records
    .filter(
      (record) => record.entityType === 'payout' || record.entityType === 'processor_balance_entry'
    )
    .map((record) => parseRecordId(record.recordId).entityInstanceId)
    .filter((id) => !writes.some((write) => write.recordId === id))
  if (incompleteIds.length) {
    const prior = await tx
      .select({ id: schema.FinancialSourceObservation.id })
      .from(schema.FinancialSourceObservation)
      .where(
        and(
          eq(schema.FinancialSourceObservation.organizationId, input.organizationId),
          inArray(
            sql<string>`${schema.FinancialSourceObservation.reportingInstallationSnapshot}->>'recordId'`,
            incompleteIds
          )
        )
      )
      .limit(1)
    if (prior.length)
      throw new ConflictError(
        'Required financial source facts cannot be cleared after an observation has been recorded'
      )
  }
  for (let start = 0; start < writes.length; start += 200) {
    const chunk = writes.slice(start, start + 200)
    const results = await writeFinancialRecords(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      records: chunk,
      provenance: input.provenance,
    })
    for (const [index, result] of results.entries()) {
      if (result.disposition === 'stale') {
        const observation = await tx.query.FinancialSourceObservation.findFirst({
          where: and(
            eq(schema.FinancialSourceObservation.id, result.observationId),
            eq(schema.FinancialSourceObservation.organizationId, input.organizationId)
          ),
        })
        if (!observation) throw new Error('Stale financial observation was not staged')
        throw new StaleFinancialSourceRevisionError(observation)
      }
      if (result.disposition === 'conflict') {
        throw new ConflictError('Financial source revision conflicts with the stored observation')
      }
      const previous = result.previousEvidence
      if (
        !result.changed &&
        previous &&
        accountingBasisHash(previous) !== accountingBasisHash(chunk[index]!.evidence)
      )
        throw new ConflictError(
          'Financial source revision is older than or conflicts with the stored observation'
        )
    }
  }
  const orderIds = new Set(
    records
      .filter((record) => record.entityType === 'order')
      .map((record) => parseRecordId(record.recordId).entityInstanceId)
  )
  for (const record of records) {
    if (record.entityType !== 'customer_transaction') continue
    const values = stored.get(parseRecordId(record.recordId).entityInstanceId)
    if (typeof values?.customer_transaction_order === 'string')
      orderIds.add(values.customer_transaction_order)
  }
  if (orderIds.size)
    await stageStoredOrderTransactionsInTx(tx, { ...input, orderIds: [...orderIds] })
}

/** Stage each order's normalized child records after the standard relationship writer links them. */
export async function stageStoredOrderTransactionsInTx(
  tx: Transaction,
  input: { organizationId: string; orderIds: string[]; provenance?: FinancialWriteProvenance }
) {
  for (let start = 0; start < input.orderIds.length; start += 100) {
    const orderIds = input.orderIds.slice(start, start + 100)
    const links = await tx
      .select({ id: schema.FieldValue.entityId, orderId: schema.FieldValue.relatedEntityId })
      .from(schema.FieldValue)
      .innerJoin(
        schema.CustomField,
        and(
          eq(schema.CustomField.id, schema.FieldValue.fieldId),
          eq(schema.CustomField.organizationId, input.organizationId)
        )
      )
      .where(
        and(
          eq(schema.FieldValue.organizationId, input.organizationId),
          eq(schema.CustomField.systemAttribute, 'customer_transaction_order'),
          inArray(schema.FieldValue.relatedEntityId, orderIds)
        )
      )
    const stored = await readStoredSourceFields(tx, input.organizationId, [
      ...orderIds,
      ...links.map((link) => link.id),
    ])
    for (const orderId of orderIds) {
      const order = stored.get(orderId) ?? {}
      const groups = new Map<
        string,
        {
          sourceAccount: { providerKey: string; externalAccountId: string; environment: string }
          orderExternalId: string
          sourceUpdatedAt: string | null
          transactions: unknown[]
        }
      >()
      for (const link of links.filter((link) => link.orderId === orderId)) {
        const row = stored.get(link.id) ?? {}
        const fields = Object.fromEntries(
          Object.entries(row)
            .filter(([key]) => key.startsWith('customer_transaction_'))
            .map(([key, value]) => [key.slice('customer_transaction_'.length), value])
        )
        if (
          !fields.provider_key ||
          !fields.account_id ||
          !fields.environment ||
          !fields.order_external_id ||
          !fields.external_id
        )
          continue
        const sourceAccount = {
          providerKey: String(fields.provider_key),
          externalAccountId: String(fields.account_id),
          environment: String(fields.environment),
        }
        const key = JSON.stringify(sourceAccount)
        const group = groups.get(key) ?? {
          sourceAccount,
          orderExternalId: String(fields.order_external_id),
          sourceUpdatedAt:
            fields.source_updated_at == null ? null : String(fields.source_updated_at),
          transactions: [],
        }
        group.transactions.push({
          version: 2,
          id: fields.external_id,
          kind: fields.kind,
          status: fields.status,
          amount: fields.amount,
          currency: fields.currency,
          processedAt: fields.processed_at ?? null,
          gateway: fields.gateway ?? null,
          settlementCurrency: fields.settlement_currency ?? null,
          parentTransactionId: fields.parent_transaction_id ?? null,
          creditMemoExternalId: fields.credit_memo_id ?? null,
          paymentId: fields.payment_id ?? null,
          test: fields.test === true,
          raw: fields.raw ?? null,
        })
        groups.set(key, group)
      }
      if (
        !groups.size &&
        order.order_payment_source_provider &&
        order.order_payment_source_account &&
        order.order_payment_source_order_id
      ) {
        const sourceAccount = {
          providerKey: String(order.order_payment_source_provider),
          externalAccountId: String(order.order_payment_source_account),
          environment: String(order.order_payment_source_environment),
        }
        groups.set(JSON.stringify(sourceAccount), {
          sourceAccount,
          orderExternalId: String(order.order_payment_source_order_id),
          sourceUpdatedAt:
            order.order_payment_source_updated_at == null
              ? null
              : String(order.order_payment_source_updated_at),
          transactions: [],
        })
      }
      for (const group of groups.values()) {
        const complete =
          order.order_payment_source_complete === true &&
          Number(order.order_payment_source_count) === group.transactions.length
        await stageOrderPaymentEvidenceInTx(tx, {
          organizationId: input.organizationId,
          orderInstanceId: orderId,
          provenance: input.provenance,
          evidence: { version: 2, ...group, complete },
        })
      }
    }
  }
}
