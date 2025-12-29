// packages/lib/src/bom/bom-service.ts
// Service for BOM (Bill of Materials) operations using Drizzle

import { database as db, schema } from '@auxx/database'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Subpart, PartCost, PartItem, RequieredQuantity } from './types'

/** Service for BOM (Bill of Materials) operations */
export class BomService {
  /**
   * Get a flattened BOM for a part, showing all components needed
   * @param partId - ID of the part to get BOM for
   * @param depth - Maximum depth to traverse (default: 10)
   */
  static async getFlattenedBom(organizationId: string, partId: string, depth: number = 10) {
    // Check if part exists (Drizzle)
    const [part] = await db
      .select()
      .from(schema.Part)
      .where(and(eq(schema.Part.organizationId, organizationId), eq(schema.Part.id, partId)))
      .limit(1)

    if (!part) {
      throw new Error(`Part with ID ${partId} not found`)
    }

    // Get all subparts recursively
    const bomItems = await this.getSubpartsRecursive(organizationId, partId, 1, depth)

    // Return flattened BOM with totals
    return { part, items: bomItems }
  }

  /**
   * Recursively get all subparts for a part
   * @param partId - ID of the parent part
   * @param level - Current level in the BOM hierarchy
   * @param maxDepth - Maximum depth to traverse
   * @param parentQuantity - Quantity of the parent (for multiplication)
   */
  private static async getSubpartsRecursive(
    organizationId: string,
    partId: string,
    level: number,
    maxDepth: number,
    parentQuantity: number = 1
  ) {
    if (level > maxDepth) {
      return []
    }

    // Get immediate subparts with child part + inventory (Drizzle)
    const rows = await db
      .select({
        sub: {
          id: schema.Subpart.id,
          parentPartId: schema.Subpart.parentPartId,
          childPartId: schema.Subpart.childPartId,
          quantity: schema.Subpart.quantity,
          notes: schema.Subpart.notes,
        },
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
      .from(schema.Subpart)
      .innerJoin(schema.Part, eq(schema.Subpart.childPartId, schema.Part.id))
      .leftJoin(
        schema.Inventory,
        and(
          eq(schema.Inventory.partId, schema.Part.id),
          eq(schema.Inventory.organizationId, organizationId)
        )
      )
      .where(
        and(
          eq(schema.Subpart.parentPartId, partId),
          eq(schema.Subpart.organizationId, organizationId)
        )
      )

    let result: Subpart[] = []

    // Process each subpart
    for (const row of rows) {
      const totalQuantity = (row.sub.quantity as number) * parentQuantity

      // Add this subpart to the result
      result.push({
        id: row.sub.id,
        partId: row.sub.childPartId,
        level,
        part: {
          id: row.part.id,
          title: row.part.title,
          description: row.part.description,
          sku: row.part.sku,
          hsCode: row.part.hsCode,
          category: row.part.category,
          ...(row.inv.quantity !== null && row.inv.quantity !== undefined
            ? {
                inventory: {
                  quantity: row.inv.quantity as number,
                  location: row.inv.location ?? undefined,
                  reorderPoint: (row.inv.reorderPoint as any) ?? undefined,
                  reorderQty: (row.inv.reorderQty as any) ?? undefined,
                },
              }
            : {}),
        } as PartItem,
        quantity: row.sub.quantity as number,
        totalQuantity,
        notes: row.sub.notes as string | null,
      })

      // Recursively get subparts of this subpart
      if (level < maxDepth) {
        const children = await this.getSubpartsRecursive(
          organizationId,
          row.sub.childPartId,
          level + 1,
          maxDepth,
          totalQuantity
        )

        result = [...result, ...children]
      }
    }

    return result
  }

  /**
   * Check if adding a subpart would create a circular reference
   * @param parentId - ID of the parent part
   * @param subPartId - ID of the subpart to add
   */
  static async checkCircularReference(parentId: string, subPartId: string) {
    // If parent and subpart are the same, it's a circular reference
    if (parentId === subPartId) {
      return true
    }

    // Check if the subpart already has the parent as its subpart (at any level)
    return this.isParentOfRecursive(subPartId, parentId)
  }

  /**
   * Recursively check if childId is a parent of parentId at any level
   * @param childId - ID of the potential child part
   * @param parentId - ID of the potential parent part
   */
  private static async isParentOfRecursive(childId: string, parentId: string) {
    // Get all immediate parents of the child
    const parents = await db.subpart.findMany({
      where: { childPartId: childId },
      select: { parentPartId: true },
    })

    // Check if any of these parents is the parentId we're looking for
    for (const parent of parents) {
      if (parent.parentPartId === parentId) {
        return true
      }

      // Check recursively
      const isParent = await this.isParentOfRecursive(parent.parentPartId, parentId)
      if (isParent) {
        return true
      }
    }

    return false
  }

  /**
   * Calculate the total required quantity for each part in a BOM
   * @param partId - ID of the top-level part
   * @param quantity - Quantity of the top-level part
   */
  static async calculateRequiredQuantities(
    organizationId: string,
    partId: string,
    quantity: number = 1
  ): Promise<RequieredQuantity[]> {
    // Get the flattened BOM
    const bom = await this.getFlattenedBom(organizationId, partId)

    // Calculate required quantities for each part
    const requiredQuantities = []
    const partMap = new Map()

    // First, calculate total quantity needed for each part
    for (const item of bom.items) {
      const requiredQty = item.quantity * quantity

      if (partMap.has(item.partId)) {
        // Add to existing quantity for this part
        partMap.set(item.partId, partMap.get(item.partId) + requiredQty)
      } else {
        // New part
        partMap.set(item.partId, requiredQty)
      }
    }

    // Get inventory levels and determine shortages (batched fetch)
    const partIds = Array.from(partMap.keys()) as string[]
    if (partIds.length === 0) return []

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
        ...(row.inv.quantity !== null && row.inv.quantity !== undefined
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
      const shortage = Math.max(0, (requiredQty as number) - available)

      requiredQuantities.push({
        partId: pid as string,
        part,
        requiredQuantity: requiredQty as number,
        availableQuantity: available,
        shortage,
        needsReorder: shortage > 0,
      })
    }

    return requiredQuantities
  }

  /**
   * Check if inventory is sufficient for building a specific quantity of a part
   * @param partId - ID of the part to check
   * @param quantity - Quantity to build
   */
  static async checkInventorySufficiency(
    organizationId: string,
    partId: string,
    quantity: number = 1
  ) {
    const requirements = await this.calculateRequiredQuantities(organizationId, partId, quantity)

    // Filter to parts with shortage
    const shortages = requirements.filter((req) => req.shortage > 0)

    return { canBuild: shortages.length === 0, shortages, requirements }
  }

  /**
   * Update inventory based on building a part (decrease subpart quantities)
   * @param partId - ID of the part being built
   * @param quantity - Quantity of the part being built
   */
  static async buildPart(organizationId: string, partId: string, quantity: number = 1) {
    // First check if we can build it
    const inventoryCheck = await this.checkInventorySufficiency(organizationId, partId, quantity)

    if (!inventoryCheck.canBuild) {
      throw new Error('Insufficient inventory to build this part')
    }

    // Start a transaction to update all inventory levels (Drizzle)
    return db.transaction(async (tx) => {
      // Decrease inventory for all subparts
      for (const requirement of inventoryCheck.requirements) {
        const { partId: subPartId, availableQuantity, requiredQuantity } = requirement

        const newQuantity = availableQuantity - requiredQuantity

        // Update inventory or insert if missing
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

      // Increase inventory for the built part
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
   * Get all parts where a specific part is used as a subpart
   * @param partId - ID of the part to check usage
   */
  static async getPartUsage(organizationId: string, partId: string) {
    const usages = await db
      .select({
        sub: schema.Subpart,
        parent: {
          id: schema.Part.id,
          title: schema.Part.title,
          description: schema.Part.description,
          sku: schema.Part.sku,
          hsCode: schema.Part.hsCode,
          category: schema.Part.category,
        },
      })
      .from(schema.Subpart)
      .innerJoin(schema.Part, eq(schema.Subpart.parentPartId, schema.Part.id))
      .where(
        and(
          eq(schema.Subpart.organizationId, organizationId),
          eq(schema.Subpart.childPartId, partId)
        )
      )

    return usages
  }

  /**
   * Calculate cost of a part based on vendor prices or subpart costs
   * @param partId - ID of the part to calculate cost for
   * @param usePreferredVendorsOnly - Whether to only use preferred vendors for pricing
   */
  static async calculatePartCost(
    organizationId: string,
    partId: string,
    usePreferredVendorsOnly: boolean = false
  ): Promise<PartCost> {
    // Validate part exists
    const [p] = await db
      .select({ id: schema.Part.id })
      .from(schema.Part)
      .where(and(eq(schema.Part.organizationId, organizationId), eq(schema.Part.id, partId)))
      .limit(1)
    if (!p) throw new Error(`Part with ID ${partId} not found`)

    // Fetch vendor pricing rows using relational query (optional preferred-only)
    const vpRows = await db.query.VendorPart.findMany({
      where: (vendorParts, { eq, and }) =>
        and(
          eq(vendorParts.organizationId, organizationId),
          eq(vendorParts.partId, partId),
          ...(usePreferredVendorsOnly ? [eq(vendorParts.isPreferred, true)] : [])
        ),
      with: {
        contact: {
          columns: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      columns: {
        id: true,
        unitPrice: true,
        contactId: true,
        isPreferred: true,
      },
      orderBy: (vendorParts, { asc }) => [asc(vendorParts.unitPrice)],
    })

    // Use lowest vendor price if present
    const priced = vpRows.filter((r) => r.unitPrice !== null && r.unitPrice !== undefined)
    if (priced.length > 0) {
      const best = priced[0]
      return {
        partId,
        cost: best.unitPrice as number,
        contactId: best.contactId,
        contact: best.contact,
        isComposite: false,
      }
    }

    // Fetch subparts for composite cost
    const subRows = await db
      .select({
        childPartId: schema.Subpart.childPartId,
        quantity: schema.Subpart.quantity,
        child: {
          id: schema.Part.id,
          title: schema.Part.title,
        },
      })
      .from(schema.Subpart)
      .innerJoin(schema.Part, eq(schema.Subpart.childPartId, schema.Part.id))
      .where(
        and(
          eq(schema.Subpart.organizationId, organizationId),
          eq(schema.Subpart.parentPartId, partId)
        )
      )

    if (subRows.length > 0) {
      let totalCost = 0
      const subpartCosts: NonNullable<PartCost['subpartCosts']> = []

      for (const s of subRows) {
        const subCost = await this.calculatePartCost(
          organizationId,
          s.childPartId,
          usePreferredVendorsOnly
        )
        const cost = (subCost.cost as number) * (s.quantity as number)
        totalCost += cost
        subpartCosts.push({
          subpartId: s.childPartId,
          subpart: { id: s.child.id, title: s.child.title },
          quantity: s.quantity as number,
          unitCost: subCost.cost as number,
          totalCost: cost,
        })
      }

      return { partId, cost: totalCost, isComposite: true, subpartCosts }
    }

    // No pricing available and no subparts
    return { partId, cost: 0, isComposite: false, noPricing: true }
  }
}
