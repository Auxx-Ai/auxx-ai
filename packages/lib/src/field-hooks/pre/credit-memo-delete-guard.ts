// packages/lib/src/field-hooks/pre/credit-memo-delete-guard.ts

import { database, schema } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { BadRequestError } from '../../errors'
import { CREDIT_MEMO_POSTED_STATUSES } from '../../money/credit-memos/client'
import { settledPeriodsFor } from '../../postings/settled-periods'
import { unwrapStatusValue } from '../../resources/events/captured-values'
import type { EntityPreDeleteEvent, EntityPreDeleteHandler } from '../types'

/**
 * Pre-delete guard for `credit-memos` (plans/accounting/tasks/10-credit-memos.md
 * section 2.6), registered like the invoice guard. Fires inside `deleteEntity`
 * for EVERY delete path - the generic `record.delete` the drawer's Discard
 * uses, bulk delete, Kopilot, the API - and for the memo when an ORDER is
 * deleted, because `order_credit_memos` is `onDelete: 'cascade'` and the engine
 * runs this guard over the whole closure before writing anything. Deleting an
 * order with an issued memo is therefore refused naming the memo, the same
 * shape as the vendor bill guard.
 *
 * Three refusals, each conditional on state the registry cannot see:
 *
 *   1. **REFUSE on status** `issued` or `settled`: the memo has a posted entry.
 *      Void it first, which reverses the entry; deleting the document behind a
 *      standing entry leaves a credit in the books that no record explains.
 *   2. **REFUSE when `issued_at` falls in a settled period**, whatever the
 *      status, so a voided memo dated in a closed month keeps its history.
 *      A draft that has never been dated has nothing in any period and passes
 *      this rule; it is the status rule that guards the rest.
 *   3. **REFUSE while any refund transaction references the memo.** The
 *      `PaymentTransaction.creditMemoInstanceId` FK is `restrict` and would
 *      refuse the row delete anyway; this reads the ledger table directly, the
 *      way the invoice guard does for an in-flight charge, so the refusal names
 *      the reason instead of a constraint.
 *
 * **What is NOT here, and why.** The lines and the applications are
 * `onDelete: 'cascade'` on `credit_memo_lines` and `credit_memo_applications`,
 * collected by the delete engine; an application can only exist on an issued
 * memo, which rule 1 refuses first.
 */
export const guardCreditMemoDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, recordId } = event
  const { entityInstanceId: creditMemoInstanceId } = parseRecordId(recordId)

  // The cheap check first: it reads nothing.
  refuseOnStatus(event)

  const issuedAt = resolveIssuedAt(event)
  if (issuedAt) {
    const settled = await settledPeriodsFor(organizationId, [issuedAt])
    if (settled.size > 0) {
      throw new BadRequestError(
        `This credit memo is dated in ${[...settled.keys()].join(', ')}, which has been ` +
          'closed or posted. A posted period is corrected by reversing an entry, never by ' +
          'deleting its history.',
        { organizationId, recordId, periods: [...settled.keys()].join(',') }
      )
    }
  }

  const [refund] = await database
    .select({ id: schema.PaymentTransaction.id, status: schema.PaymentTransaction.status })
    .from(schema.PaymentTransaction)
    .where(
      and(
        eq(schema.PaymentTransaction.organizationId, organizationId),
        eq(schema.PaymentTransaction.creditMemoInstanceId, creditMemoInstanceId)
      )
    )
    .limit(1)
  if (refund) {
    throw new BadRequestError(
      `This credit memo has a ${refund.status} refund recorded against it. The refund is a ` +
        'ledger row and cannot be orphaned; remove it first, or void the memo instead.',
      { organizationId, recordId, transactionId: refund.id }
    )
  }
}

/** The status wall, read off the values `deleteEntity` already captured. */
function refuseOnStatus(event: EntityPreDeleteEvent): void {
  const status = unwrapStatus(event.values.credit_memo_status)
  if (status !== null && CREDIT_MEMO_POSTED_STATUSES.has(status)) {
    throw new BadRequestError(
      `This credit memo is ${status}. A memo that is in the books is corrected by voiding it, ` +
        'never by deleting it. Void it first.',
      { organizationId: event.organizationId, recordId: event.recordId, status }
    )
  }
}

/**
 * A captured SINGLE_SELECT value, reduced to its option id. Through the shared
 * `unwrapStatusValue`, because the capture chain hands a select over as
 * `{ type: 'option', optionId }` and a guard comparing the raw value is inert.
 */
function unwrapStatus(value: unknown): string | null {
  const unwrapped = unwrapStatusValue(value)
  return typeof unwrapped === 'string' && unwrapped.length > 0 ? unwrapped : null
}

/**
 * The memo's accounting date off the captured values, or `null` when the draft
 * was never dated.
 *
 * Deliberately NO `createdAt` fallback, unlike the vendor bill guard: a bill's
 * date is nullable on a document that may already be posted, whereas a memo
 * without `issued_at` is by construction a draft that never reached the ledger.
 * There is no period for it to be in.
 */
function resolveIssuedAt(event: EntityPreDeleteEvent): Date | null {
  const raw = event.values.credit_memo_issued_at
  const candidate = Array.isArray(raw) ? raw[0] : raw
  if (typeof candidate === 'string' || candidate instanceof Date) {
    const parsed = new Date(candidate)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return null
}
