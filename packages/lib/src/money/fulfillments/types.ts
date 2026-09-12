// packages/lib/src/money/fulfillments/types.ts

/**
 * The contract this module is written against
 * (`plans/money/tasks/55-shipment-lines.md`, entity migration 153).
 *
 * `fulfillment` / `fulfillment_line` are real `EntityInstance` records now, not
 * a JSON cell on `order`. This file holds the shapes only, no logic:
 *
 * - `reads.ts` resolves the field context and reads records, one query per
 *   hop regardless of how many orders are asked for,
 * - `writes.ts` creates, stamps and deletes them,
 * - `client.ts` re-exports the record shapes and the pure functions over them,
 * - `money/orders/` is the native door and the biggest consumer.
 *
 * Client-safe: types and constants only. No `@auxx/database` import - the same
 * split `money/credit-memo-posting/types.ts` uses and for the same reason.
 */

import type { RecordId } from '@auxx/types/resource'

/**
 * Shopify's own fulfillment lifecycle, verbatim
 * (`resources/registry/resources/fulfillment-fields.ts`, backed by
 * `resources/registry/enum-values.ts`'s `FulfillmentStatus`). Six values, not
 * five - `pending` is easy to drop and a dropped option is not loudly refused
 * (brief §3's warning on dangling `optionId`s).
 *
 * Defined here rather than imported from the registry so this module has no
 * dependency on `resources/registry/**` at runtime - the registry is a
 * different agent's surface in this build and the two must stay independently
 * buildable. Keep this list in sync with `FulfillmentStatus.values` by hand.
 */
export type FulfillmentStatusValue =
  | 'pending'
  | 'open'
  | 'success'
  | 'cancelled'
  | 'error'
  | 'failure'

export const FULFILLMENT_STATUSES: readonly FulfillmentStatusValue[] = [
  'pending',
  'open',
  'success',
  'cancelled',
  'error',
  'failure',
]

/**
 * One `(fulfillment, line_item)` tuple: units of ONE order line that went out
 * in ONE dispatch. The record form of what used to be one `OrderFulfillmentLine`
 * inside the JSON log.
 *
 * Carries no part, no date and no money - the part is reached through
 * `line_item_part`, the date through the parent {@link Fulfillment.shippedAt},
 * and the money never existed per line in the JSON log either.
 */
export interface FulfillmentLine {
  /** The `fulfillment_line` EntityInstance id. */
  id: string
  recordId: RecordId
  /** The `line_item` EntityInstance id this dispatch shipped against. */
  lineItemId: string
  /** Units of the line shipped in THIS dispatch only - never cumulative. */
  quantity: number
  /**
   * Re-SUMmed from `stock_movement_fulfillment_line` by task 50's post-hook,
   * never incremented in place. `null` until relief has run at all for this
   * line - not the same as zero, which means relief ran and relieved nothing.
   */
  quantityRelieved: number | null
}

/**
 * One dispatch, as the sales channel describes it. The record form of one
 * entry in the old `order_fulfillments` JSON array - revenue posts from these
 * now, not from a collapsed min/max/sum over them.
 *
 * Append-only in spirit, same as the JSON log was: a shipment that went out
 * wrongly is corrected by reversing its posting, not by editing this record
 * into agreeing with the ledger. Unlike the JSON log, a REFUSED shipment
 * (the ledger declined the entry) is deleted outright rather than never
 * having been appended - `money/orders/fulfill.ts`'s rollback.
 */
export interface Fulfillment {
  /** The `fulfillment` EntityInstance id. */
  id: string
  recordId: RecordId
  /** The `order` EntityInstance id this fulfillment shipped against. */
  orderId: string
  /** 1-based within the order, ship-date order. The poster's doc numbers key on it. */
  sequence: number
  /** ISO instant. Shopify's fulfillment `created_at` - THE accounting date, never `updated_at`. */
  shippedAt: string
  status: FulfillmentStatusValue
  /**
   * ISO instant, when a relief reversal is written on a cancelled fulfillment.
   * A PROXY, not a provider-supplied cancellation timestamp - see the field's
   * own docblock in the registry. `null` on everything the native door writes;
   * only the connector ever sets this.
   */
  cancelledAt: string | null
  /**
   * The display field. Never actually absent in practice - the connector
   * projects Shopify's own `name` and the native door synthesises one with
   * {@link module:client.defaultFulfillmentName} - but `null` in the type
   * because a row written before this field existed, or a channel that sent
   * nothing, would otherwise have to lie about it.
   */
  name: string | null
  trackingNumber: string | null
  trackingCompany: string | null
  trackingUrl: string | null
  /** Integer minor units. The goods amount this fulfillment recognised. */
  subtotalMinor: number
  /** Integer minor units. Subtotal plus the freight this fulfillment recognised. */
  totalMinor: number
  /**
   * Whether freight was recognised on THIS fulfillment. Freight is recognised
   * once, on the first dispatch of an order.
   */
  shippingRecognised: boolean
  /**
   * The `GlPosting.id` this fulfillment became, or `null` before it is
   * posted (or after a refused post rolled the whole record back). TEXT, not a
   * relationship - `GlPosting` is a Drizzle table with no `EntityDefinition`
   * to point at (the registry field's own docblock).
   */
  glPosting: string | null
  docNumber: string | null
  /** ISO instant. When auxx recorded this fulfillment - distinct from `shippedAt`. */
  recordedAt: string
  /** The per-line-item tuples this dispatch carried, in no particular guaranteed order. */
  lines: FulfillmentLine[]
}

/** One line of a new fulfillment. */
export interface CreateFulfillmentLineInput {
  /** The `line_item` EntityInstance id these units shipped against. */
  lineItemInstanceId: string
  /** Units of the line shipped in THIS dispatch. Must be > 0. */
  quantity: number
}

/**
 * Everything {@link module:writes.createFulfillment} needs. Every value the
 * caller controls is already resolved - no clock, no sequence lookup, no name
 * synthesis inside the writer, so it stays testable without a database beyond
 * the one write itself.
 */
export interface CreateFulfillmentInput {
  organizationId: string
  /** Who the write is attributed to. The `systemUser` for a connector-driven write. */
  actorUserId: string
  /** The `order` EntityInstance id this fulfillment shipped against. */
  orderInstanceId: string
  sequence: number
  /** ISO instant. The accounting date - see {@link Fulfillment.shippedAt}. */
  shippedAt: string
  status: FulfillmentStatusValue
  /** ISO instant. See {@link Fulfillment.cancelledAt}. Omit when not cancelled. */
  cancelledAt?: string
  /** The display field. Required - see {@link Fulfillment.name}'s "not optional" note. */
  name: string
  trackingNumber?: string
  trackingCompany?: string
  trackingUrl?: string
  subtotalMinor: number
  totalMinor: number
  shippingRecognised: boolean
  /** ISO instant. When this write is happening - the caller's clock, not the writer's. */
  recordedAt: string
  /** What shipped. At least one line. */
  lines: CreateFulfillmentLineInput[]
}

/** What {@link module:writes.createFulfillment} hands back. */
export interface CreatedFulfillment {
  fulfillmentInstanceId: string
  recordId: RecordId
  /** One id per input line, in the same order as {@link CreateFulfillmentInput.lines}. */
  lineInstanceIds: string[]
}

/**
 * What a posting may stamp onto a fulfillment record after the ledger accepts
 * it. Everything else on the row is history and stays exactly as it was
 * written.
 */
export interface FulfillmentPostingStamp {
  glPosting: string | null
  docNumber: string | null
  /**
   * The recognised total, when the posting that took this fulfillment computed
   * a different one from the row's own - the bulk poster's group builder
   * re-derives every shipment's amounts, and the record has to name what was
   * actually posted rather than what a single-order builder once thought.
   */
  totalMinor?: number
  subtotalMinor?: number
}
