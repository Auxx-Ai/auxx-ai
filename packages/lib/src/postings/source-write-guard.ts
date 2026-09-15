// packages/lib/src/postings/source-write-guard.ts
import { AsyncLocalStorage } from 'node:async_hooks'
import { type Database, schema, type Transaction } from '@auxx/database'
import { readEnvelope } from '@auxx/types/field-value'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { PgTransaction } from 'drizzle-orm/pg-core'
import { ConflictError } from '../errors'
import type { FieldValueContext } from '../field-values/field-value-helpers'
import { runInTxWrite } from '../resources/crud/tx-write-scope'
import { getAmbientWriteSession, runWithWriteDb } from '../resources/crud/write-session-als'
import { withAccountingCommitLock } from './accounting-commit-lock'

const guardedWrites = new AsyncLocalStorage<Set<string>>()
const financialFields = new Set([
  'fulfillment_order',
  'fulfillment_sequence',
  'fulfillment_shipped_at',
  'fulfillment_subtotal',
  'fulfillment_total',
  'fulfillment_shipping_recognised',
  'fulfillment_status',
  'fulfillment_cancelled_at',
  'fulfillment_lines',
  'fulfillment_line_fulfillment',
  'fulfillment_line_line_item',
  'fulfillment_line_quantity',
  'order_contact',
  'order_company',
  'order_paid_at',
  'order_financial_status',
  'order_channel',
  'order_payment_gateways',
  'order_paid_gateway',
  'order_currency',
  'order_subtotal',
  'order_discount_type',
  'order_discount_value',
  'order_tax_name',
  'order_tax_rate',
  'order_tax_total',
  'order_shipping_total',
  'order_total',
  'order_line_items',
  'order_tax_lines',
  'line_item_qty',
  'line_item_unit_price',
  'line_item_line_total',
  'line_item_net_total',
  'line_item_taxable',
  'line_item_tax_total',
  'line_item_optional',
  'line_item_optional_selected',
  'line_item_discount',
  'line_item_order',
  'line_item_catalog_item',
  'line_item_part',
  'tax_line_title',
  'tax_line_rate',
  'tax_line_price',
  'tax_line_channel_liable',
  'tax_line_order',
])
const guardedTypes = new Set([
  'payout',
  'processor_balance_entry',
  'customer_transaction',
  'fulfillment',
  'fulfillment_line',
  'order',
  'line_item',
  'tax_line',
  'gl_account',
  'payment_gateway',
  'contact',
])
const configurationTypes = new Set(['gl_account', 'payment_gateway', 'contact'])

/** A financial source edit is refused until an explicit correction is accepted. */
export class AcceptedAccountingSourceError extends ConflictError {
  constructor(readonly fulfillmentIds: string[]) {
    super(
      'This change affects accepted fulfillment accounting. Record an accounting correction first.'
    )
  }
}

/** Resolve canonical resource definitions without cached commit-time authority. */
export async function accountingSourceType(
  db: Database | Transaction,
  organizationId: string,
  definition: string
) {
  const row = await db.query.EntityDefinition.findFirst({
    where: and(
      eq(schema.EntityDefinition.organizationId, organizationId),
      or(
        eq(schema.EntityDefinition.id, definition),
        eq(schema.EntityDefinition.entityType, definition)
      )
    ),
    columns: { entityType: true },
  })
  return row?.entityType && guardedTypes.has(row.entityType) ? row.entityType : null
}

/** Find all fulfillment obligations whose source inputs include these records. */
export async function affectedFulfillmentsInTx(
  tx: Transaction,
  organizationId: string,
  recordId: RecordId,
  relatedIds: string[] = []
) {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  const type = await accountingSourceType(tx, organizationId, entityDefinitionId)
  if (!type || (configurationTypes.has(type) && type !== 'contact')) return []
  if (type === 'fulfillment') return [entityInstanceId]
  if (type === 'payout' || type === 'processor_balance_entry' || type === 'customer_transaction')
    return []
  const edges = async (ids: string[], attributes: string[], inverse = false): Promise<string[]> => {
    if (!ids.length) return []
    const rows = await tx
      .select({ id: inverse ? schema.FieldValue.entityId : schema.FieldValue.relatedEntityId })
      .from(schema.FieldValue)
      .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.CustomField.organizationId, organizationId),
          inArray(schema.CustomField.systemAttribute, attributes),
          inArray(inverse ? schema.FieldValue.relatedEntityId : schema.FieldValue.entityId, ids)
        )
      )
    return rows.flatMap((row) => (row.id ? [row.id] : []))
  }
  if (type === 'fulfillment_line') {
    const ids = [
      ...(await edges([entityInstanceId], ['fulfillment_line_fulfillment'])),
      ...relatedIds,
    ]
    if (!ids.length) return []
    const rows = await tx
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .innerJoin(
        schema.EntityDefinition,
        eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
      )
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          inArray(schema.EntityInstance.id, ids),
          eq(schema.EntityDefinition.entityType, 'fulfillment')
        )
      )
    return rows.map((row) => row.id)
  }
  const orders =
    type === 'contact'
      ? await edges([entityInstanceId], ['order_contact'], true)
      : type === 'order'
        ? [entityInstanceId]
        : [
            ...(await edges(
              [entityInstanceId],
              [type === 'tax_line' ? 'tax_line_order' : 'line_item_order']
            )),
            ...relatedIds,
          ]
  return [...new Set(await edges(orders, ['fulfillment_order'], true))]
}

/** Refuse destructive source changes while retaining accepted membership. Caller holds the lock. */
export async function assertAccountingSourcesMutableInTx(
  tx: Transaction,
  organizationId: string,
  recordIds: RecordId[],
  relatedIds: string[] = []
) {
  await assertReceiptSourcesMutableInTx(tx, organizationId, recordIds, relatedIds)
  const fulfillmentIds = new Set<string>()
  for (const recordId of recordIds)
    for (const id of await affectedFulfillmentsInTx(tx, organizationId, recordId, relatedIds))
      fulfillmentIds.add(id)
  if (!fulfillmentIds.size) return
  const accepted = await tx
    .select({ id: schema.AccountingWork.entityInstanceId })
    .from(schema.AccountingWork)
    .innerJoin(
      schema.AccountingEffect,
      and(
        eq(schema.AccountingEffect.workId, schema.AccountingWork.id),
        eq(schema.AccountingEffect.organizationId, organizationId)
      )
    )
    .where(
      and(
        eq(schema.AccountingWork.organizationId, organizationId),
        inArray(schema.AccountingWork.entityInstanceId, [...fulfillmentIds])
      )
    )
  if (accepted.length)
    throw new AcceptedAccountingSourceError([
      ...new Set(accepted.flatMap((row) => (row.id ? [row.id] : []))),
    ])
}

/** Receipt acceptance freezes its order basis even before the first shipment exists. */
async function assertReceiptSourcesMutableInTx(
  tx: Transaction,
  organizationId: string,
  recordIds: RecordId[],
  relatedIds: string[]
) {
  const orderIds = new Set<string>()
  for (const recordId of recordIds) {
    const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
    const type = await accountingSourceType(tx, organizationId, entityDefinitionId)
    if (type === 'order') orderIds.add(entityInstanceId)
    if (!type || !['line_item', 'tax_line', 'contact'].includes(type)) continue
    const contact = type === 'contact'
    const edges = await tx
      .select({ id: contact ? schema.FieldValue.entityId : schema.FieldValue.relatedEntityId })
      .from(schema.FieldValue)
      .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.CustomField.organizationId, organizationId),
          eq(
            schema.CustomField.systemAttribute,
            contact ? 'order_contact' : type === 'line_item' ? 'line_item_order' : 'tax_line_order'
          ),
          eq(
            contact ? schema.FieldValue.relatedEntityId : schema.FieldValue.entityId,
            entityInstanceId
          )
        )
      )
    for (const row of edges) if (row.id) orderIds.add(row.id)
    if (!contact) for (const id of relatedIds) orderIds.add(id)
  }
  if (!orderIds.size) return
  const [accepted] = await tx
    .select({ id: schema.AccountingEffect.id })
    .from(schema.AccountingEffect)
    .innerJoin(
      schema.AccountingWork,
      and(
        eq(schema.AccountingWork.organizationId, organizationId),
        eq(schema.AccountingWork.id, schema.AccountingEffect.workId)
      )
    )
    .where(
      and(
        eq(schema.AccountingEffect.organizationId, organizationId),
        eq(schema.AccountingWork.effectKind, 'customer_receipt'),
        inArray(
          sql<string>`${schema.AccountingEffect.acceptedBasis}->'calculation'->>'orderInstanceId'`,
          [...orderIds]
        )
      )
    )
    .limit(1)
  if (accepted)
    throw new ConflictError(
      'This change affects accepted payment accounting. Record an accounting correction first.'
    )
}

function rawValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(rawValue)
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>
    if (v.type === 'relationship' && typeof v.recordId === 'string')
      return parseRecordId(v.recordId as RecordId).entityInstanceId
    if ('value' in v && typeof v.type === 'string') return rawValue(v.value)
    if (v.type === 'option') return v.optionId
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value)) {
    const date = new Date(value)
    if (Number.isFinite(date.getTime())) return date.toISOString()
  }
  if (typeof value === 'string' && value.includes(':') && !value.includes('T')) {
    const [definition, id, extra] = value.split(':')
    if (definition && id && !extra) return id
  }
  return value
}

export interface AccountingFieldMutation {
  recordId: RecordId
  fields: Array<{ fieldId: string; value?: unknown }>
  operation: 'set' | 'change'
}

/** Guard complete financial field writes, capture their new basis, and flush only after commit. */
export async function withAccountingFieldMutation<T>(
  ctx: FieldValueContext,
  input: AccountingFieldMutation[],
  fn: (ctx: FieldValueContext) => Promise<T>
): Promise<T> {
  const active = guardedWrites.getStore()
  const remaining = input
    .map((item) => ({
      ...item,
      fields: item.fields.filter((field) => !active?.has(`${item.recordId}:${field.fieldId}`)),
    }))
    .filter((item) => item.fields.length)
  if (!remaining.length) return fn(ctx)
  const relevant: AccountingFieldMutation[] = []
  const sourceRecords = new Map<RecordId, string>()
  const sourceFieldIds = new Set<string>()
  for (const item of remaining) {
    const type = await accountingSourceType(
      ctx.db,
      ctx.organizationId,
      parseRecordId(item.recordId).entityDefinitionId
    )
    if (!type) continue
    const names = item.fields.map((field) => field.fieldId)
    if (!names.length) continue
    const fields = await ctx.db.query.CustomField.findMany({
      where: and(
        eq(schema.CustomField.organizationId, ctx.organizationId),
        or(
          inArray(schema.CustomField.id, names),
          inArray(schema.CustomField.systemAttribute, names)
        )
      ),
      columns: { id: true, systemAttribute: true },
    })
    const financial = item.fields.filter((field) => {
      const attr =
        fields.find((row) => row.id === field.fieldId || row.systemAttribute === field.fieldId)
          ?.systemAttribute ?? field.fieldId
      return (
        configurationTypes.has(type) ||
        financialFields.has(attr) ||
        attr.startsWith('payout_source_') ||
        attr.startsWith('processor_balance_') ||
        attr.startsWith('customer_transaction_') ||
        attr.startsWith('order_payment_source_')
      )
    })
    const resolved = financial
      .map((field) => ({
        ...field,
        fieldId:
          fields.find((row) => row.id === field.fieldId || row.systemAttribute === field.fieldId)
            ?.id ?? field.fieldId,
      }))
      .filter((field) => !active?.has(`${item.recordId}:${field.fieldId}`))
    const sourceFields = resolved.filter((field) => {
      const attr = fields.find((row) => row.id === field.fieldId)?.systemAttribute ?? field.fieldId
      return (
        attr.startsWith('payout_source_') ||
        attr.startsWith('processor_balance_') ||
        attr.startsWith('customer_transaction_') ||
        attr.startsWith('order_payment_source_')
      )
    })
    if (sourceFields.length) {
      sourceRecords.set(item.recordId, type)
      for (const field of sourceFields) sourceFieldIds.add(`${item.recordId}:${field.fieldId}`)
    }
    if (resolved.length) relevant.push({ ...item, fields: resolved })
  }
  if (!relevant.length) return fn(ctx)
  const execute = async (tx: Transaction) => {
    await withAccountingCommitLock(tx, ctx.organizationId)
    const before = new Set<string>()
    for (const item of relevant) {
      const economicFields = item.fields.filter(
        (field) => !sourceFieldIds.has(`${item.recordId}:${field.fieldId}`)
      )
      if (!economicFields.length) continue
      let changed = item.operation !== 'set'
      const related: string[] = []
      for (const field of economicFields) {
        const requested = rawValue(field.value)
        for (const value of Array.isArray(requested) ? requested : [requested])
          if (typeof value === 'string') related.push(value)
        if (changed) continue
        const rows = await tx.query.FieldValue.findMany({
          where: and(
            eq(schema.FieldValue.organizationId, ctx.organizationId),
            eq(schema.FieldValue.entityId, parseRecordId(item.recordId).entityInstanceId),
            eq(schema.FieldValue.fieldId, field.fieldId)
          ),
        })
        const actual = rows.map((row) =>
          rawValue(
            row.relatedEntityId ??
              row.valueNumber ??
              row.valueText ??
              row.optionId ??
              row.valueBoolean ??
              row.valueDate ??
              (row.valueJson ? readEnvelope(row.valueJson).v : null)
          )
        )
        const expected = Array.isArray(requested) ? requested : requested == null ? [] : [requested]
        if (JSON.stringify(actual) !== JSON.stringify(expected)) changed = true
      }
      const itemType = await accountingSourceType(
        tx,
        ctx.organizationId,
        parseRecordId(item.recordId).entityDefinitionId
      )
      if (changed && (!itemType || !configurationTypes.has(itemType)))
        await assertAccountingSourcesMutableInTx(tx, ctx.organizationId, [item.recordId], related)
      for (const id of await affectedFulfillmentsInTx(
        tx,
        ctx.organizationId,
        item.recordId,
        related
      ))
        before.add(id)
    }
    return guardedWrites.run(
      new Set([
        ...(active ?? []),
        ...relevant.flatMap((item) =>
          item.fields.map((field) => `${item.recordId}:${field.fieldId}`)
        ),
      ]),
      () =>
        runWithWriteDb(tx, async () => {
          const result = await fn({ ...ctx, db: tx })
          if (sourceRecords.size) {
            const { stageStoredFinancialRecordsInTx } = await import(
              '../money/reconciliation/stored-source-records'
            )
            const { resolveFinancialWriteProvenance } = await import(
              '../resources/crud/financial-record-binding'
            )
            const provenance = await resolveFinancialWriteProvenance({
              db: tx,
              organizationId: ctx.organizationId,
              session: ctx.session ??
                getAmbientWriteSession() ?? {
                  origin: { kind: 'automation', actor: ctx.userId ?? 'system' },
                  depth: 0,
                },
            })
            await stageStoredFinancialRecordsInTx(tx, {
              organizationId: ctx.organizationId,
              actorUserId: ctx.userId ?? '',
              records: [...sourceRecords].map(([recordId, entityType]) => ({
                recordId,
                entityType,
              })),
              provenance,
            })
          }
          const { captureFulfillmentAccountingWorkInTx } = await import(
            '../money/fulfillment-posting/work'
          )
          const discovered = new Set<string>()
          for (const item of relevant.filter((item) =>
            item.fields.some((field) => !sourceFieldIds.has(`${item.recordId}:${field.fieldId}`))
          ))
            for (const id of await affectedFulfillmentsInTx(tx, ctx.organizationId, item.recordId))
              if (!before.has(id)) discovered.add(id)
          if (discovered.size)
            await assertAccountingSourcesMutableInTx(
              tx,
              ctx.organizationId,
              [...discovered].map((id) => toRecordId('fulfillment', id))
            )
          for (const id of discovered) before.add(id)
          for (const id of before)
            await captureFulfillmentAccountingWorkInTx(tx, {
              organizationId: ctx.organizationId,
              fulfillmentInstanceId: id,
            })
          return result
        })
    )
  }
  if (ctx.db instanceof PgTransaction) return execute(ctx.db)
  const completed = await ctx.db.transaction((tx) =>
    runInTxWrite({ organizationId: ctx.organizationId, actorUserId: ctx.userId ?? '' }, () =>
      execute(tx)
    )
  )
  if (completed.owned) {
    const { flushTxWriteScope } = await import('../resources/crud/tx-write-flush')
    await flushTxWriteScope(completed.scope)
  }
  return completed.result
}

/** Preserve refused connector evidence separately from the rejected source mutation. */
export async function recordRejectedAccountingObservation(
  db: Database | Transaction,
  organizationId: string,
  error: AcceptedAccountingSourceError,
  observation: Record<string, unknown>
) {
  const { recordFulfillmentCorrectionObservationInTx } = await import(
    '../money/fulfillment-posting/work'
  )
  await db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, organizationId)
    for (const fulfillmentInstanceId of error.fulfillmentIds) {
      await recordFulfillmentCorrectionObservationInTx(tx, {
        organizationId,
        fulfillmentInstanceId,
        observation: JSON.parse(JSON.stringify(observation)),
      })
    }
  })
}
