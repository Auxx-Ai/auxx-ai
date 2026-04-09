// packages/lib/src/bom/cost-calculator.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getOrgCache, requireCachedEntityDefId } from '../cache'
import { createFieldValueContext } from '../field-values/field-value-helpers'
import { setValueWithType } from '../field-values/field-value-mutations'
import { getRealtimeService, publishFieldValueUpdates } from '../realtime'

const logger = createScopedLogger('bom:cost-calculator')

// ─── Types ───────────────────────────────────────────────────────────

interface VendorPriceRow {
  partInstanceId: string
  unitPrice: number | null
  shippingCost: number | null
  tariffRate: number | null
  otherCost: number | null
  isPreferred: boolean
}

interface VendorCostMaps {
  unitPriceMap: Map<string, number>
  landedCostMap: Map<string, number>
}

interface SubpartRow {
  parentPartId: string
  childPartId: string
  quantity: number
}

interface OrgPricingData {
  vendorPrices: VendorPriceRow[]
  subparts: SubpartRow[]
}

// ─── Data Loading ────────────────────────────────────────────────────

/**
 * Load all vendor part and subpart pricing data for an organization.
 * Uses entity system (EntityInstance + FieldValue) instead of legacy tables.
 * Two queries: one for vendor parts, one for subparts.
 */
async function loadOrgPricingData(orgId: string): Promise<OrgPricingData> {
  const cache = getOrgCache()

  // Resolve entity definition IDs for vendor_part and subpart
  const vendorPartDefId = await requireCachedEntityDefId(orgId, 'vendor_part')
  const subpartDefId = await requireCachedEntityDefId(orgId, 'subpart')

  logger.info('Loading org pricing data', { orgId, vendorPartDefId, subpartDefId })

  // Resolve custom field IDs by systemAttribute
  const [
    vpPartField,
    vpPriceField,
    vpPreferredField,
    vpShippingField,
    vpTariffField,
    vpOtherField,
    spParentField,
    spChildField,
    spQtyField,
  ] = await Promise.all([
    cache.from(orgId, 'customFields').bySystemAttribute('vendor_part_part'),
    cache.from(orgId, 'customFields').bySystemAttribute('vendor_part_unit_price'),
    cache.from(orgId, 'customFields').bySystemAttribute('vendor_part_is_preferred'),
    cache.from(orgId, 'customFields').bySystemAttribute('vendor_part_shipping_cost'),
    cache.from(orgId, 'customFields').bySystemAttribute('vendor_part_tariff_rate'),
    cache.from(orgId, 'customFields').bySystemAttribute('vendor_part_other_cost'),
    cache.from(orgId, 'customFields').bySystemAttribute('subpart_parent_part'),
    cache.from(orgId, 'customFields').bySystemAttribute('subpart_child_part'),
    cache.from(orgId, 'customFields').bySystemAttribute('subpart_quantity'),
  ])

  logger.info('Resolved custom field IDs', {
    vpPartField: vpPartField?.id ?? null,
    vpPriceField: vpPriceField?.id ?? null,
    vpPreferredField: vpPreferredField?.id ?? null,
    vpShippingField: vpShippingField?.id ?? null,
    vpTariffField: vpTariffField?.id ?? null,
    vpOtherField: vpOtherField?.id ?? null,
    spParentField: spParentField?.id ?? null,
    spChildField: spChildField?.id ?? null,
    spQtyField: spQtyField?.id ?? null,
  })

  // ── Query 1: All vendor part field values (single JOIN) ──
  const vendorPrices: VendorPriceRow[] = []

  if (vpPartField && vpPriceField && vpPreferredField) {
    const rows = await database
      .select({
        instanceId: schema.EntityInstance.id,
        fieldId: schema.FieldValue.fieldId,
        valueNumber: schema.FieldValue.valueNumber,
        valueBoolean: schema.FieldValue.valueBoolean,
        relatedEntityId: schema.FieldValue.relatedEntityId,
      })
      .from(schema.EntityInstance)
      .innerJoin(
        schema.FieldValue,
        and(
          eq(schema.FieldValue.entityId, schema.EntityInstance.id),
          eq(schema.FieldValue.organizationId, schema.EntityInstance.organizationId)
        )
      )
      .where(
        and(
          eq(schema.EntityInstance.organizationId, orgId),
          eq(schema.EntityInstance.entityDefinitionId, vendorPartDefId),
          isNull(schema.EntityInstance.archivedAt)
        )
      )

    // Group by instance and extract relevant fields
    const byInstance = new Map<
      string,
      {
        partInstanceId: string | null
        unitPrice: number | null
        shippingCost: number | null
        tariffRate: number | null
        otherCost: number | null
        isPreferred: boolean
      }
    >()

    for (const row of rows) {
      if (!byInstance.has(row.instanceId)) {
        byInstance.set(row.instanceId, {
          partInstanceId: null,
          unitPrice: null,
          shippingCost: null,
          tariffRate: null,
          otherCost: null,
          isPreferred: false,
        })
      }
      const entry = byInstance.get(row.instanceId)!
      if (row.fieldId === vpPartField.id) {
        entry.partInstanceId = row.relatedEntityId
      } else if (row.fieldId === vpPriceField.id) {
        entry.unitPrice = row.valueNumber
      } else if (row.fieldId === vpPreferredField.id) {
        entry.isPreferred = row.valueBoolean ?? false
      } else if (vpShippingField && row.fieldId === vpShippingField.id) {
        entry.shippingCost = row.valueNumber
      } else if (vpTariffField && row.fieldId === vpTariffField.id) {
        entry.tariffRate = row.valueNumber
      } else if (vpOtherField && row.fieldId === vpOtherField.id) {
        entry.otherCost = row.valueNumber
      }
    }

    for (const entry of byInstance.values()) {
      if (entry.partInstanceId) {
        vendorPrices.push({
          partInstanceId: entry.partInstanceId,
          unitPrice: entry.unitPrice,
          shippingCost: entry.shippingCost,
          tariffRate: entry.tariffRate,
          otherCost: entry.otherCost,
          isPreferred: entry.isPreferred,
        })
      }
    }
  }

  // ── Query 2: All subpart field values (single JOIN) ──
  const subparts: SubpartRow[] = []

  if (spParentField && spChildField && spQtyField) {
    const rows = await database
      .select({
        instanceId: schema.EntityInstance.id,
        fieldId: schema.FieldValue.fieldId,
        valueNumber: schema.FieldValue.valueNumber,
        relatedEntityId: schema.FieldValue.relatedEntityId,
      })
      .from(schema.EntityInstance)
      .innerJoin(
        schema.FieldValue,
        and(
          eq(schema.FieldValue.entityId, schema.EntityInstance.id),
          eq(schema.FieldValue.organizationId, schema.EntityInstance.organizationId)
        )
      )
      .where(
        and(
          eq(schema.EntityInstance.organizationId, orgId),
          eq(schema.EntityInstance.entityDefinitionId, subpartDefId),
          isNull(schema.EntityInstance.archivedAt)
        )
      )

    // Group by instance and extract relevant fields
    const byInstance = new Map<
      string,
      { parentPartId: string | null; childPartId: string | null; quantity: number }
    >()

    for (const row of rows) {
      if (!byInstance.has(row.instanceId)) {
        byInstance.set(row.instanceId, { parentPartId: null, childPartId: null, quantity: 0 })
      }
      const entry = byInstance.get(row.instanceId)!
      if (row.fieldId === spParentField.id) {
        entry.parentPartId = row.relatedEntityId
      } else if (row.fieldId === spChildField.id) {
        entry.childPartId = row.relatedEntityId
      } else if (row.fieldId === spQtyField.id) {
        entry.quantity = row.valueNumber ?? 0
      }
    }

    for (const entry of byInstance.values()) {
      if (entry.parentPartId && entry.childPartId && entry.quantity > 0) {
        subparts.push({
          parentPartId: entry.parentPartId,
          childPartId: entry.childPartId,
          quantity: entry.quantity,
        })
      }
    }
  }

  return { vendorPrices, subparts }
}

// ─── Graph Building ──────────────────────────────────────────────────

/**
 * Compute landed cost for a vendor part row.
 * Formula: unit_price + shipping_cost + (unit_price * tariff_rate / 100) + other_cost
 */
function computeLandedCost(row: VendorPriceRow): number | null {
  if (row.unitPrice == null) return null
  const shipping = row.shippingCost ?? 0
  const tariff = row.unitPrice * ((row.tariffRate ?? 0) / 100)
  const other = row.otherCost ?? 0
  return row.unitPrice + shipping + tariff + other
}

/**
 * Best vendor per part: preferred first, then cheapest landed cost.
 * Returns two maps: raw unit price and computed landed cost.
 */
function buildVendorCostMaps(vendorPrices: VendorPriceRow[]): VendorCostMaps {
  const unitPriceMap = new Map<string, number>()
  const landedCostMap = new Map<string, number>()

  // Group by partInstanceId
  const byPart = new Map<string, VendorPriceRow[]>()
  for (const vp of vendorPrices) {
    if (vp.unitPrice == null) continue
    const group = byPart.get(vp.partInstanceId) ?? []
    group.push(vp)
    byPart.set(vp.partInstanceId, group)
  }

  for (const [partId, rows] of byPart) {
    // Preferred vendors first, then sort by landed cost ascending
    const sorted = rows.sort((a, b) => {
      if (a.isPreferred !== b.isPreferred) return a.isPreferred ? -1 : 1
      return (computeLandedCost(a) ?? 0) - (computeLandedCost(b) ?? 0)
    })
    const best = sorted[0]
    if (best?.unitPrice != null) {
      unitPriceMap.set(partId, best.unitPrice)
      const landed = computeLandedCost(best)
      if (landed != null) {
        landedCostMap.set(partId, landed)
      }
    }
  }

  return { unitPriceMap, landedCostMap }
}

/** Adjacency list: parent → [{ childId, qty }] */
function buildSubpartGraph(
  subparts: SubpartRow[]
): Map<string, { childId: string; qty: number }[]> {
  const map = new Map<string, { childId: string; qty: number }[]>()
  for (const sp of subparts) {
    const children = map.get(sp.parentPartId) ?? []
    children.push({ childId: sp.childPartId, qty: sp.quantity })
    map.set(sp.parentPartId, children)
  }
  return map
}

/** Reverse adjacency: child → [parentId] (for propagation) */
function buildParentGraph(subparts: SubpartRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const sp of subparts) {
    const parents = map.get(sp.childPartId) ?? []
    parents.push(sp.parentPartId)
    map.set(sp.childPartId, parents)
  }
  return map
}

// ─── Cost Calculation ────────────────────────────────────────────────

/**
 * Calculate costs for all parts in-memory using memoized DFS.
 * Vendor price takes priority over composite cost.
 */
function calculateAllCosts(
  vendorPriceMap: Map<string, number>,
  subpartGraph: Map<string, { childId: string; qty: number }[]>
): Map<string, number> {
  const costs = new Map<string, number>()
  const inProgress = new Set<string>()

  function calc(partId: string): number {
    if (costs.has(partId)) return costs.get(partId)!
    if (inProgress.has(partId)) {
      logger.warn('Circular reference detected in BOM, treating cost as 0', { partId })
      costs.set(partId, 0)
      return 0
    }
    inProgress.add(partId)

    // Vendor price takes priority
    const vendorPrice = vendorPriceMap.get(partId)
    if (vendorPrice != null) {
      costs.set(partId, vendorPrice)
      inProgress.delete(partId)
      return vendorPrice
    }

    // Sum of (child cost × quantity)
    const children = subpartGraph.get(partId) ?? []
    const cost = children.reduce((sum, c) => sum + calc(c.childId) * c.qty, 0)
    costs.set(partId, cost)
    inProgress.delete(partId)
    return cost
  }

  // Collect all part IDs that appear anywhere in the graph
  const allPartIds = new Set([
    ...vendorPriceMap.keys(),
    ...subpartGraph.keys(),
    ...[...subpartGraph.values()].flatMap((children) => children.map((c) => c.childId)),
  ])

  for (const id of allPartIds) calc(id)

  return costs
}

// ─── Persistence ─────────────────────────────────────────────────────

interface CurrentPartValues {
  costs: Map<string, number>
  unitPrices: Map<string, number>
}

/**
 * Load current cached cost and unit price values for all parts in the org.
 */
async function loadCurrentPartValues(orgId: string): Promise<CurrentPartValues> {
  const cache = getOrgCache()
  const [costField, unitPriceField] = await Promise.all([
    cache.from(orgId, 'customFields').bySystemAttribute('part_cost'),
    cache.from(orgId, 'customFields').bySystemAttribute('part_unit_price'),
  ])

  const costs = new Map<string, number>()
  const unitPrices = new Map<string, number>()

  const fieldIds = [costField?.id, unitPriceField?.id].filter(Boolean) as string[]
  if (fieldIds.length === 0) return { costs, unitPrices }

  const rows = await database
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueNumber: schema.FieldValue.valueNumber,
    })
    .from(schema.FieldValue)
    .where(
      and(inArray(schema.FieldValue.fieldId, fieldIds), eq(schema.FieldValue.organizationId, orgId))
    )

  for (const row of rows) {
    if (row.valueNumber == null) continue
    if (costField && row.fieldId === costField.id) {
      costs.set(row.entityId, row.valueNumber)
    } else if (unitPriceField && row.fieldId === unitPriceField.id) {
      unitPrices.set(row.entityId, row.valueNumber)
    }
  }

  return { costs, unitPrices }
}

/**
 * Write calculated costs and unit prices back to each part's FieldValues.
 * Only writes parts whose values actually changed.
 * Returns IDs of parts whose values changed.
 */
async function persistCosts(
  orgId: string,
  landedCosts: Map<string, number>,
  unitPrices: Map<string, number>,
  previous: CurrentPartValues
): Promise<string[]> {
  const cache = getOrgCache()
  const [costField, unitPriceField] = await Promise.all([
    cache.from(orgId, 'customFields').bySystemAttribute('part_cost'),
    cache.from(orgId, 'customFields').bySystemAttribute('part_unit_price'),
  ])

  if (!costField) {
    logger.warn('part_cost custom field not found, skipping cost persistence')
    return []
  }

  const partDefId = await requireCachedEntityDefId(orgId, 'part')
  const ctx = createFieldValueContext(orgId)

  logger.info('Persisting costs', {
    costFieldId: costField.id,
    unitPriceFieldId: unitPriceField?.id ?? null,
    partDefId,
    totalCosts: landedCosts.size,
    totalUnitPrices: unitPrices.size,
  })

  // Collect parts with changed values (cost or unit price)
  interface ChangedEntry {
    partId: string
    cost: number | null
    unitPrice: number | null
    costChanged: boolean
    unitPriceChanged: boolean
  }

  const allPartIds = new Set([...landedCosts.keys(), ...unitPrices.keys()])
  const changedEntries: ChangedEntry[] = []

  for (const partId of allPartIds) {
    const cost = landedCosts.get(partId) ?? null
    const unitPrice = unitPrices.get(partId) ?? null
    const prevCost = previous.costs.get(partId) ?? null
    const prevUnitPrice = previous.unitPrices.get(partId) ?? null
    const costChanged = cost !== prevCost
    const unitPriceChanged = unitPrice !== prevUnitPrice

    if (costChanged || unitPriceChanged) {
      changedEntries.push({ partId, cost, unitPrice, costChanged, unitPriceChanged })
    }
  }

  logger.info('Parts with changed values', { count: changedEntries.length })

  // Write all changed values concurrently (bounded to avoid overwhelming the DB)
  const BATCH_SIZE = 20
  const changedPartIds: string[] = []

  for (let i = 0; i < changedEntries.length; i += BATCH_SIZE) {
    const batch = changedEntries.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(async (entry) => {
        const recordId = toRecordId(partDefId, entry.partId) as RecordId
        const writes: Promise<unknown>[] = []

        if (entry.costChanged && entry.cost != null) {
          writes.push(
            setValueWithType(ctx, {
              recordId,
              fieldId: costField.id,
              fieldType: costField.type,
              value: { type: 'number', value: entry.cost },
            })
          )
        }

        if (entry.unitPriceChanged && unitPriceField && entry.unitPrice != null) {
          writes.push(
            setValueWithType(ctx, {
              recordId,
              fieldId: unitPriceField.id,
              fieldType: unitPriceField.type,
              value: { type: 'number', value: entry.unitPrice },
            })
          )
        }

        await Promise.all(writes)
        return entry.partId
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        changedPartIds.push(result.value)
      } else {
        logger.error('Failed to persist values for part', {
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          stack: result.reason instanceof Error ? result.reason.stack : undefined,
        })
      }
    }
  }

  // Publish cascaded changes to all clients
  if (changedPartIds.length > 0) {
    const entries: Array<{ key: string; value: { type: 'number'; value: number } }> = []
    for (const entry of changedEntries) {
      if (!changedPartIds.includes(entry.partId)) continue
      const recordId = toRecordId(partDefId, entry.partId) as RecordId

      if (entry.costChanged && entry.cost != null) {
        entries.push({
          key: buildFieldValueKey(recordId, costField.id as FieldId),
          value: { type: 'number', value: entry.cost },
        })
      }
      if (entry.unitPriceChanged && unitPriceField && entry.unitPrice != null) {
        entries.push({
          key: buildFieldValueKey(recordId, unitPriceField.id as FieldId),
          value: { type: 'number', value: entry.unitPrice },
        })
      }
    }
    publishFieldValueUpdates(getRealtimeService(), orgId, entries).catch(() => {})
  }

  return changedPartIds
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Recalculate costs for all parts in an organization.
 * Loads all vendor parts and subparts, builds the graph in memory,
 * and persists any changed cost values.
 */
export async function recalculateAllPartCosts(orgId: string): Promise<string[]> {
  const { vendorPrices, subparts } = await loadOrgPricingData(orgId)
  const { unitPriceMap, landedCostMap } = buildVendorCostMaps(vendorPrices)
  const subpartGraph = buildSubpartGraph(subparts)
  const costs = calculateAllCosts(landedCostMap, subpartGraph)
  const previous = await loadCurrentPartValues(orgId)
  const changedIds = await persistCosts(orgId, costs, unitPriceMap, previous)

  logger.info('Recalculated all part costs', {
    orgId,
    totalParts: costs.size,
    changedParts: changedIds.length,
  })

  return changedIds
}

/**
 * Recalculate costs for specific parts and all their ancestors.
 * Still loads all org data (cheap at ~300 parts), but only recalculates
 * the affected subtree and persists changed values.
 */
export async function recalculateAffectedParts(
  orgId: string,
  affectedPartIds: string[]
): Promise<string[]> {
  const { vendorPrices, subparts } = await loadOrgPricingData(orgId)
  const { unitPriceMap, landedCostMap } = buildVendorCostMaps(vendorPrices)
  const subpartGraph = buildSubpartGraph(subparts)
  const parentGraph = buildParentGraph(subparts)

  // Find all ancestors of affected parts
  const dirtySet = new Set<string>()
  function markDirty(partId: string) {
    if (dirtySet.has(partId)) return
    dirtySet.add(partId)
    for (const parent of parentGraph.get(partId) ?? []) {
      markDirty(parent)
    }
  }
  for (const id of affectedPartIds) markDirty(id)

  // Calculate costs for all parts (memoized, so cheap)
  const allCosts = calculateAllCosts(landedCostMap, subpartGraph)

  // Only persist values for the dirty set
  const dirtyCosts = new Map<string, number>()
  const dirtyUnitPrices = new Map<string, number>()
  for (const partId of dirtySet) {
    const cost = allCosts.get(partId)
    if (cost != null) dirtyCosts.set(partId, cost)
    const up = unitPriceMap.get(partId)
    if (up != null) dirtyUnitPrices.set(partId, up)
  }

  const previous = await loadCurrentPartValues(orgId)
  const changedIds = await persistCosts(orgId, dirtyCosts, dirtyUnitPrices, previous)

  logger.info('Recalculated affected part costs', {
    orgId,
    affectedParts: affectedPartIds.length,
    dirtyParts: dirtySet.size,
    changedParts: changedIds.length,
  })

  return changedIds
}

// ─── Exported helpers for BomService ─────────────────────────────────

export { loadOrgPricingData, buildVendorCostMaps, buildSubpartGraph, buildParentGraph }
export type { VendorPriceRow, VendorCostMaps, SubpartRow, OrgPricingData }
