// packages/lib/src/data-connectors/inventory-bridge-rule-consts.ts
// Leaf constants shared by the managed inventory rule (`inventory-bridge-rule.ts`) and its
// native action (`inventory-bridge-rule-action.ts`). Kept dependency-free so the field-hooks
// bootstrap can register the action without dragging in the provisioning/services import chain.

/** Stable systemAttribute for the source→part edge (idempotent re-provision key). */
export const INVENTORY_BRIDGE_EDGE_ATTR = 'inventory_bridge_part'
/** The `RecordRule.managed` marker value the inventory feature owns. */
export const INVENTORY_MANAGED_MARKER = 'inventory' as const
/** Native-handler key for the deduction action (registered from `registerAllHooks`). */
export const DEDUCT_INVENTORY_HANDLER = 'deductInventory'
/** Fixed name for the managed rule row (shown, locked, in settings/rules). */
export const INVENTORY_RULE_NAME = 'Deduct linked part inventory on source decrease'
