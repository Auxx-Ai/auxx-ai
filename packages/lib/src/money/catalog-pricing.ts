// packages/lib/src/money/catalog-pricing.ts
//
// Part cost sync + markup pricing engine for catalog items (plan 17). A part-linked
// catalog item always mirrors its part's `part_cost` into `catalog_item_cost`; when a
// markup percentage is set it also drives `catalog_item_default_unit_price` — but the
// price stays hand-editable, and editing it clears the markup (the pause switch). All
// writes here go through hook-free `setValueWithType`, exactly like `persistCosts` in
// `bom/cost-calculator.ts` (see plan 17 §2's "why not a record rule" finding): the
// price-edit-clears-markup hook below (§3) treats ANY normal-path
// `catalog_item_default_unit_price` write as a genuine user edit, which only holds if
// the sync engine's own writes never fire hooks.

import { database, schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import type { TypedFieldValue } from '@auxx/types'
import { buildFieldValueKey, type FieldId, type FieldValueKey } from '@auxx/types/field'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache, requireCachedEntityDefId } from '../cache'
import type { EntityFieldChangeHandler } from '../field-hooks/types'
import { createFieldValueContext } from '../field-values/field-value-helpers'
import { setValueWithType } from '../field-values/field-value-mutations'
import { getRealtimeService, publishFieldValueUpdates } from '../realtime'

const logger = createScopedLogger('money:catalog-pricing')

// ─── Pure math ───────────────────────────────────────────────────────

/**
 * Auto-price formula (plan 17 decision 2): `price = round(cost * (1 + markup/100))`,
 * in whole integer cents (the platform CURRENCY storage convention).
 */
export function computeMarkupPrice(cost: number, markup: number): number {
  return Math.round(cost * (1 + markup / 100))
}

/**
 * Guard for the price-edit-clears-markup hook (plan 17 §3, row 3): a user edit to
 * `defaultUnitPrice` pauses auto-pricing UNLESS the new value is exactly what the
 * formula would have produced anyway (a no-op retype of the auto price). No cost basis
 * (`cost == null`) means there's nothing to compare against, so any edit pauses.
 */
export function shouldPauseMarkup(
  newPrice: number | null,
  cost: number | null,
  markup: number
): boolean {
  if (cost == null) return true
  return newPrice !== computeMarkupPrice(cost, markup)
}

// ─── Shared field resolution + hook-free writer ─────────────────────

interface CatalogPricingFields {
  part: { id: string; type: FieldType }
  cost: { id: string; type: FieldType }
  markup: { id: string; type: FieldType } | null
  price: { id: string; type: FieldType } | null
}

/**
 * Resolve the four catalog-item pricing fields via the org cache. Returns `null`
 * (after logging) when the org hasn't run migration 044 yet — `part`/`cost` are the
 * load-bearing pair; `markup`/`price` are optional so the sync still runs cost-only.
 */
async function resolveCatalogPricingFields(
  organizationId: string
): Promise<CatalogPricingFields | null> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'catalog_item_part',
      'catalog_item_cost',
      'catalog_item_markup',
      'catalog_item_default_unit_price',
    ] as const)

  if (!cf.catalog_item_part || !cf.catalog_item_cost) {
    logger.warn('catalog_item pricing fields not found — org not migrated (044)', {
      organizationId,
    })
    return null
  }

  // Cast at the one resolution point — `CustomFieldEntity.type` is drizzle-inferred from
  // the DB enum (currently wider than `FieldType` by a legacy `PHONE` literal), so every
  // downstream `setValueWithType` call needs the narrower published type.
  return {
    part: { id: cf.catalog_item_part.id, type: cf.catalog_item_part.type as FieldType },
    cost: { id: cf.catalog_item_cost.id, type: cf.catalog_item_cost.type as FieldType },
    markup: cf.catalog_item_markup
      ? { id: cf.catalog_item_markup.id, type: cf.catalog_item_markup.type as FieldType }
      : null,
    price: cf.catalog_item_default_unit_price
      ? {
          id: cf.catalog_item_default_unit_price.id,
          type: cf.catalog_item_default_unit_price.type as FieldType,
        }
      : null,
  }
}

interface CatalogFieldWrite {
  recordId: RecordId
  fieldId: string
  fieldType: FieldType
  /** `null` clears the field (e.g. cost on an unlinked item). */
  value: number | null
}

const BATCH_SIZE = 20

/**
 * THE hook-free writer for every catalog pricing write in this module — the sync
 * engine's batch pass and all three interactive hooks funnel through this. Writes via
 * `setValueWithType` (no field-change hooks, no recursion by construction) and
 * publishes realtime `fieldValues:updated` entries so an open settings editor updates
 * live, mirroring `persistCosts` (`bom/cost-calculator.ts`) batching + publish pattern.
 */
async function writeCatalogNumberValues(
  organizationId: string,
  writes: CatalogFieldWrite[]
): Promise<void> {
  if (writes.length === 0) return

  const ctx = createFieldValueContext(organizationId)
  const entries: Array<{ key: FieldValueKey; value: { type: 'number'; value: number } | null }> = []

  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = writes.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(async (write) => {
        await setValueWithType(ctx, {
          recordId: write.recordId,
          fieldId: write.fieldId,
          fieldType: write.fieldType,
          value: write.value == null ? null : { type: 'number', value: write.value },
        })
        return write
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const write = result.value
        entries.push({
          key: buildFieldValueKey(write.recordId, write.fieldId as FieldId),
          value: write.value == null ? null : { type: 'number', value: write.value },
        })
      } else {
        logger.error('Failed to write catalog pricing field', {
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })
      }
    }
  }

  if (entries.length > 0) {
    await publishFieldValueUpdates(getRealtimeService(), organizationId, entries).catch(() => {})
  }
}

/** Read a single numeric FieldValue by raw entity instance id (no def-typed RecordId needed). */
async function readNumberByEntityInstance(
  organizationId: string,
  entityInstanceId: string,
  fieldId: string
): Promise<number | null> {
  const rows = await database
    .select({ valueNumber: schema.FieldValue.valueNumber })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, entityInstanceId),
        eq(schema.FieldValue.fieldId, fieldId),
        eq(schema.FieldValue.organizationId, organizationId)
      )
    )
  return rows[0]?.valueNumber ?? null
}

/** Read a single numeric FieldValue for a catalog item's own record. */
async function readCurrentNumber(
  organizationId: string,
  recordId: RecordId,
  fieldId: string
): Promise<number | null> {
  const { entityInstanceId } = parseRecordId(recordId)
  return readNumberByEntityInstance(organizationId, entityInstanceId, fieldId)
}

// ─── Event value extraction (door 1 hooks) ──────────────────────────

/** `EntityFieldChangeEvent.oldValue`/`newValue` is array-wrapped for RELATIONSHIP fields. */
function firstTyped(value: unknown): TypedFieldValue | undefined {
  if (value == null) return undefined
  return Array.isArray(value)
    ? (value[0] as TypedFieldValue | undefined)
    : (value as TypedFieldValue)
}

function relationshipEntityInstanceId(value: unknown): string | null {
  const typed = firstTyped(value)
  if (!typed || typed.type !== 'relationship') return null
  return parseRecordId(typed.recordId).entityInstanceId
}

function numericValue(value: unknown): number | null {
  const typed = firstTyped(value)
  if (!typed || typed.type !== 'number') return null
  return typed.value
}

// ─── Sync engine (plan 17 §2) ────────────────────────────────────────

/**
 * Ripple changed part costs into every catalog item backed by those parts (plan 17
 * §2). Called from the end of both `recalculateAllPartCosts` and
 * `recalculateAffectedParts` (`bom/cost-calculator.ts`) with their `changedPartIds`.
 *
 * One cheap query for the common case (no catalog items linked to any changed part),
 * then a batch cost sync + conditional markup-driven price recompute, hook-free.
 */
export async function syncCatalogItemPricing(
  organizationId: string,
  changedPartIds: string[]
): Promise<void> {
  if (changedPartIds.length === 0) return

  const fields = await resolveCatalogPricingFields(organizationId)
  if (!fields) return

  // ── Step 2: ONE query — catalog items currently linked to a changed part ──
  const linkRows = await database
    .select({
      catalogInstanceId: schema.FieldValue.entityId,
      partInstanceId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.fieldId, fields.part.id),
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.relatedEntityId, changedPartIds)
      )
    )

  if (linkRows.length === 0) return

  // ── Step 3a: current part_cost for every referenced part ──
  const partIds = [
    ...new Set(linkRows.map((row) => row.partInstanceId).filter((id): id is string => id != null)),
  ]

  const partCostField = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttribute('part_cost')

  const partCosts = new Map<string, number>()
  if (partCostField && partIds.length > 0) {
    const rows = await database
      .select({ entityId: schema.FieldValue.entityId, valueNumber: schema.FieldValue.valueNumber })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.fieldId, partCostField.id),
          eq(schema.FieldValue.organizationId, organizationId),
          inArray(schema.FieldValue.entityId, partIds)
        )
      )
    for (const row of rows) {
      if (row.valueNumber != null) partCosts.set(row.entityId, row.valueNumber)
    }
  }

  // ── Step 3b: each affected item's current cost/markup/price ──
  const catalogIds = linkRows.map((row) => row.catalogInstanceId)
  const currentFieldIds = [fields.cost.id, fields.markup?.id, fields.price?.id].filter(
    (id): id is string => id != null
  )

  const current = new Map<
    string,
    { cost: number | null; markup: number | null; price: number | null }
  >()
  if (currentFieldIds.length > 0) {
    const rows = await database
      .select({
        entityId: schema.FieldValue.entityId,
        fieldId: schema.FieldValue.fieldId,
        valueNumber: schema.FieldValue.valueNumber,
      })
      .from(schema.FieldValue)
      .where(
        and(
          inArray(schema.FieldValue.fieldId, currentFieldIds),
          eq(schema.FieldValue.organizationId, organizationId),
          inArray(schema.FieldValue.entityId, catalogIds)
        )
      )
    for (const row of rows) {
      const entry = current.get(row.entityId) ?? { cost: null, markup: null, price: null }
      if (row.fieldId === fields.cost.id) entry.cost = row.valueNumber
      else if (fields.markup && row.fieldId === fields.markup.id) entry.markup = row.valueNumber
      else if (fields.price && row.fieldId === fields.price.id) entry.price = row.valueNumber
      current.set(row.entityId, entry)
    }
  }

  // ── Step 4: write cost always, price only where markup is set ──
  const catalogDefId = await requireCachedEntityDefId(organizationId, 'catalog_item')
  const writes: CatalogFieldWrite[] = []

  for (const { catalogInstanceId, partInstanceId } of linkRows) {
    if (!partInstanceId) continue
    const newCost = partCosts.get(partInstanceId)
    if (newCost == null) continue

    const existing = current.get(catalogInstanceId) ?? { cost: null, markup: null, price: null }
    const recordId = toRecordId(catalogDefId, catalogInstanceId) as RecordId

    if (existing.cost !== newCost) {
      writes.push({
        recordId,
        fieldId: fields.cost.id,
        fieldType: fields.cost.type,
        value: newCost,
      })
    }

    if (fields.price && existing.markup != null) {
      const newPrice = computeMarkupPrice(newCost, existing.markup)
      if (existing.price !== newPrice) {
        writes.push({
          recordId,
          fieldId: fields.price.id,
          fieldType: fields.price.type,
          value: newPrice,
        })
      }
    }
  }

  await writeCatalogNumberValues(organizationId, writes)

  logger.info('Synced catalog item pricing from part cost change', {
    organizationId,
    changedParts: changedPartIds.length,
    affectedItems: linkRows.length,
    writes: writes.length,
  })
}

// ─── Interactive triggers (plan 17 §3 — door 1, real field-change hooks) ────

/**
 * `catalog_item_part` changed (plan 17 §3 row 1). Set → pull the new part's
 * `part_cost`, write `cost`, and recompute `price` when a markup is already set.
 * Cleared → clear `cost` only; KEEP `markup` (inert without a cost, resumes on
 * re-link). Registered under the `catalog-items` apiSlug.
 */
export const syncCatalogCostOnPartChange: EntityFieldChangeHandler = async (event) => {
  if (event.field.systemAttribute !== 'catalog_item_part') return

  const { organizationId, recordId } = event
  const fields = await resolveCatalogPricingFields(organizationId)
  if (!fields) return

  const partInstanceId = relationshipEntityInstanceId(event.newValue)
  const currentCost = await readCurrentNumber(organizationId, recordId, fields.cost.id)

  if (!partInstanceId) {
    if (currentCost == null) return
    await writeCatalogNumberValues(organizationId, [
      { recordId, fieldId: fields.cost.id, fieldType: fields.cost.type, value: null },
    ])
    return
  }

  const partCostField = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttribute('part_cost')
  if (!partCostField) return

  const newCost = await readNumberByEntityInstance(organizationId, partInstanceId, partCostField.id)
  if (newCost == null) {
    // Newly linked part has no calculated cost yet — a stale cost from a previously linked
    // part must not masquerade as synced from this one. Clear it; the next BOM recalc
    // repopulates via `syncCatalogItemPricing`.
    if (currentCost != null) {
      await writeCatalogNumberValues(organizationId, [
        { recordId, fieldId: fields.cost.id, fieldType: fields.cost.type, value: null },
      ])
    }
    return
  }

  const writes: CatalogFieldWrite[] = []
  if (currentCost !== newCost) {
    writes.push({ recordId, fieldId: fields.cost.id, fieldType: fields.cost.type, value: newCost })
  }

  if (fields.markup && fields.price) {
    const markup = await readCurrentNumber(organizationId, recordId, fields.markup.id)
    if (markup != null) {
      const newPrice = computeMarkupPrice(newCost, markup)
      const currentPrice = await readCurrentNumber(organizationId, recordId, fields.price.id)
      if (currentPrice !== newPrice) {
        writes.push({
          recordId,
          fieldId: fields.price.id,
          fieldType: fields.price.type,
          value: newPrice,
        })
      }
    }
  }

  await writeCatalogNumberValues(organizationId, writes)
}

/**
 * `catalog_item_markup` changed (plan 17 §3 row 2). Non-null + `cost` non-null →
 * recompute `price`. Cleared → nothing (that IS the pause). Registered under the
 * `catalog-items` apiSlug.
 */
export const recomputePriceOnMarkupChange: EntityFieldChangeHandler = async (event) => {
  if (event.field.systemAttribute !== 'catalog_item_markup') return

  const newMarkup = numericValue(event.newValue)
  if (newMarkup == null) return

  const { organizationId, recordId } = event
  const fields = await resolveCatalogPricingFields(organizationId)
  if (!fields?.price) return

  const cost = await readCurrentNumber(organizationId, recordId, fields.cost.id)
  if (cost == null) return

  const newPrice = computeMarkupPrice(cost, newMarkup)
  const currentPrice = await readCurrentNumber(organizationId, recordId, fields.price.id)
  if (currentPrice === newPrice) return

  await writeCatalogNumberValues(organizationId, [
    { recordId, fieldId: fields.price.id, fieldType: fields.price.type, value: newPrice },
  ])
}

/**
 * `catalog_item_default_unit_price` changed (plan 17 §3 row 3). If `markup` is
 * non-null and the new price doesn't match the computed auto price, clear `markup`
 * (pause). Retyping the exact auto price is a no-op, not a surprise pause. Registered
 * under the `catalog-items` apiSlug.
 */
export const pauseMarkupOnPriceEdit: EntityFieldChangeHandler = async (event) => {
  if (event.field.systemAttribute !== 'catalog_item_default_unit_price') return

  const { organizationId, recordId } = event
  const fields = await resolveCatalogPricingFields(organizationId)
  if (!fields?.markup) return

  const markup = await readCurrentNumber(organizationId, recordId, fields.markup.id)
  if (markup == null) return

  const cost = await readCurrentNumber(organizationId, recordId, fields.cost.id)
  const newPrice = numericValue(event.newValue)

  if (shouldPauseMarkup(newPrice, cost, markup)) {
    await writeCatalogNumberValues(organizationId, [
      { recordId, fieldId: fields.markup.id, fieldType: fields.markup.type, value: null },
    ])
  }
}
