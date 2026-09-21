// packages/lib/src/accounting/sales/fulfillments/fields.ts

/**
 * The def-and-field contexts every fulfillment read and write resolves before
 * it touches a row, picked from the registry rather than re-typed here.
 *
 * Two contexts, not one: `fulfillment` and `fulfillment_line` are separate defs
 * and `readSystemRecords` is scoped to one def at a time.
 *
 * No permission checks here or anywhere else in this module - the router
 * asserts and hands the narrowed input down (`docs/lib-module-guide.md` §6).
 */

import type { Database, Transaction } from '@auxx/database'
import { UnprocessableEntityError } from '../../../errors'
import { FULFILLMENT_FIELDS } from '../../../resources/registry/resources/fulfillment-fields'
import { FULFILLMENT_LINE_FIELDS } from '../../../resources/registry/resources/fulfillment-line-fields'
import { pickSystemAttributes } from '../../../resources/registry/system-attributes'
import { type SystemFieldContext, systemFields } from '../../../resources/system-records'

/**
 * Every `fulfillment` attribute this module reads or writes.
 *
 * `fulfillment_lines` (the has_many INVERSE) is deliberately absent: the
 * inverse side carries no `FieldValue` rows of its own, and picking it would
 * fetch one row per line per fulfillment for nothing.
 */
export const FULFILLMENT_ATTRIBUTES = pickSystemAttributes(FULFILLMENT_FIELDS, [
  'fulfillment_order',
  'fulfillment_sequence',
  'fulfillment_shipped_at',
  'fulfillment_status',
  'fulfillment_cancelled_at',
  'fulfillment_name',
  'fulfillment_tracking_number',
  'fulfillment_tracking_company',
  'fulfillment_tracking_url',
  'fulfillment_subtotal',
  'fulfillment_total',
  'fulfillment_shipping_recognised',
  'fulfillment_recorded_at',
] as const)

export type FulfillmentAttribute = (typeof FULFILLMENT_ATTRIBUTES)[number]

/** Every `fulfillment_line` attribute this module reads or writes; `fulfillment_line_stock_movements` is an inverse and is not one. */
export const FULFILLMENT_LINE_ATTRIBUTES = pickSystemAttributes(FULFILLMENT_LINE_FIELDS, [
  'fulfillment_line_fulfillment',
  'fulfillment_line_line_item',
  'fulfillment_line_quantity',
  'fulfillment_line_quantity_relieved',
] as const)

export type FulfillmentLineAttribute = (typeof FULFILLMENT_LINE_ATTRIBUTES)[number]

/** The resolved defs and fields every fulfillment read or write needs. */
export interface FulfillmentFieldContext {
  fulfillment: SystemFieldContext<FulfillmentAttribute>
  line: SystemFieldContext<FulfillmentLineAttribute>
}

/**
 * Resolve the `fulfillment` / `fulfillment_line` defs and their fields, or
 * `null` when the org has not run entity migration 153 yet.
 *
 * `null` rather than a throw so a read surface on an unmigrated org degrades
 * to "nothing shipped" instead of 500ing. The WRITE path calls
 * {@link requireFulfillmentFieldContext} instead.
 */
export async function loadFulfillmentFieldContext(
  db: Database | Transaction | undefined,
  organizationId: string
): Promise<FulfillmentFieldContext | null> {
  // Without the order edge or the line edge there is nothing to join on - both
  // reduce every read here to guessing.
  const [fulfillment, line] = await Promise.all([
    systemFields(db, organizationId, 'fulfillment', FULFILLMENT_ATTRIBUTES, {
      required: ['fulfillment_order'],
    }),
    systemFields(db, organizationId, 'fulfillment_line', FULFILLMENT_LINE_ATTRIBUTES, {
      required: ['fulfillment_line_fulfillment'],
    }),
  ])
  return fulfillment && line ? { fulfillment, line } : null
}

/** {@link loadFulfillmentFieldContext}, as the refusal a write path needs. */
export async function requireFulfillmentFieldContext(
  db: Database | Transaction | undefined,
  organizationId: string
): Promise<FulfillmentFieldContext> {
  const ctx = await loadFulfillmentFieldContext(db, organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Fulfilling an order is not available until the fulfillment entities are provisioned ' +
        '(entity migration 153). Without them a shipment has nowhere to be recorded.'
    )
  }
  return ctx
}
