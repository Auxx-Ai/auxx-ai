// src/lib/cost-handlers.ts

import { updatePartCostAndPropagate } from './cost'

/**
 * Handler for when a VendorPart is created or updated
 * Updates cached costs for the affected part and its parents
 */
export async function handleVendorPartChange(
  organizationId: string,
  partId: string,
  oldPreferred: boolean | undefined,
  newPreferred: boolean
): Promise<void> {
  // If the preferred status changed or this is a new vendor part,
  // we need to update the part's cost
  if (oldPreferred !== newPreferred || oldPreferred === undefined) {
    await updatePartCostAndPropagate(organizationId, partId)
  }
}

/**
 * Handler for when a VendorPart is deleted
 * Updates cached costs for the affected part and its parents
 */
export async function handleVendorPartDelete(
  organizationId: string,
  partId: string
): Promise<void> {
  await updatePartCostAndPropagate(organizationId, partId)
}

/**
 * Handler for when a PartSubpart relationship is created, updated, or deleted
 * Updates cached costs for the parent part and its parents
 */
export async function handlePartSubpartChange(
  organizationId: string,
  parentPartId: string
): Promise<void> {
  await updatePartCostAndPropagate(organizationId, parentPartId)
}

/**
 * Handler for when a Part is deleted
 * Updates cached costs for any parts that used this as a subpart
 */
export async function handlePartDelete(
  organizationId: string,
  partId: string,
  parentPartIds: string[]
): Promise<void> {
  // Update all parent parts that used this part
  for (const parentId of parentPartIds) {
    await updatePartCostAndPropagate(organizationId, parentId)
  }
}
