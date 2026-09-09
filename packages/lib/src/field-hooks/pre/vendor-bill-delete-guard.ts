// packages/lib/src/field-hooks/pre/vendor-bill-delete-guard.ts

import { database, schema } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { BadRequestError } from '../../errors'
import { settledPeriodsFor } from '../../postings/settled-periods'
import { unwrapStatusValue } from '../../resources/events/captured-values'
import { VendorBillStatus } from '../../resources/registry/enum-values'
import type { EntityPreDeleteEvent, EntityPreDeleteHandler } from '../types'

/**
 * The bill statuses that mean the document is already in the books or already
 * part-settled with the vendor.
 *
 * `posted` is usually implied by the period predicates below, but not always. A
 * bill can be marked posted before its month closes, so it is checked
 * explicitly rather than reasoned about.
 */
const SETTLED_BILL_STATUSES: ReadonlySet<string> = new Set([
  VendorBillStatus.POSTED,
  VendorBillStatus.PARTIALLY_PAID,
  VendorBillStatus.PAID,
])

/**
 * Pre-delete guard for `vendor-bills`
 * (plans/money/tasks/21-money-parent-delete-safety.md §5). Fires inside
 * `deleteEntity` for EVERY delete path, because `vendor-bills` is
 * `isVisible: true` and has carried an ordinary row delete and bulk delete since
 * the day it shipped.
 *
 * **The shape difference from the other money guards: a bill has no movements
 * of its own.** Its accounting date is its own field, `vendor_bill_billed_at`,
 * whose description states outright that it is *"the ACCOUNTING date"* and that
 * `createdAt` "is routinely a different period". So the settled test runs on one
 * date rather than over a set of children.
 *
 * Two refusals, both conditional on state the registry cannot see:
 *
 *   1. **REFUSE on status**: `posted`, `partially_paid`, `paid`.
 *   2. **REFUSE when the bill date's period is settled.**
 *
 * **What is NOT here, and why.**
 *
 *   - "A vendor payment has been applied to this bill" is `onDelete: 'restrict'`
 *     on `vendor_bill_payment_allocations`. The delete engine refuses it from the
 *     declaration, archived allocations included: money that has been applied
 *     stays applied whether or not somebody archived the row recording it.
 *   - The lines are `onDelete: 'cascade'` on `vendor_bill_lines`. The engine
 *     collects them into the closure and runs this guard before writing
 *     anything. This hook used to delete them by hand with post-delete hooks
 *     suppressed, because `rematchAfterBillLineDelete` re-projects the bill
 *     being deleted; that suppression is the engine's concern now.
 */
export const guardVendorBillDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, recordId } = event
  const { entityInstanceId: billInstanceId } = parseRecordId(recordId)

  // The cheap check first: it reads nothing.
  refuseOnStatus(event)

  const billedAt = await resolveAccountingDate(organizationId, billInstanceId, event)
  const settled = await settledPeriodsFor(organizationId, [billedAt])
  if (settled.size > 0) {
    throw new BadRequestError(
      `This vendor bill is dated in ${[...settled.keys()].join(', ')}, which has been ` +
        'closed or posted. A posted period is corrected by reversing an entry, never by ' +
        'deleting its history. Archive the bill instead.',
      { organizationId, recordId, periods: [...settled.keys()] }
    )
  }
}

/** The status wall, read off the values `deleteEntity` already captured. */
function refuseOnStatus(event: EntityPreDeleteEvent): void {
  const status = unwrapStatus(event.values.vendor_bill_status)
  if (status !== null && SETTLED_BILL_STATUSES.has(status)) {
    throw new BadRequestError(
      `This vendor bill is ${status.replace(/_/g, ' ')}. A bill that is in the books or ` +
        'part-paid is corrected by reversing it, never by deleting it. Archive it instead.',
      { organizationId: event.organizationId, recordId: event.recordId, status }
    )
  }
}

/**
 * A captured SINGLE_SELECT value, reduced to its option id.
 *
 * Delegates to the shared `unwrapStatusValue` rather than carrying a private
 * copy of its body: the three chains and the shapes each one produces are
 * documented once, on `resources/events/captured-values.ts`.
 */
function unwrapStatus(value: unknown): string | null {
  const unwrapped = unwrapStatusValue(value)
  return typeof unwrapped === 'string' && unwrapped.length > 0 ? unwrapped : null
}

/**
 * The bill's accounting date: `billedAt` when set, otherwise the row's
 * `createdAt`.
 *
 * **The fallback matters and must not be "unset means open".** `billedAt` is
 * nullable, and reading a missing one as "no period" would make an
 * un-transcribed bill the easiest one to delete, while `createdAt` is exactly
 * what the field's own description warns is "routinely a different period", so
 * it is a fallback and never the primary. This mirrors the movement read's
 * `occurredAt`-coalesced-onto-`createdAt` rule rather than inventing a second
 * convention.
 */
async function resolveAccountingDate(
  organizationId: string,
  billInstanceId: string,
  event: EntityPreDeleteEvent
): Promise<Date> {
  const billedAt = event.values.vendor_bill_billed_at
  if (typeof billedAt === 'string' || billedAt instanceof Date) {
    const parsed = new Date(billedAt)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }

  const [row] = await database
    .select({ createdAt: schema.EntityInstance.createdAt })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, billInstanceId),
        eq(schema.EntityInstance.organizationId, organizationId)
      )
    )

  return row?.createdAt ?? new Date()
}
