// packages/lib/src/field-triggers/register-triggers.ts

import { registerEntityTriggers, registerFieldTriggers } from './registry'
import {
  recalculatePartCost,
  recalculatePartCostOnEntityChange,
} from './triggers/bom-cost-triggers'
import { clearOtherPreferred } from './triggers/vendor-part-triggers'

/**
 * Register all field and entity triggers.
 * Called once at startup (e.g., from the worker entry point).
 */
export function registerAllTriggers(): void {
  // BOM cost field triggers — fire when specific field values change
  registerFieldTriggers('vendor_part_unit_price', [recalculatePartCost])
  registerFieldTriggers('vendor_part_is_preferred', [recalculatePartCost, clearOtherPreferred])
  registerFieldTriggers('subpart_quantity', [recalculatePartCost])

  // BOM cost entity triggers — fire when vendor_part or subpart entities are created/deleted
  registerEntityTriggers('vendor-parts', [recalculatePartCostOnEntityChange])
  registerEntityTriggers('subparts', [recalculatePartCostOnEntityChange])
}
