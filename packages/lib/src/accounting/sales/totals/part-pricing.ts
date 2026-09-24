// packages/lib/src/accounting/sales/totals/part-pricing.ts
//
// Markup pricing on the part itself (107 D5; semantics from plans/dispatch/money/17). Every
// write goes through hook-free `setValueWithType`: `pauseMarkupOnPriceEdit` treats any
// hooked `part_sell_price` write as a human edit, which only holds if these writes fire none.

import { database, schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId, type FieldValueKey } from '@auxx/types/field'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { getOrgCache, requireCachedEntityDefId } from '../../../cache'
import { refNamesField } from '../../../data-connectors/sync-state'
import type { EntityFieldChangeHandler } from '../../../field-hooks/types'
import { firstTyped } from '../../../field-values/client'
import { createFieldValueContext } from '../../../field-values/field-value-helpers'
import { setValueWithType } from '../../../field-values/field-value-mutations'
import { getRealtimeService, publishFieldValueUpdates } from '../../../realtime'

const logger = createScopedLogger('money:part-pricing')

/** `price = round(cost * (1 + markup/100))`, in the field's integer minor units. */
export function computeMarkupPrice(cost: number, markup: number): number {
  return Math.round(cost * (1 + markup / 100))
}

/**
 * Whether a price edit pauses auto-pricing: yes unless it equals the auto price exactly.
 * With no cost there is nothing to compare against, so any edit pauses.
 */
export function shouldPauseMarkup(
  newPrice: number | null,
  cost: number | null,
  markup: number
): boolean {
  if (cost == null) return true
  return newPrice !== computeMarkupPrice(cost, markup)
}

interface PricingField {
  id: string
  type: FieldType
}

interface PartPricingFields {
  cost: PricingField
  markup: PricingField
  price: PricingField
}

/** `null` when the org has not run the migration that creates the selling fields. */
async function resolvePartPricingFields(organizationId: string): Promise<PartPricingFields | null> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['part_cost', 'part_markup', 'part_sell_price'] as const)

  if (!cf.part_cost || !cf.part_markup || !cf.part_sell_price) return null

  // `CustomFieldEntity.type` is wider than `FieldType` by a legacy literal; narrow once here.
  return {
    cost: { id: cf.part_cost.id, type: cf.part_cost.type as FieldType },
    markup: { id: cf.part_markup.id, type: cf.part_markup.type as FieldType },
    price: { id: cf.part_sell_price.id, type: cf.part_sell_price.type as FieldType },
  }
}

/**
 * Parts whose sell price a live connector binding writes (and the field is not paused).
 * Markup and "follow the channel" exclude each other (107 D11), so these never auto-price.
 */
export async function listConnectorPricedPartIds(
  organizationId: string,
  partIds: readonly string[],
  priceFieldId: string
): Promise<Set<string>> {
  const ids = [...new Set(partIds.filter(Boolean))]
  if (ids.length === 0) return new Set()

  const rows = await database
    .select({
      entityInstanceId: schema.DataConnectorItem.entityInstanceId,
      managedFields: schema.DataConnectorItem.managedFields,
      pinnedFields: schema.DataConnectorItem.pinnedFields,
    })
    .from(schema.DataConnectorItem)
    .where(
      and(
        eq(schema.DataConnectorItem.organizationId, organizationId),
        inArray(schema.DataConnectorItem.entityInstanceId, ids),
        isNull(schema.DataConnectorItem.archivedAt)
      )
    )

  const priced = new Set<string>()
  for (const row of rows) {
    if (!row.entityInstanceId) continue
    const managed = (row.managedFields ?? []).some((ref) => refNamesField(ref, priceFieldId))
    const paused = (row.pinnedFields ?? []).includes(priceFieldId)
    if (managed && !paused) priced.add(row.entityInstanceId)
  }
  return priced
}

interface PartPriceValues {
  cost: number | null
  markup: number | null
  price: number | null
}

/** One query for cost, markup and price across `partIds`. */
async function readPartPriceValues(
  organizationId: string,
  partIds: readonly string[],
  fields: PartPricingFields
): Promise<Map<string, PartPriceValues>> {
  const rows = await database
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueNumber: schema.FieldValue.valueNumber,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.fieldId, [fields.cost.id, fields.markup.id, fields.price.id]),
        inArray(schema.FieldValue.entityId, [...partIds])
      )
    )

  const out = new Map<string, PartPriceValues>()
  for (const row of rows) {
    const entry = out.get(row.entityId) ?? { cost: null, markup: null, price: null }
    if (row.fieldId === fields.cost.id) entry.cost = row.valueNumber
    else if (row.fieldId === fields.markup.id) entry.markup = row.valueNumber
    else if (row.fieldId === fields.price.id) entry.price = row.valueNumber
    out.set(row.entityId, entry)
  }
  return out
}

interface PricingWrite {
  recordId: RecordId
  field: PricingField
  /** `null` clears the field. */
  value: number | null
}

const BATCH_SIZE = 20

/** The only writer in this module: hook-free, batched, published to open drawers. */
async function writePricingValues(organizationId: string, writes: PricingWrite[]): Promise<void> {
  if (writes.length === 0) return

  const ctx = createFieldValueContext(organizationId)
  const entries: Array<{ key: FieldValueKey; value: { type: 'number'; value: number } | null }> = []

  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = writes.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(async (write) => {
        await setValueWithType(ctx, {
          recordId: write.recordId,
          fieldId: write.field.id,
          fieldType: write.field.type,
          value: write.value == null ? null : { type: 'number', value: write.value },
        })
        return write
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const write = result.value
        entries.push({
          key: buildFieldValueKey(write.recordId, write.field.id as FieldId),
          value: write.value == null ? null : { type: 'number', value: write.value },
        })
      } else {
        logger.error('Failed to write part pricing field', {
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })
      }
    }
  }

  if (entries.length > 0) {
    await publishFieldValueUpdates(getRealtimeService(), organizationId, entries).catch(() => {})
  }
}

function numericValue(value: unknown): number | null {
  const typed = firstTyped(value)
  if (!typed || typed.type !== 'number') return null
  return typed.value
}

/**
 * Recompute `part_sell_price` for the parts whose `part_cost` just changed, where a markup is
 * set. A cleared cost leaves price and markup alone: taking an item off sale because a
 * supplier row was deleted would be worse than a stale price. Returns the number of writes.
 */
export async function syncPartPricing(
  organizationId: string,
  changedPartIds: string[]
): Promise<Result<number, Error>> {
  if (changedPartIds.length === 0) return ok(0)

  try {
    const fields = await resolvePartPricingFields(organizationId)
    if (!fields) return ok(0)

    const current = await readPartPriceValues(organizationId, changedPartIds, fields)
    const candidates = [...current.entries()].filter(
      ([, v]) =>
        v.markup != null && v.cost != null && v.price !== computeMarkupPrice(v.cost, v.markup)
    )
    if (candidates.length === 0) return ok(0)

    const connectorPriced = await listConnectorPricedPartIds(
      organizationId,
      candidates.map(([id]) => id),
      fields.price.id
    )
    const partDefId = await requireCachedEntityDefId(organizationId, 'part')

    const writes: PricingWrite[] = []
    for (const [partId, v] of candidates) {
      if (connectorPriced.has(partId) || v.markup == null || v.cost == null) continue
      writes.push({
        recordId: toRecordId(partDefId, partId) as RecordId,
        field: fields.price,
        value: computeMarkupPrice(v.cost, v.markup),
      })
    }

    await writePricingValues(organizationId, writes)
    logger.info('Recomputed part prices from cost change', {
      organizationId,
      changedParts: changedPartIds.length,
      writes: writes.length,
    })
    return ok(writes.length)
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

/** `part_markup` set: recompute the price from the current cost. Cleared is the pause itself. */
export const recomputePriceOnMarkupChange: EntityFieldChangeHandler = async (event) => {
  if (event.field.systemAttribute !== 'part_markup') return

  const markup = numericValue(event.newValue)
  if (markup == null) return

  const { organizationId, recordId } = event
  const fields = await resolvePartPricingFields(organizationId)
  if (!fields) return

  const { entityInstanceId } = parseRecordId(recordId)
  const values = (await readPartPriceValues(organizationId, [entityInstanceId], fields)).get(
    entityInstanceId
  )
  if (values?.cost == null) return

  const newPrice = computeMarkupPrice(values.cost, markup)
  if (values.price === newPrice) return

  const priced = await listConnectorPricedPartIds(
    organizationId,
    [entityInstanceId],
    fields.price.id
  )
  if (priced.has(entityInstanceId)) return

  await writePricingValues(organizationId, [{ recordId, field: fields.price, value: newPrice }])
}

/** `part_sell_price` edited to something other than the auto price: clear the markup (pause). */
export const pauseMarkupOnPriceEdit: EntityFieldChangeHandler = async (event) => {
  if (event.field.systemAttribute !== 'part_sell_price') return

  const { organizationId, recordId } = event
  const fields = await resolvePartPricingFields(organizationId)
  if (!fields) return

  const { entityInstanceId } = parseRecordId(recordId)
  const values = (await readPartPriceValues(organizationId, [entityInstanceId], fields)).get(
    entityInstanceId
  )
  if (values?.markup == null) return

  if (shouldPauseMarkup(numericValue(event.newValue), values.cost, values.markup)) {
    await writePricingValues(organizationId, [{ recordId, field: fields.markup, value: null }])
  }
}
