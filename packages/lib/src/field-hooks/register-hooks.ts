// packages/lib/src/field-hooks/register-hooks.ts

import { recalculatePartCost, recalculatePartCostOnEntityChange } from './post/bom-cost-triggers'
import { explodeBomMovement } from './post/bom-movement-triggers'
import { enrichCompanyOnCreate } from './post/company-triggers'
import { recalculatePartQoH, recalculateStockStatus } from './post/inventory-triggers'
import { clearOtherPreferred } from './post/vendor-part-triggers'
import { registerEntityTriggers, registerFieldTriggers } from './registry'

/**
 * Register all field and entity hooks (pre + post).
 * Called once at startup (e.g., from the worker entry point).
 */
export function registerAllHooks(): void {
  // ---------------------------------------------------------------------------
  // POST-WRITE TRIGGERS
  // ---------------------------------------------------------------------------

  // BOM cost field triggers — fire when specific field values change
  registerFieldTriggers('vendor_part_unit_price', [recalculatePartCost])
  registerFieldTriggers('vendor_part_shipping_cost', [recalculatePartCost])
  registerFieldTriggers('vendor_part_tariff_rate', [recalculatePartCost])
  registerFieldTriggers('vendor_part_other_cost', [recalculatePartCost])
  registerFieldTriggers('vendor_part_is_preferred', [recalculatePartCost, clearOtherPreferred])
  registerFieldTriggers('subpart_quantity', [recalculatePartCost])

  // BOM cost entity triggers — fire when vendor_part or subpart entities are created/deleted
  registerEntityTriggers('vendor-parts', [recalculatePartCostOnEntityChange])
  registerEntityTriggers('subparts', [recalculatePartCostOnEntityChange])

  // Inventory triggers — fire when stock movements are created/deleted
  // explodeBomMovement must run BEFORE recalculatePartQoH so child movements
  // exist before the parent's QoH is recalculated
  registerEntityTriggers('stock-movements', [explodeBomMovement, recalculatePartQoH])

  // Stock status trigger — fire when reorder point changes
  registerFieldTriggers('part_reorder_point', [recalculateStockStatus])

  // Company enrichment — fetch website on company create to fill in name, notes, logo
  registerEntityTriggers('companies', [enrichCompanyOnCreate])

  // ---------------------------------------------------------------------------
  // PRE-WRITE HOOKS
  // ---------------------------------------------------------------------------
  //
  // Per-field pre-hooks (registerFieldPreHooks) and pre-delete hooks
  // (registerEntityPreDeleteHooks) are added by feature modules in this
  // section as they come online. The system-tag guard is the first
  // expected consumer.
}
