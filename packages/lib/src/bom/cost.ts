// src/lib/cost-utils.ts

import { database as db, schema } from '@auxx/database'
import { eq, and, not, asc, isNotNull } from 'drizzle-orm'

/**
 * Get the cost of a part from its preferred vendor
 * @param partId The ID of the part
 * @returns The cost from the preferred vendor or null if not available
 */
async function getPreferredVendorCost(partId: string): Promise<number | null> {
  const [vendorPart] = await db.select()
    .from(schema.VendorPart)
    .where(and(
      eq(schema.VendorPart.partId, partId),
      eq(schema.VendorPart.isPreferred, true),
      isNotNull(schema.VendorPart.unitPrice)
    ))
    .orderBy(asc(schema.VendorPart.unitPrice)) // In case there are multiple preferred vendors, take the lowest price
    .limit(1)

  if (!vendorPart || !vendorPart.unitPrice) {
    // If no preferred vendor, take the lowest price from any vendor
    const [anyVendorPart] = await db.select()
      .from(schema.VendorPart)
      .where(and(
        eq(schema.VendorPart.partId, partId),
        isNotNull(schema.VendorPart.unitPrice)
      ))
      .orderBy(asc(schema.VendorPart.unitPrice))
      .limit(1)

    return anyVendorPart?.unitPrice || null
  }

  return vendorPart.unitPrice
}

/**
 * Calculate the total cost of a part including all subparts
 * @param partId The ID of the part
 * @returns The calculated total cost
 */
async function calculatePartCost(partId: string): Promise<number> {
  // Get vendor cost for this part
  const vendorCost = await getPreferredVendorCost(partId)

  // Get all subparts with their quantities
  const subparts = await db.select({
    subpart: schema.Subpart,
    childPart: schema.Part
  })
  .from(schema.Subpart)
  .leftJoin(schema.Part, eq(schema.Part.id, schema.Subpart.childPartId))
  .where(eq(schema.Subpart.parentPartId, partId))

  // If no subparts and no vendor cost, return zero
  if (subparts.length === 0 && !vendorCost) {
    return 0
  }

  // If no subparts but has vendor cost, return vendor cost
  if (subparts.length === 0) {
    return vendorCost as number
  }

  // Calculate cost from subparts
  let subpartsCost = 0

  for (const record of subparts) {
    const subpart = record.subpart
    const childPart = record.childPart

    // Check if subpart has cached cost, otherwise calculate it
    let subpartCost: number

    if (childPart?.cost) {
      subpartCost = childPart.cost
    } else {
      // Recursively calculate subpart cost
      subpartCost = await calculatePartCost(subpart.childPartId)

      // Update subpart's cached cost
      await db.update(schema.Part)
        .set({ cost: subpartCost })
        .where(eq(schema.Part.id, subpart.childPartId))
    }

    // Add to total cost (quantity * subpart cost)
    subpartsCost = subpartsCost + subpartCost * subpart.quantity
  }

  // If vendor cost exists, use it, otherwise use calculated subparts cost
  return vendorCost || subpartsCost
}

/**
 * Update the cached cost for a part and propagate changes up the BOM tree
 * @param partId The ID of the part to update
 */
export async function updatePartCostAndPropagate(
  organizationId: string,
  partId: string
): Promise<void> {
  // Calculate current cost
  const calculatedCost = await calculatePartCost(partId)

  // Update the part with the calculated cost
  await db.update(schema.Part)
    .set({ cost: calculatedCost })
    .where(and(
      eq(schema.Part.id, partId),
      eq(schema.Part.organizationId, organizationId)
    ))

  // Find all parent parts that use this part as a subpart
  const parentParts = await db.select({ parentPartId: schema.Subpart.parentPartId })
    .from(schema.Subpart)
    .where(eq(schema.Subpart.childPartId, partId))

  // Recursively update all parent parts
  for (const parent of parentParts) {
    await updatePartCostAndPropagate(organizationId, parent.parentPartId)
  }
}
