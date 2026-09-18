// packages/lib/src/returns/fields.ts

/**
 * The def-and-field contexts every returns read and write resolves before it
 * touches a row, picked from the registry rather than re-typed here.
 *
 * The loaders return null when the org is short of the entity migration that
 * provisions the def OR of the fields without which the surface is a constant —
 * a LIST on such an org renders empty rather than 500 — and the `require*`
 * variants refuse instead, because a write that silently did nothing would be
 * worse.
 *
 * No permission checks here or anywhere else in this module: the router asserts
 * (`docs/lib-module-guide.md` section 6).
 */

import type { Database, Transaction } from '@auxx/database'
import { UnprocessableEntityError } from '../errors'
import { RETURN_FIELDS } from '../resources/registry/resources/return-fields'
import { RETURN_LINE_FIELDS } from '../resources/registry/resources/return-line-fields'
import { RETURN_PART_LINE_FIELDS } from '../resources/registry/resources/return-part-line-fields'
import { pickSystemAttributes } from '../resources/registry/system-attributes'
import { type SystemFieldContext, systemDefId, systemFields } from '../resources/system-records'

/** Every `return` attribute the reads and writes in this module touch. */
export const RETURN_ATTRIBUTES = pickSystemAttributes(RETURN_FIELDS, [
  'return_number',
  'return_status',
  'return_origin',
  'return_reason',
  'return_customer_note',
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
] as const)

export type ReturnAttribute = (typeof RETURN_ATTRIBUTES)[number]
export type ReturnFieldContext = SystemFieldContext<ReturnAttribute>

/** Every `return_line` attribute the reads and writes in this module touch. */
export const RETURN_LINE_ATTRIBUTES = pickSystemAttributes(RETURN_LINE_FIELDS, [
  'return_line_return',
  'return_line_line_item',
  'return_line_part',
  'return_line_quantity',
  'return_line_condition_grade',
  'return_line_liability',
  'return_line_inspection_notes',
  'return_line_inspected_by',
  'return_line_inspected_at',
] as const)

export type ReturnLineAttribute = (typeof RETURN_LINE_ATTRIBUTES)[number]
export type ReturnLineFieldContext = SystemFieldContext<ReturnLineAttribute>

/**
 * Every `return_part_line` attribute this module touches.
 *
 * 🛑 `return_part_line_unit_cost` and `return_part_line_movement` are read but
 * never written here: they are the salvage writer's output (plan section 6.3,
 * step 7).
 */
export const RETURN_PART_LINE_ATTRIBUTES = pickSystemAttributes(RETURN_PART_LINE_FIELDS, [
  'return_part_line_return_line',
  'return_part_line_parent',
  'return_part_line_part',
  'return_part_line_quantity',
  'return_part_line_status',
  'return_part_line_salvage_percent',
  'return_part_line_unit_cost',
  'return_part_line_sort_order',
  'return_part_line_movement',
] as const)

export type ReturnPartLineAttribute = (typeof RETURN_PART_LINE_ATTRIBUTES)[number]
export type ReturnPartLineFieldContext = SystemFieldContext<ReturnPartLineAttribute>

type ReadDb = Database | Transaction | undefined

/**
 * The `return` context, or null when the org has no returns yet.
 *
 * `return_status` is required: without it there is no lifecycle, and every
 * saved view and risk badge in plan section 3.3 reduces to a constant.
 */
export async function loadReturnFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<ReturnFieldContext | null> {
  const ctx = await systemFields(db, organizationId, 'return', RETURN_ATTRIBUTES)
  if (!ctx?.fields.return_status) return null
  return ctx
}

/** {@link loadReturnFieldContext}, as the refusal a write path needs. */
export async function requireReturnFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<ReturnFieldContext> {
  const ctx = await loadReturnFieldContext(db, organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Returns are not available until the return entity and its fields are provisioned'
    )
  }
  return ctx
}

/**
 * The `return_line` context, or null when the org has none.
 *
 * `return_line_return` and `return_line_part` are required: a line that cannot
 * name its return is an orphan, and one that cannot name its part has no BOM
 * root, which is the whole of the salvage tree.
 */
export async function loadReturnLineFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<ReturnLineFieldContext | null> {
  const ctx = await systemFields(db, organizationId, 'return_line', RETURN_LINE_ATTRIBUTES)
  if (!ctx?.fields.return_line_return || !ctx.fields.return_line_part) return null
  return ctx
}

/** {@link loadReturnLineFieldContext}, as the refusal a write path needs. */
export async function requireReturnLineFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<ReturnLineFieldContext> {
  const ctx = await loadReturnLineFieldContext(db, organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Return lines are not available until the return line entity and its fields are provisioned'
    )
  }
  return ctx
}

/**
 * The `return_part_line` context, or null when the org has none.
 *
 * The three the tree cannot be assembled without are required: the owning line,
 * the part, and the status the warehouse sets.
 */
export async function loadReturnPartLineFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<ReturnPartLineFieldContext | null> {
  const ctx = await systemFields(
    db,
    organizationId,
    'return_part_line',
    RETURN_PART_LINE_ATTRIBUTES
  )
  if (
    !ctx?.fields.return_part_line_return_line ||
    !ctx.fields.return_part_line_part ||
    !ctx.fields.return_part_line_status
  ) {
    return null
  }
  return ctx
}

/** {@link loadReturnPartLineFieldContext}, as the refusal a write path needs. */
export async function requireReturnPartLineFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<ReturnPartLineFieldContext> {
  const ctx = await loadReturnPartLineFieldContext(db, organizationId)
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
  db: ReadDb,
  organizationId: string,
  entityType: string
): Promise<string> {
  const defId = await systemDefId(db, organizationId, entityType)
  if (!defId) {
    throw new UnprocessableEntityError(
      `This organization has no ${entityType} entity definition yet`
    )
  }
  return defId
}
