// packages/lib/src/field-hooks/register-hooks.ts

import { recalculatePartCost, recalculatePartCostOnEntityChange } from './post/bom-cost-triggers'
import { explodeBomMovement } from './post/bom-movement-triggers'
import { enrichCompanyOnCreate } from './post/company-triggers'
import { recalculatePartQoH, recalculateStockStatus } from './post/inventory-triggers'
import { publishFieldChangeEvent } from './post/publish-field-change-event'
import { clearOtherPreferred } from './post/vendor-part-triggers'
import {
  dropUnauthorizedSystemFlag,
  rejectDeleteIfSystemTag,
  rejectIfSystemTag,
} from './pre/tag-system-guard'
import {
  registerEntityFieldChangeHooks,
  registerEntityPreDeleteHooks,
  registerEntityTriggers,
  registerFieldPreHooks,
  registerFieldTriggers,
} from './registry'

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

  // Field-change post-hook — fires `<prefix>:field:updated` after every field
  // write. Registered globally so contacts, tickets, companies, and custom
  // entities all produce timeline entries.
  registerEntityFieldChangeHooks('*', [publishFieldChangeEvent])

  // ---------------------------------------------------------------------------
  // PRE-WRITE HOOKS
  // ---------------------------------------------------------------------------

  // System tag guard — makes seeded tags read-only for end users.
  // - is_system_tag: drop any write that isn't bypassed by the seeder.
  // - title / description / emoji / color / parent: reject edits when the
  //   record's is_system_tag is true.
  // - pre-delete: reject deletes of system tags.
  registerFieldPreHooks('tags', 'is_system_tag', [dropUnauthorizedSystemFlag])
  registerFieldPreHooks('tags', 'title', [rejectIfSystemTag])
  registerFieldPreHooks('tags', 'tag_description', [rejectIfSystemTag])
  registerFieldPreHooks('tags', 'tag_emoji', [rejectIfSystemTag])
  registerFieldPreHooks('tags', 'tag_color', [rejectIfSystemTag])
  registerFieldPreHooks('tags', 'tag_parent', [rejectIfSystemTag])
  registerEntityPreDeleteHooks('tags', [rejectDeleteIfSystemTag])
}
