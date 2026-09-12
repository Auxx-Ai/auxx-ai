// packages/lib/src/returns/field-context.ts

/**
 * The entity definition ids and `CustomField` ids every returns read and write
 * resolves before it touches a row.
 *
 * Shared by `reads.ts`, `salvage-reads.ts` and `writes.ts` rather than
 * duplicated into each: the three definitions are provisioned together by one
 * entity migration, and a reader that resolves them differently from the writer
 * is how "the field is there but nothing sees it" happens.
 *
 * Every attribute is optional in the resolved record on purpose. An
 * organization short of the entity migration that provisions `return` has no
 * fields at all, and a LIST on that org must render empty rather than 500 -
 * which is why the loaders return null and the `require*` variants, used by the
 * write paths, refuse instead. A write that silently did nothing would be worse
 * than a refusal.
 *
 * No permission checks here or anywhere else in this module: the router asserts
 * (`docs/lib-module-guide.md` section 6).
 */

import { getCachedEntityDefId, getOrgCache } from '../cache'
import { UnprocessableEntityError } from '../errors'

/** Every `return` attribute the reads and writes in this module touch. */
export const RETURN_ATTRIBUTES = [
  'return_number',
  'return_status',
  'return_origin',
  'return_reason',
  'return_contact',
  'return_order',
  'return_ticket',
  'return_requested_at',
  'return_received_at',
  'return_inspected_at',
  'return_closed_at',
  'return_sender_name_raw',
  'return_sender_address_raw',
  'return_inbound_carrier',
  'return_inbound_tracking',
  'return_label_provided',
  'return_label_cost',
  'return_goods_value',
  'return_credited_amount',
  'return_withheld_amount',
  'return_withheld_reason',
] as const

export type ReturnAttribute = (typeof RETURN_ATTRIBUTES)[number]

/** Every `return_line` attribute the reads and writes in this module touch. */
export const RETURN_LINE_ATTRIBUTES = [
  'return_line_return',
  'return_line_line_item',
  'return_line_part',
  'return_line_quantity',
  'return_line_customer_reason',
  'return_line_customer_note',
  'return_line_condition_grade',
  'return_line_liability',
  'return_line_inspection_notes',
  'return_line_inspected_by',
  'return_line_inspected_at',
] as const

export type ReturnLineAttribute = (typeof RETURN_LINE_ATTRIBUTES)[number]

/**
 * Every `return_part_line` attribute this module touches.
 *
 * 🛑 `return_part_line_unit_cost` and `return_part_line_movement` are read but
 * never written here. They are the salvage writer's output (plan section 6.3,
 * step 7), and that step is gated on a chain ending at task 50 - nothing in
 * this module moves inventory.
 */
export const RETURN_PART_LINE_ATTRIBUTES = [
  'return_part_line_return_line',
  'return_part_line_parent',
  'return_part_line_part',
  'return_part_line_quantity',
  'return_part_line_status',
  'return_part_line_salvage_percent',
  'return_part_line_unit_cost',
  'return_part_line_sort_order',
  'return_part_line_movement',
] as const

export type ReturnPartLineAttribute = (typeof RETURN_PART_LINE_ATTRIBUTES)[number]

/** A materialized `CustomField`, narrowed to the one property this module uses. */
type FieldRef = { id: string } | null

/** The `return` definition and its fields. */
export interface ReturnFieldContext {
  returnDefId: string
  fields: Record<ReturnAttribute, FieldRef>
}

/** The `return_line` definition and its fields. */
export interface ReturnLineFieldContext {
  returnLineDefId: string
  fields: Record<ReturnLineAttribute, FieldRef>
}

/** The `return_part_line` definition and its fields. */
export interface ReturnPartLineFieldContext {
  returnPartLineDefId: string
  fields: Record<ReturnPartLineAttribute, FieldRef>
}

/**
 * Resolve the `return` definition, or null when the org has no returns yet.
 *
 * `return_status` is required for a usable context: without it there is no
 * lifecycle, and every saved view and risk badge in plan section 3.3 reduces to
 * a constant.
 */
export async function loadReturnFieldContext(
  organizationId: string
): Promise<ReturnFieldContext | null> {
  const returnDefId = await getCachedEntityDefId(organizationId, 'return')
  if (!returnDefId) return null
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...RETURN_ATTRIBUTES])) as Record<ReturnAttribute, FieldRef>
  if (!fields.return_status) return null
  return { returnDefId, fields }
}

/** {@link loadReturnFieldContext}, as the refusal a write path needs. */
export async function requireReturnFieldContext(
  organizationId: string
): Promise<ReturnFieldContext> {
  const ctx = await loadReturnFieldContext(organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Returns are not available until the return entity and its fields are provisioned'
    )
  }
  return ctx
}

/**
 * Resolve the `return_line` definition, or null when the org has none.
 *
 * `return_line_return` and `return_line_part` are required: a line that cannot
 * name its return is an orphan, and one that cannot name its part has no BOM
 * root, which is the whole of the salvage tree.
 */
export async function loadReturnLineFieldContext(
  organizationId: string
): Promise<ReturnLineFieldContext | null> {
  const returnLineDefId = await getCachedEntityDefId(organizationId, 'return_line')
  if (!returnLineDefId) return null
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...RETURN_LINE_ATTRIBUTES])) as Record<ReturnLineAttribute, FieldRef>
  if (!fields.return_line_return || !fields.return_line_part) return null
  return { returnLineDefId, fields }
}

/** {@link loadReturnLineFieldContext}, as the refusal a write path needs. */
export async function requireReturnLineFieldContext(
  organizationId: string
): Promise<ReturnLineFieldContext> {
  const ctx = await loadReturnLineFieldContext(organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Return lines are not available until the return line entity and its fields are provisioned'
    )
  }
  return ctx
}

/**
 * Resolve the `return_part_line` definition, or null when the org has none.
 *
 * The three the tree cannot be assembled without are required: the owning line,
 * the part, and the status the warehouse sets.
 */
export async function loadReturnPartLineFieldContext(
  organizationId: string
): Promise<ReturnPartLineFieldContext | null> {
  const returnPartLineDefId = await getCachedEntityDefId(organizationId, 'return_part_line')
  if (!returnPartLineDefId) return null
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...RETURN_PART_LINE_ATTRIBUTES])) as Record<
    ReturnPartLineAttribute,
    FieldRef
  >
  if (
    !fields.return_part_line_return_line ||
    !fields.return_part_line_part ||
    !fields.return_part_line_status
  ) {
    return null
  }
  return { returnPartLineDefId, fields }
}

/** {@link loadReturnPartLineFieldContext}, as the refusal a write path needs. */
export async function requireReturnPartLineFieldContext(
  organizationId: string
): Promise<ReturnPartLineFieldContext> {
  const ctx = await loadReturnPartLineFieldContext(organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'The salvage tree is not available until the return part line entity and its fields are ' +
        'provisioned'
    )
  }
  return ctx
}

/**
 * Resolve a definition id the caller's input already committed us to.
 *
 * A 422 rather than the bare `Error` the cache helper throws: "you named an
 * order and this org has no orders" is something the UI can act on, not a 500.
 */
export async function requireReturnsDefId(
  organizationId: string,
  entityType: string
): Promise<string> {
  const defId = await getCachedEntityDefId(organizationId, entityType)
  if (!defId) {
    throw new UnprocessableEntityError(
      `This organization has no ${entityType} entity definition yet`
    )
  }
  return defId
}
