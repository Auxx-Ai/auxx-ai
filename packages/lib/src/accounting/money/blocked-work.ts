// packages/lib/src/accounting/money/blocked-work.ts

/**
 * The Outbox's Blocked tab as one list: every movement the ledger refused and
 * every shipment its poster refused, newest refusal first (88 §4.5). Two reads
 * with their own paging, merged here, so a person sees both halves of an
 * order's refusals in one place.
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import type { Database } from '@auxx/database'
import type { ExportAvenue } from '../ledger/setup/export-settings'
import {
  type BlockedFulfillmentRow,
  countBlockedFulfillments,
  listBlockedFulfillments,
} from '../sales/fulfillments/posting-reads'
import {
  type BlockedMovementRow,
  countBlockedMovements,
  listBlockedMovements,
  type MovementPurpose,
} from './blocked-movements'

export type BlockedWorkRow =
  | ({ kind: 'movement' } & BlockedMovementRow)
  | ({ kind: 'shipment' } & BlockedFulfillmentRow)

/** The avenue each blocked kind would post under - the Outbox's one category vocabulary. */
const BLOCKED_AVENUE: Record<MovementPurpose | 'shipment', ExportAvenue> = {
  customer_receipt: 'receipt',
  customer_refund: 'refund',
  vendor_payment: 'vendorPayment',
  vendor_refund: 'vendorPayment',
  shipment: 'fulfillment',
}

/** Where each of the two reads resumes. Both offsets, because one page mixes them. */
export interface BlockedWorkCursor {
  movement: number
  shipment: number
}

function refusedAt(row: BlockedWorkRow): number {
  return row.blockedAt ? row.blockedAt.getTime() : Number.NEGATIVE_INFINITY
}

/**
 * One page of parked work. Reads a page from each source, merges by refusal
 * time, and returns where each read left off; a page is full when `limit` rows
 * are taken, and there is a next page while either read may hold more.
 */
export async function listBlockedWork(
  db: Database,
  organizationId: string,
  options: {
    limit: number
    cursor?: BlockedWorkCursor
    categories?: ExportAvenue[]
    search?: string
    from?: string
    to?: string
    bookTimeZone?: string
  }
): Promise<{ items: BlockedWorkRow[]; nextCursor?: BlockedWorkCursor }> {
  const { limit, categories } = options
  const cursor = options.cursor ?? { movement: 0, shipment: 0 }
  const purposes = (Object.keys(BLOCKED_AVENUE) as Array<MovementPurpose | 'shipment'>).filter(
    (kind): kind is MovementPurpose =>
      kind !== 'shipment' && !!categories?.includes(BLOCKED_AVENUE[kind])
  )
  const wantMovements = !categories?.length || purposes.length > 0
  const wantShipments = !categories?.length || categories.includes(BLOCKED_AVENUE.shipment)

  const [movements, shipments] = await Promise.all([
    wantMovements
      ? listBlockedMovements(db, organizationId, {
          limit,
          offset: cursor.movement,
          categories: purposes.length ? purposes : undefined,
          search: options.search,
          from: options.from,
          to: options.to,
        })
      : [],
    wantShipments
      ? listBlockedFulfillments(db, organizationId, {
          limit,
          offset: cursor.shipment,
          search: options.search,
          from: options.from,
          to: options.to,
          bookTimeZone: options.bookTimeZone,
        })
      : [],
  ])

  const items: BlockedWorkRow[] = []
  let m = 0
  let s = 0
  while (items.length < limit && (m < movements.length || s < shipments.length)) {
    const movement = movements[m]
    const shipment = shipments[s]
    const nextMovement: BlockedWorkRow | null = movement ? { kind: 'movement', ...movement } : null
    const nextShipment: BlockedWorkRow | null = shipment ? { kind: 'shipment', ...shipment } : null
    if (nextMovement && (!nextShipment || refusedAt(nextMovement) >= refusedAt(nextShipment))) {
      items.push(nextMovement)
      m++
    } else if (nextShipment) {
      items.push(nextShipment)
      s++
    }
  }
  const more =
    m < movements.length ||
    s < shipments.length ||
    movements.length === limit ||
    shipments.length === limit
  return {
    items,
    ...(more
      ? { nextCursor: { movement: cursor.movement + m, shipment: cursor.shipment + s } }
      : {}),
  }
}

/** The tab's badge: both halves, counted in SQL. */
export async function countBlockedWork(db: Database, organizationId: string): Promise<number> {
  const [movements, shipments] = await Promise.all([
    countBlockedMovements(db, organizationId),
    countBlockedFulfillments(db, organizationId),
  ])
  return movements + shipments
}
