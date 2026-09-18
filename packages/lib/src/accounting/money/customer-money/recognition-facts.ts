// packages/lib/src/accounting/money/customer-money/recognition-facts.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { UnprocessableEntityError } from '../../../errors'
import { systemFieldMap } from '../../../resources/system-records'

const attributes = [
  'order_subtotal',
  'order_tax_total',
  'order_shipping_total',
  'order_total',
  'order_channel',
  'order_currency',
  'order_contact',
  'line_item_order',
  'line_item_net_total',
  'tax_line_order',
  'tax_line_title',
  'tax_line_price',
  'tax_line_channel_liable',
] as const

/** Exact order values and merchant tax evidence required by both recognition doors. */
export async function readOrderRecognitionFactsInTx(
  tx: Database | Transaction,
  organizationId: string,
  orderId: string
) {
  const fields = await systemFieldMap(tx, organizationId, attributes)
  for (const attribute of attributes)
    if (attribute !== 'order_channel' && !fields[attribute])
      throw new UnprocessableEntityError(`Missing accounting field: ${attribute}`)
  const order = await tx
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.EntityDefinition,
      and(
        eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId),
        eq(schema.EntityDefinition.organizationId, organizationId),
        eq(schema.EntityDefinition.entityType, 'order'),
        isNull(schema.EntityDefinition.archivedAt)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.id, orderId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  if (order.length !== 1) throw new UnprocessableEntityError('Receipt order is missing or archived')
  const edges = await tx
    .select({ id: schema.FieldValue.entityId, fieldId: schema.FieldValue.fieldId })
    .from(schema.FieldValue)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.id, schema.FieldValue.entityId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.relatedEntityId, orderId),
        inArray(schema.FieldValue.fieldId, [fields.line_item_order!.id, fields.tax_line_order!.id])
      )
    )
  const rows = await tx.query.FieldValue.findMany({
    where: and(
      eq(schema.FieldValue.organizationId, organizationId),
      inArray(schema.FieldValue.entityId, [orderId, ...edges.map((e) => e.id)]),
      inArray(
        schema.FieldValue.fieldId,
        attributes.flatMap((a) => (fields[a] ? [fields[a]!.id] : []))
      )
    ),
  })
  const cell = (entityId: string, attribute: (typeof attributes)[number]) => {
    const matches = rows.filter(
      (r) => r.entityId === entityId && r.fieldId === fields[attribute]?.id
    )
    if (matches.length > 1) throw new UnprocessableEntityError(`Ambiguous ${attribute} evidence`)
    return matches[0]
  }
  const amount = (entityId: string, attribute: (typeof attributes)[number]) => {
    const raw = cell(entityId, attribute)?.valueNumber
    if (raw == null || !/^(0|[1-9]\d*)(\.0+)?$/.test(String(raw)))
      throw new UnprocessableEntityError(`Missing exact minor-unit evidence: ${attribute}`)
    const value = BigInt(String(raw).split('.')[0]!)
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new UnprocessableEntityError(`${attribute} exceeds the ledger amount limit`)
    return value
  }
  const subtotal = amount(orderId, 'order_subtotal')
  const tax = amount(orderId, 'order_tax_total')
  const shipping = amount(orderId, 'order_shipping_total')
  const total = amount(orderId, 'order_total')
  if (subtotal + tax + shipping !== total)
    throw new UnprocessableEntityError('Order subtotal, shipping and tax do not equal its total')
  if (cell(orderId, 'order_currency')?.valueText !== 'USD')
    throw new UnprocessableEntityError('Order requires explicit USD currency evidence')
  const lineIds = edges.filter((e) => e.fieldId === fields.line_item_order!.id).map((e) => e.id)
  if (
    !lineIds.length ||
    lineIds.reduce((sum, id) => sum + amount(id, 'line_item_net_total'), 0n) !== subtotal
  )
    throw new UnprocessableEntityError('Order lines need exact net totals matching the subtotal')
  const taxComponents = edges
    .filter((e) => e.fieldId === fields.tax_line_order!.id)
    .map((e) => {
      const value = amount(e.id, 'tax_line_price')
      const title = cell(e.id, 'tax_line_title')?.valueText
      if (value > 0n && (!title || cell(e.id, 'tax_line_channel_liable')?.valueBoolean !== false))
        throw new UnprocessableEntityError(
          'Tax jurisdiction or merchant remittance evidence is unresolved'
        )
      return {
        componentKey: e.id,
        amountMinor: value.toString(),
        jurisdiction: title ?? null,
        collector: 'merchant' as const,
        remitter: 'merchant' as const,
        withholdingEvidenceId: null,
      }
    })
    .sort((a, b) => a.componentKey.localeCompare(b.componentKey))
  if (taxComponents.reduce((sum, c) => sum + BigInt(c.amountMinor), 0n) !== tax)
    throw new UnprocessableEntityError('Tax components do not equal the order tax total')
  const customerInstanceId = cell(orderId, 'order_contact')?.relatedEntityId
  if (!customerInstanceId) throw new UnprocessableEntityError('Order customer is unresolved')
  const customer = await tx.query.EntityInstance.findFirst({
    where: and(
      eq(schema.EntityInstance.organizationId, organizationId),
      eq(schema.EntityInstance.id, customerInstanceId),
      isNull(schema.EntityInstance.archivedAt)
    ),
  })
  if (!customer) throw new UnprocessableEntityError('Order customer is missing or archived')
  return {
    orderId,
    customerInstanceId,
    channel:
      cell(orderId, 'order_channel')?.optionId ?? cell(orderId, 'order_channel')?.valueText ?? null,
    subtotal,
    tax,
    shipping,
    total,
    taxComponents,
  }
}
