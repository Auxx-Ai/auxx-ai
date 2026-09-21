// packages/lib/src/accounting/purchasing/vendor-credit/apply.ts
//
// Applying an issued vendor credit's balance against a posted bill, and taking
// it back. An application is an entity row, not money: it posts NOTHING - the
// credit's issue entry already debited the payable and the bill's entry
// credited it - and its only effects are `vendor_bill_amount_credited`, the
// bill's balance and payment status, and the credit's own settlement figures.
//
// The gate is the LEDGER, not a status (73 D1): a bill with no live A/P posting
// has no payable to relieve, whatever its lifecycle says.
//
// No permission checks here. The router asserts.

import { type Database, database } from '@auxx/database'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { requireCachedEntityDefId } from '../../../cache'
import { BadRequestError, ConflictError, NotFoundError } from '../../../errors'
import { createFieldValueContext } from '../../../field-values/field-value-helpers'
import { setValueWithType } from '../../../field-values/field-value-mutations'
import { readFieldScalars } from '../../../field-values/read-field-scalars'
import { toFieldType } from '../../../field-values/stored-field-type'
import { UnifiedCrudHandler } from '../../../resources/crud'
import { systemFieldMap } from '../../../resources/system-records'
import { settledPeriodsFor } from '../../ledger/periods/settled-periods'
import { runMoneyCommand } from '../../money/commands/run-money-command'
import {
  sumVendorBillDiscounts,
  sumVendorBillPayments,
  syncVendorBillPaymentState,
} from '../../money/vendor-payments/payment-state'
import { requireVendorBill } from '../expense-bill/reads'
import { listVendorBillPostings } from '../expense-bill/writes'
import { recalculateVendorBillBalance } from '../vendor-bill-balance'
import {
  listVendorCreditApplications,
  loadVendorCreditApplication,
  requireVendorCredit,
  sumVendorBillCreditApplications,
  sumVendorCreditApplications,
  sumVendorCreditRefunds,
} from './reads'
import { settleVendorCredit } from './settle'

export interface ApplyVendorCreditInput {
  organizationId: string
  userId: string
  vendorCreditInstanceId: string
  vendorBillInstanceId: string
  /** Integer minor units, > 0, at most the credit's balance and the bill's balance. */
  amount: number
  commandKey: string
}

export interface ApplyVendorCreditResult {
  applicationInstanceId: string
}

/**
 * Apply part of an issued credit's balance to one bill.
 *
 * Refuses over EITHER balance, both re-derived from their sources rather than
 * read off the mirrors. The credit and the bill must belong to the same
 * supplier: credit is a statement about what one vendor owes back, and moving
 * it onto another vendor's bill is a journal entry, not an application.
 */
export async function applyVendorCredit(
  db: Database,
  input: ApplyVendorCreditInput
): Promise<ApplyVendorCreditResult> {
  return runMoneyCommand(
    db,
    {
      organizationId: input.organizationId,
      userId: input.userId,
      commandKey: input.commandKey,
      kind: 'vendor_credit_apply',
      payload: {
        vendorCreditInstanceId: input.vendorCreditInstanceId,
        vendorBillInstanceId: input.vendorBillInstanceId,
        amount: input.amount,
      },
    },
    async (tx) => {
      const db = tx as unknown as Database
      const { organizationId, userId, vendorCreditInstanceId, vendorBillInstanceId, amount } = input

      if (!Number.isSafeInteger(amount) || amount <= 0)
        throw new BadRequestError('The amount to apply must be a whole number of cents above zero')

      const credit = await requireVendorCredit(db, organizationId, vendorCreditInstanceId)
      if (credit.status !== 'issued')
        throw new BadRequestError(
          credit.status === 'draft'
            ? 'Issue this vendor credit before applying it'
            : credit.status === 'settled'
              ? 'This vendor credit is settled - it has no balance left to apply'
              : 'A void vendor credit cannot be applied',
          { vendorCreditInstanceId, status: credit.status }
        )

      const bill = await requireVendorBill(db, organizationId, vendorBillInstanceId)
      const postings = await listVendorBillPostings(db, {
        organizationId,
        vendorBillInstanceId,
      })
      // `posted`, never "a row exists": a DRAFT waiting in the outbox holds no
      // claim and no balance, so there is nothing yet to credit.
      if (!postings.some((posting) => posting.status === 'posted'))
        throw new BadRequestError(
          postings.some((posting) => posting.status === 'draft')
            ? "This vendor bill's entry is waiting for approval in the outbox, so there is no " +
                'payable to credit yet. Approve it first.'
            : 'This vendor bill is not in the books yet, so there is no payable to credit. Post ' +
                'it first.',
          { vendorBillInstanceId }
        )
      if (
        !credit.vendorCompanyInstanceId ||
        !bill.vendorCompanyInstanceId ||
        credit.vendorCompanyInstanceId !== bill.vendorCompanyInstanceId
      )
        throw new BadRequestError(
          `Vendor credit ${credit.number} and bill ${bill.internalNumber} belong to different ` +
            'vendors',
          { vendorCreditInstanceId, vendorBillInstanceId }
        )

      const [applied, refunded, billCredited, billPaid, billDiscounted] = await Promise.all([
        sumVendorCreditApplications(db, organizationId, vendorCreditInstanceId),
        sumVendorCreditRefunds(db, organizationId, vendorCreditInstanceId),
        sumVendorBillCreditApplications(db, organizationId, vendorBillInstanceId),
        sumVendorBillPayments(db, organizationId, vendorBillInstanceId),
        sumVendorBillDiscounts(db, organizationId, vendorBillInstanceId),
      ])
      const creditBalance = Math.max(0, credit.totalMinor - applied - refunded)
      const billBalance = Math.max(0, bill.totalMinor - billPaid - billCredited - billDiscounted)

      if (amount > creditBalance)
        throw new BadRequestError(
          `Applying ${amount} exceeds the ${creditBalance} left on vendor credit ${credit.number}`,
          { vendorCreditInstanceId, amountMinor: String(amount) }
        )
      if (amount > billBalance)
        throw new BadRequestError(
          `Applying ${amount} exceeds the ${billBalance} still owed on bill ` +
            `${bill.internalNumber}`,
          { vendorBillInstanceId, amountMinor: String(amount) }
        )

      const handler = new UnifiedCrudHandler(organizationId, userId, db)
      const created = await handler.create('vendor_credit_application', {
        vendor_credit_application_vendor_credit: toRecordId(
          'vendor_credit',
          vendorCreditInstanceId
        ),
        vendor_credit_application_vendor_bill: toRecordId('vendor_bill', vendorBillInstanceId),
        vendor_credit_application_amount: amount,
        vendor_credit_application_operation: 'apply',
        vendor_credit_application_applied_at: new Date().toISOString(),
      })

      await projectBillCredit(db, { organizationId, userId, vendorBillInstanceId })
      await settleVendorCredit(db, { organizationId, userId, vendorCreditInstanceId })

      return { applicationInstanceId: created.instance.id }
    }
  )
}

export interface UnapplyVendorCreditInput {
  organizationId: string
  userId: string
  applicationInstanceId: string
}

/**
 * Take an application back: append a reversal, re-project the bill, re-settle
 * the credit.
 *
 * Refused when the application's date falls in a settled period. The
 * application posts nothing, but the bill balance it moved is what A/P aging
 * reported for that month, and a closed month is corrected by a new application
 * dated today, never by editing what the month said.
 */
export async function unapplyVendorCredit(
  db: Database,
  input: UnapplyVendorCreditInput
): Promise<void> {
  await runMoneyCommand(
    db,
    {
      organizationId: input.organizationId,
      userId: input.userId,
      commandKey: `vendor-credit-unapply:${input.applicationInstanceId}`,
      kind: 'vendor_credit_unapply',
      payload: { applicationInstanceId: input.applicationInstanceId },
    },
    async (tx) => {
      const db = tx as unknown as Database
      const { organizationId, userId, applicationInstanceId } = input

      const application = await loadVendorCreditApplication(
        db,
        organizationId,
        applicationInstanceId
      )
      if (!application)
        throw new NotFoundError('Vendor credit application not found', { applicationInstanceId })

      const appliedAt = application.appliedAt ? new Date(application.appliedAt) : null
      if (appliedAt && !Number.isNaN(appliedAt.getTime())) {
        const settled = await settledPeriodsFor(organizationId, [appliedAt])
        if (settled.size > 0)
          throw new ConflictError(
            `This credit was applied in ${[...settled.keys()].join(', ')}, which has been closed ` +
              'or posted. Apply a new credit or record a refund instead of undoing history.',
            { applicationInstanceId, periods: [...settled.keys()].join(',') }
          )
      }

      if (
        application.operation === 'unapply' ||
        !application.vendorCreditInstanceId ||
        !application.vendorBillInstanceId
      )
        throw new BadRequestError('Only a complete original credit application can be undone')

      const history = await listVendorCreditApplications(
        db,
        organizationId,
        application.vendorCreditInstanceId
      )
      const alreadyReversed = history.some(
        (row) =>
          row.operation === 'unapply' &&
          row.vendorBillInstanceId === application.vendorBillInstanceId &&
          row.amountMinor === application.amountMinor
      )
      if (alreadyReversed) return { applicationInstanceId }

      const handler = new UnifiedCrudHandler(organizationId, userId, db)
      const reversal = await handler.create('vendor_credit_application', {
        vendor_credit_application_vendor_credit: toRecordId(
          'vendor_credit',
          application.vendorCreditInstanceId
        ),
        vendor_credit_application_vendor_bill: toRecordId(
          'vendor_bill',
          application.vendorBillInstanceId
        ),
        vendor_credit_application_amount: application.amountMinor,
        vendor_credit_application_applied_at: new Date().toISOString(),
        vendor_credit_application_operation: 'unapply',
      })

      await projectBillCredit(db, {
        organizationId,
        userId,
        vendorBillInstanceId: application.vendorBillInstanceId,
      })
      await settleVendorCredit(db, {
        organizationId,
        userId,
        vendorCreditInstanceId: application.vendorCreditInstanceId,
      })

      return { applicationInstanceId: reversal.instance.id }
    }
  )
}

/**
 * Re-project one bill's `vendor_bill_amount_credited` from its applications,
 * then its balance and its payment status.
 *
 * The low-level writer, like `recalculateVendorBillBalance`'s: a context with
 * no `userId` does not fire the field-change chain, which is what keeps a
 * derived write from re-entering the hooks that produced it.
 */
export async function projectBillCredit(
  db: Database,
  input: { organizationId: string; userId: string; vendorBillInstanceId: string }
): Promise<void> {
  const { organizationId, userId, vendorBillInstanceId } = input
  const fields = await systemFieldMap<SystemAttribute>(db, organizationId, [
    'vendor_bill_amount_credited',
  ])
  const creditedField = fields.vendor_bill_amount_credited
  if (creditedField) {
    const credited = await sumVendorBillCreditApplications(db, organizationId, vendorBillInstanceId)
    const stored = (
      await readFieldScalars(db, organizationId, [vendorBillInstanceId], [creditedField.id])
    )
      .get(vendorBillInstanceId)
      ?.get(creditedField.id)
    if (stored !== credited) {
      const billDefId = await requireCachedEntityDefId(organizationId, 'vendor_bill')
      const recordId = toRecordId(billDefId, vendorBillInstanceId) as RecordId
      await setValueWithType(
        createFieldValueContext(organizationId, undefined, db === database ? undefined : db),
        {
          recordId,
          fieldId: creditedField.id,
          fieldType: toFieldType(creditedField.type),
          value: { type: 'number', value: credited },
        }
      )
    }
  }

  await recalculateVendorBillBalance(organizationId, vendorBillInstanceId, db)
  await syncVendorBillPaymentState(db, { organizationId, userId, vendorBillInstanceId })
}
