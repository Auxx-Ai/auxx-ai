// packages/lib/src/field-hooks/pre/vendor-credit-delete-guard.ts

import { database, schema } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { settledPeriodsFor } from '../../accounting/ledger/periods/settled-periods'
import { BadRequestError } from '../../errors'
import { VENDOR_CREDIT_POSTED_STATUSES } from '../../purchasing/vendor-credit/client'
import { unwrapStatusValue } from '../../resources/events/captured-values'
import type { EntityPreDeleteEvent, EntityPreDeleteHandler } from '../types'

/**
 * Pre-delete guard for `vendor-credits` — the mirror of
 * `credit-memo-delete-guard.ts`, with the parties swapped (task 71 §5 U7).
 *
 * Three refusals, each conditional on state the registry cannot see:
 *
 *   1. **REFUSE on status** `issued` or `settled`: the credit has a posted
 *      entry. Void it first, which reverses the entry.
 *   2. **REFUSE when `issued_at` falls in a settled period**, whatever the
 *      status, so a voided credit dated in a closed month keeps its history.
 *   3. **REFUSE while any refund settlement references the credit.** A
 *      `MoneyRefundSettlement.vendorCreditInstanceId` row is an immutable,
 *      already-settled fact.
 *
 * The lines and the applications are `onDelete: 'cascade'` on the parent's own
 * halves, collected by the delete engine; an application can only exist on an
 * issued credit, which rule 1 refuses first.
 */
export const guardVendorCreditDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, recordId } = event
  const { entityInstanceId: vendorCreditInstanceId } = parseRecordId(recordId)

  // The cheap check first: it reads nothing.
  refuseOnStatus(event)

  const issuedAt = resolveIssuedAt(event)
  if (issuedAt) {
    const settled = await settledPeriodsFor(organizationId, [issuedAt])
    if (settled.size > 0) {
      throw new BadRequestError(
        `This vendor credit is dated in ${[...settled.keys()].join(', ')}, which has been ` +
          'closed or posted. A posted period is corrected by reversing an entry, never by ' +
          'deleting its history.',
        { organizationId, recordId, periods: [...settled.keys()].join(',') }
      )
    }
  }

  const [refund] = await database
    .select({ id: schema.MoneyRefundSettlement.id })
    .from(schema.MoneyRefundSettlement)
    .where(
      and(
        eq(schema.MoneyRefundSettlement.organizationId, organizationId),
        eq(schema.MoneyRefundSettlement.vendorCreditInstanceId, vendorCreditInstanceId)
      )
    )
    .limit(1)
  if (refund) {
    throw new BadRequestError(
      'This vendor credit has a refund recorded against it. The refund is an immutable ledger ' +
        'row and cannot be orphaned; void the credit instead.',
      { organizationId, recordId, transactionId: refund.id }
    )
  }
}

/** The status wall, read off the values `deleteEntity` already captured. */
function refuseOnStatus(event: EntityPreDeleteEvent): void {
  const status = unwrapStatus(event.values.vendor_credit_status)
  if (status !== null && VENDOR_CREDIT_POSTED_STATUSES.has(status)) {
    throw new BadRequestError(
      `This vendor credit is ${status}. A credit that is in the books is corrected by voiding ` +
        'it, never by deleting it. Void it first.',
      { organizationId: event.organizationId, recordId: event.recordId, status }
    )
  }
}

function unwrapStatus(value: unknown): string | null {
  const unwrapped = unwrapStatusValue(value)
  return typeof unwrapped === 'string' && unwrapped.length > 0 ? unwrapped : null
}

/** The credit's accounting date off the captured values, or `null` for an undated draft. */
function resolveIssuedAt(event: EntityPreDeleteEvent): Date | null {
  const raw = event.values.vendor_credit_issued_at
  const candidate = Array.isArray(raw) ? raw[0] : raw
  if (typeof candidate === 'string' || candidate instanceof Date) {
    const parsed = new Date(candidate)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return null
}
