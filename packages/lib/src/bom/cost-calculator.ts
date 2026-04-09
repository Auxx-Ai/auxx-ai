// packages/lib/src/bom/cost-calculator.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, isNull } from 'drizzle-orm'
import { getOrgCache, requireCachedEntityDefId } from '../cache'
import { createFieldValueContext } from '../field-values/field-value-helpers'
import { setValueWithType } from '../field-values/field-value-mutations'
import { getRealtimeService, publishFieldValueUpdates } from '../realtime'

const logger = createScopedLogger('bom:cost-calculator')

// ─── Types ───────────────────────────────────────────────────────────

interface VendorPriceRow {
  partInstanceId: string
  unitPrice: number | null
  isPreferred: boolean
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
  const [vpPartField, vpPriceField, vpPreferredField, spParentField, spChildField, spQtyField] =
    await Promise.all([
      cache.from(orgId, 'customFields').bySystemAttribute('vendor_part_part'),
      cache.from(orgId, 'customFields').bySystemAttribute('vendor_part_unit_price'),
      cache.from(orgId, 'customFields').bySystemAttribute('vendor_part_is_preferred'),
      cache.from(orgId, 'customFields').bySystemAttribute('subpart_parent_part'),
      cache.from(orgId, 'customFields').bySystemAttribute('subpart_child_part'),
      cache.from(orgId, 'customFields').bySystemAttribute('subpart_quantity'),
    ])

  logger.info('Resolved custom field IDs', {
    vpPartField: vpPartField?.id ?? null,
    vpPriceField: vpPriceField?.id ?? null,
    vpPreferredField: vpPreferredField?.id ?? null,
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
      { partInstanceId: string | null; unitPrice: number | null; isPreferred: boolean }
    >()

    for (const row of rows) {
      if (!byInstance.has(row.instanceId)) {
        byInstance.set(row.instanceId, {
          partInstanceId: null,
          unitPrice: null,
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
      }
    }

    for (const entry of byInstance.values()) {
      if (entry.partInstanceId) {
        vendorPrices.push({
          partInstanceId: entry.partInstanceId,
          unitPrice: entry.unitPrice,
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
 * Best vendor price per part: preferred vendor first, then cheapest.
 */
function buildVendorPriceMap(vendorPrices: VendorPriceRow[]): Map<string, number> {
  const map = new Map<string, number>()

  // Group by partInstanceId
  const byPart = new Map<string, VendorPriceRow[]>()
  for (const vp of vendorPrices) {
    if (vp.unitPrice == null) continue
    const group = byPart.get(vp.partInstanceId) ?? []
    group.push(vp)
    byPart.set(vp.partInstanceId, group)
  }

  for (const [partId, rows] of byPart) {
    // Preferred vendors first, then sort by price ascending
    const sorted = rows.sort((a, b) => {
      if (a.isPreferred !== b.isPreferred) return a.isPreferred ? -1 : 1
      return (a.unitPrice ?? 0) - (b.unitPrice ?? 0)
    })
    const best = sorted[0]
    if (best?.unitPrice != null) {
      map.set(partId, best.unitPrice)
    }
  }

  return map
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

/**
 * Load current cached cost values for all parts in the org.
 * Returns a map of partInstanceId → current cost.
 */
async function loadCurrentCosts(orgId: string): Promise<Map<string, number>> {
  const cache = getOrgCache()
  const costField = await cache.from(orgId, 'customFields').bySystemAttribute('part_cost')
  if (!costField) return new Map()

  const currentCosts = new Map<string, number>()

  const costValues = await database
    .select({
      entityId: schema.FieldValue.entityId,
      valueNumber: schema.FieldValue.valueNumber,
    })
    .from(schema.FieldValue)
    .where(
      and(eq(schema.FieldValue.fieldId, costField.id), eq(schema.FieldValue.organizationId, orgId))
    )

  for (const cv of costValues) {
    if (cv.valueNumber != null) {
      currentCosts.set(cv.entityId, cv.valueNumber)
    }
  }

  return currentCosts
}

/**
 * Write calculated costs back to each part's `part_cost` FieldValue.
 * Only writes parts whose cost actually changed.
 * Returns IDs of parts whose cost changed.
 */
async function persistCosts(
  orgId: string,
  costs: Map<string, number>,
  previousCosts: Map<string, number>
): Promise<string[]> {
  const cache = getOrgCache()
  const costField = await cache.from(orgId, 'customFields').bySystemAttribute('part_cost')
  if (!costField) {
    logger.warn('part_cost custom field not found, skipping cost persistence')
    return []
  }

  const partDefId = await requireCachedEntityDefId(orgId, 'part')
  const ctx = createFieldValueContext(orgId)

  logger.info('Persisting costs', {
    costFieldId: costField.id,
    costFieldType: costField.type,
    partDefId,
    totalCosts: costs.size,
    previousCostsSize: previousCosts.size,
  })

  // Collect parts with changed costs
  const changedEntries: Array<{ partId: string; cost: number }> = []
  for (const [partId, cost] of costs) {
    if (previousCosts.get(partId) !== cost) {
      changedEntries.push({ partId, cost })
    }
  }

  logger.info('Parts with changed costs', { count: changedEntries.length })

  // Write all changed costs concurrently (bounded to avoid overwhelming the DB)
  const BATCH_SIZE = 20
  const changedPartIds: string[] = []

  for (let i = 0; i < changedEntries.length; i += BATCH_SIZE) {
    const batch = changedEntries.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(({ partId, cost }) => {
        const recordId = toRecordId(partDefId, partId) as RecordId
        logger.debug('Persisting cost', {
          partId,
          cost,
          recordId,
          fieldId: costField.id,
          fieldType: costField.type,
        })
        return setValueWithType(ctx, {
          recordId,
          fieldId: costField.id,
          fieldType: costField.type,
          value: { type: 'number', value: cost },
        }).then(() => partId)
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        changedPartIds.push(result.value)
      } else {
        logger.error('Failed to persist cost for part', {
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          stack: result.reason instanceof Error ? result.reason.stack : undefined,
        })
      }
    }
  }

  // Publish cascaded cost changes to all clients (NO socket exclusion —
  // the user edited vendor_part_unit_price, not part_cost, so all clients need these)
  if (changedPartIds.length > 0) {
    const entries = changedEntries
      .filter(({ partId }) => changedPartIds.includes(partId))
      .map(({ partId, cost }) => {
        const recordId = toRecordId(partDefId, partId) as RecordId
        return {
          key: buildFieldValueKey(recordId, costField.id as FieldId),
          value: { type: 'number' as const, value: cost },
        }
      })
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
  const vendorPriceMap = buildVendorPriceMap(vendorPrices)
  const subpartGraph = buildSubpartGraph(subparts)
  const costs = calculateAllCosts(vendorPriceMap, subpartGraph)
  const previousCosts = await loadCurrentCosts(orgId)
  const changedIds = await persistCosts(orgId, costs, previousCosts)

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
  const vendorPriceMap = buildVendorPriceMap(vendorPrices)
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
  const allCosts = calculateAllCosts(vendorPriceMap, subpartGraph)

  // Only persist costs for the dirty set
  const dirtyCosts = new Map<string, number>()
  for (const partId of dirtySet) {
    const cost = allCosts.get(partId)
    if (cost != null) dirtyCosts.set(partId, cost)
  }

  const previousCosts = await loadCurrentCosts(orgId)
  const changedIds = await persistCosts(orgId, dirtyCosts, previousCosts)

  logger.info('Recalculated affected part costs', {
    orgId,
    affectedParts: affectedPartIds.length,
    dirtyParts: dirtySet.size,
    changedParts: changedIds.length,
  })

  return changedIds
}

// ─── Exported helpers for BomService ─────────────────────────────────

export { loadOrgPricingData, buildVendorPriceMap, buildSubpartGraph, buildParentGraph }
export type { VendorPriceRow, SubpartRow, OrgPricingData }
