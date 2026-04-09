// packages/lib/src/bom/bom-service.ts
// Service for BOM (Bill of Materials) operations using the entity system

import { database as db, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import {
  buildSubpartGraph,
  buildVendorPriceMap,
  loadOrgPricingData,
  type SubpartRow,
} from './cost-calculator'
import type { PartCost, PartItem, RequieredQuantity, Subpart } from './types'

/** Service for BOM (Bill of Materials) operations */
export class BomService {
  /**
   * Get a flattened BOM for a part, showing all components needed.
   * Uses entity system for subpart data, legacy tables for inventory.
   * @param partId - EntityInstance ID of the part
   * @param depth - Maximum depth to traverse (default: 10)
   */
  static async getFlattenedBom(organizationId: string, partId: string, depth: number = 10) {
    // Load all subpart relationships from the entity system
    const { subparts } = await loadOrgPricingData(organizationId)
    const subpartGraph = buildSubpartGraph(subparts)

    // Load part display info from EntityInstance
    const partIds = collectAllPartIds(partId, subpartGraph, depth)
    const partInfoMap = await loadPartInfo(organizationId, [...partIds])

    const rootPart = partInfoMap.get(partId)
    if (!rootPart) {
      throw new Error(`Part with ID ${partId} not found`)
    }

    // Build flattened BOM tree
    const items = flattenBom(partId, subpartGraph, partInfoMap, 1, depth, 1)

    // Load inventory for all parts in the BOM
    const itemPartIds = items.map((i) => i.partId)
    if (itemPartIds.length > 0) {
      const inventoryMap = await loadInventory(organizationId, itemPartIds)
      for (const item of items) {
        const inv = inventoryMap.get(item.partId)
        if (inv) {
          ;(item.part as any).inventory = inv
        }
      }
    }

    return { part: rootPart, items }
  }

  /**
   * Check if adding a subpart would create a circular reference.
   * Uses in-memory graph from entity system.
   * @param parentId - EntityInstance ID of the parent part
   * @param subPartId - EntityInstance ID of the subpart to add
   */
  static async checkCircularReference(
    organizationId: string,
    parentId: string,
    subPartId: string
  ): Promise<boolean> {
    if (parentId === subPartId) return true

    const { subparts } = await loadOrgPricingData(organizationId)
    const subpartGraph = buildSubpartGraph(subparts)

    // DFS: check if parentId is reachable from subPartId
    const visited = new Set<string>()
    function isReachable(from: string, target: string): boolean {
      if (from === target) return true
      if (visited.has(from)) return false
      visited.add(from)
      for (const child of subpartGraph.get(from) ?? []) {
        if (isReachable(child.childId, target)) return true
      }
      return false
    }

    return isReachable(subPartId, parentId)
  }

  /**
   * Calculate cost of a part based on vendor prices or subpart costs.
   * Uses in-memory graph from entity system.
   * @param partId - EntityInstance ID of the part
   * @param usePreferredVendorsOnly - Whether to only use preferred vendors
   */
  static async calculatePartCost(
    organizationId: string,
    partId: string,
    usePreferredVendorsOnly: boolean = false
  ): Promise<PartCost> {
    const { vendorPrices, subparts } = await loadOrgPricingData(organizationId)

    // Filter to preferred only if requested
    const filteredPrices = usePreferredVendorsOnly
      ? vendorPrices.filter((vp) => vp.isPreferred)
      : vendorPrices

    const vendorPriceMap = buildVendorPriceMap(filteredPrices)
    const subpartGraph = buildSubpartGraph(subparts)
    const partInfoMap = await loadPartInfo(organizationId, [
      ...collectAllPartIds(partId, subpartGraph, 100),
    ])

    return calculatePartCostRecursive(
      partId,
      vendorPriceMap,
      vendorPrices,
      subpartGraph,
      partInfoMap,
      new Map()
    )
  }

  /**
   * Calculate the total required quantity for each part in a BOM.
   * Uses entity system for BOM structure, legacy tables for inventory.
   */
  static async calculateRequiredQuantities(
    organizationId: string,
    partId: string,
    quantity: number = 1
  ): Promise<RequieredQuantity[]> {
    const bom = await BomService.getFlattenedBom(organizationId, partId)

    const partMap = new Map<string, number>()
    for (const item of bom.items) {
      const requiredQty = item.quantity * quantity
      partMap.set(item.partId, (partMap.get(item.partId) ?? 0) + requiredQty)
    }

    const partIds = Array.from(partMap.keys())
    if (partIds.length === 0) return []

    // Load part info and inventory from legacy tables
    const rows = await db
      .select({
        part: {
          id: schema.Part.id,
          title: schema.Part.title,
          description: schema.Part.description,
          sku: schema.Part.sku,
          hsCode: schema.Part.hsCode,
          category: schema.Part.category,
        },
        inv: {
          quantity: schema.Inventory.quantity,
          location: schema.Inventory.location,
          reorderPoint: schema.Inventory.reorderPoint,
          reorderQty: schema.Inventory.reorderQty,
        },
      })
      .from(schema.Part)
      .leftJoin(
        schema.Inventory,
        and(
          eq(schema.Inventory.partId, schema.Part.id),
          eq(schema.Inventory.organizationId, organizationId)
        )
      )
      .where(inArray(schema.Part.id, partIds))

    const byId = new Map(rows.map((r) => [r.part.id, r]))
    const requiredQuantities: RequieredQuantity[] = []

    for (const [pid, requiredQty] of partMap.entries()) {
      const row = byId.get(pid)
      if (!row) continue

      const part: PartItem = {
        id: row.part.id,
        title: row.part.title,
        description: row.part.description,
        sku: row.part.sku,
        hsCode: row.part.hsCode,
        category: row.part.category,
        ...(row.inv.quantity != null
          ? {
              inventory: {
                quantity: row.inv.quantity as number,
                location: row.inv.location ?? undefined,
                reorderPoint: (row.inv.reorderPoint as any) ?? undefined,
                reorderQty: (row.inv.reorderQty as any) ?? undefined,
              },
            }
          : {}),
      }

      const available = (row.inv.quantity as number | null) ?? 0
      const shortage = Math.max(0, requiredQty - available)

      requiredQuantities.push({
        partId: pid,
        part,
        requiredQuantity: requiredQty,
        availableQuantity: available,
        shortage,
        needsReorder: shortage > 0,
      })
    }

    return requiredQuantities
  }

  /**
   * Check if inventory is sufficient for building a specific quantity of a part
   */
  static async checkInventorySufficiency(
    organizationId: string,
    partId: string,
    quantity: number = 1
  ) {
    const requirements = await BomService.calculateRequiredQuantities(
      organizationId,
      partId,
      quantity
    )
    const shortages = requirements.filter((req) => req.shortage > 0)
    return { canBuild: shortages.length === 0, shortages, requirements }
  }

  /**
   * Update inventory based on building a part (decrease subpart quantities).
   * Uses legacy Inventory table.
   */
  static async buildPart(organizationId: string, partId: string, quantity: number = 1) {
    const inventoryCheck = await BomService.checkInventorySufficiency(
      organizationId,
      partId,
      quantity
    )

    if (!inventoryCheck.canBuild) {
      throw new Error('Insufficient inventory to build this part')
    }

    return db.transaction(async (tx) => {
      for (const requirement of inventoryCheck.requirements) {
        const { partId: subPartId, availableQuantity, requiredQuantity } = requirement
        const newQuantity = availableQuantity - requiredQuantity

        const updated = await tx
          .update(schema.Inventory)
          .set({ quantity: newQuantity, updatedAt: new Date() })
          .where(
            and(
              eq(schema.Inventory.organizationId, organizationId),
              eq(schema.Inventory.partId, subPartId)
            )
          )
          .returning()

        if (updated.length === 0) {
          await tx.insert(schema.Inventory).values({
            organizationId,
            partId: subPartId,
            quantity: newQuantity,
            updatedAt: new Date(),
          })
        }
      }

      const [existing] = await tx
        .select({ quantity: schema.Inventory.quantity })
        .from(schema.Inventory)
        .where(
          and(
            eq(schema.Inventory.organizationId, organizationId),
            eq(schema.Inventory.partId, partId)
          )
        )
        .limit(1)

      if (existing) {
        await tx
          .update(schema.Inventory)
          .set({ quantity: (existing.quantity as number) + quantity, updatedAt: new Date() })
          .where(
            and(
              eq(schema.Inventory.organizationId, organizationId),
              eq(schema.Inventory.partId, partId)
            )
          )
      } else {
        await tx
          .insert(schema.Inventory)
          .values({ organizationId, partId, quantity, updatedAt: new Date() })
      }

      return { success: true, quantityBuilt: quantity }
    })
  }

  /**
   * Get all parts where a specific part is used as a subpart.
   * Uses entity system subpart graph.
   */
  static async getPartUsage(organizationId: string, partId: string) {
    const { subparts } = await loadOrgPricingData(organizationId)
    const parents: { parentPartId: string; quantity: number }[] = []

    for (const sp of subparts) {
      if (sp.childPartId === partId) {
        parents.push({ parentPartId: sp.parentPartId, quantity: sp.quantity })
      }
    }

    return parents
  }
}

// ─── Internal helpers ────────────────────────────────────────────────

/** Collect all part IDs reachable from a root part in the subpart graph */
function collectAllPartIds(
  rootId: string,
  graph: Map<string, { childId: string; qty: number }[]>,
  maxDepth: number,
  depth: number = 0
): Set<string> {
  const ids = new Set<string>([rootId])
  if (depth >= maxDepth) return ids

  for (const child of graph.get(rootId) ?? []) {
    ids.add(child.childId)
    for (const id of collectAllPartIds(child.childId, graph, maxDepth, depth + 1)) {
      ids.add(id)
    }
  }
  return ids
}

/** Load part display info from legacy Part table (until fully migrated) */
async function loadPartInfo(
  organizationId: string,
  partIds: string[]
): Promise<Map<string, PartItem>> {
  if (partIds.length === 0) return new Map()

  const rows = await db
    .select({
      id: schema.Part.id,
      title: schema.Part.title,
      description: schema.Part.description,
      sku: schema.Part.sku,
      hsCode: schema.Part.hsCode,
      category: schema.Part.category,
    })
    .from(schema.Part)
    .where(and(eq(schema.Part.organizationId, organizationId), inArray(schema.Part.id, partIds)))

  return new Map(rows.map((r) => [r.id, r]))
}

/** Load inventory data for a set of part IDs */
async function loadInventory(
  organizationId: string,
  partIds: string[]
): Promise<Map<string, { quantity: number; location?: string }>> {
  if (partIds.length === 0) return new Map()

  const rows = await db
    .select({
      partId: schema.Inventory.partId,
      quantity: schema.Inventory.quantity,
      location: schema.Inventory.location,
    })
    .from(schema.Inventory)
    .where(
      and(
        eq(schema.Inventory.organizationId, organizationId),
        inArray(schema.Inventory.partId, partIds)
      )
    )

  return new Map(
    rows.map((r) => [
      r.partId,
      { quantity: r.quantity as number, location: r.location ?? undefined },
    ])
  )
}

/** Flatten BOM tree into a list of Subpart items */
function flattenBom(
  parentId: string,
  graph: Map<string, { childId: string; qty: number }[]>,
  partInfoMap: Map<string, PartItem>,
  level: number,
  maxDepth: number,
  parentQuantity: number
): Subpart[] {
  if (level > maxDepth) return []

  const children = graph.get(parentId) ?? []
  const result: Subpart[] = []

  for (const child of children) {
    const totalQuantity = child.qty * parentQuantity
    const partInfo = partInfoMap.get(child.childId)

    result.push({
      id: child.childId, // Using child part ID as subpart ID
      partId: child.childId,
      level,
      part: (partInfo ?? { id: child.childId }) as any,
      quantity: child.qty,
      totalQuantity,
      notes: null,
    })

    if (level < maxDepth) {
      const deeper = flattenBom(
        child.childId,
        graph,
        partInfoMap,
        level + 1,
        maxDepth,
        totalQuantity
      )
      result.push(...deeper)
    }
  }

  return result
}

/** Recursive cost calculation returning rich PartCost objects */
function calculatePartCostRecursive(
  partId: string,
  vendorPriceMap: Map<string, number>,
  vendorPrices: { partInstanceId: string; unitPrice: number | null; isPreferred: boolean }[],
  subpartGraph: Map<string, { childId: string; qty: number }[]>,
  partInfoMap: Map<string, PartItem>,
  memo: Map<string, PartCost>
): PartCost {
  if (memo.has(partId)) return memo.get(partId)!

  // Check vendor price
  const vendorPrice = vendorPriceMap.get(partId)
  if (vendorPrice != null) {
    // Find the vendor part row that provided this price for contact info
    const vpRow = vendorPrices.find(
      (vp) => vp.partInstanceId === partId && vp.unitPrice === vendorPrice
    )
    const result: PartCost = {
      partId,
      cost: vendorPrice,
      isComposite: false,
    }
    memo.set(partId, result)
    return result
  }

  // Calculate composite cost from subparts
  const children = subpartGraph.get(partId) ?? []
  if (children.length > 0) {
    let totalCost = 0
    const subpartCosts: NonNullable<PartCost['subpartCosts']> = []

    for (const child of children) {
      const childCost = calculatePartCostRecursive(
        child.childId,
        vendorPriceMap,
        vendorPrices,
        subpartGraph,
        partInfoMap,
        memo
      )
      const lineCost = childCost.cost * child.qty
      totalCost += lineCost

      const partInfo = partInfoMap.get(child.childId)
      subpartCosts.push({
        subpartId: child.childId,
        subpart: { id: child.childId, title: partInfo?.title ?? '' },
        quantity: child.qty,
        unitCost: childCost.cost,
        totalCost: lineCost,
      })
    }

    const result: PartCost = { partId, cost: totalCost, isComposite: true, subpartCosts }
    memo.set(partId, result)
    return result
  }

  // No pricing available
  const result: PartCost = { partId, cost: 0, isComposite: false, noPricing: true }
  memo.set(partId, result)
  return result
}
