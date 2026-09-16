// packages/lib/src/money/invoices/issuance-accounting.ts

/**
 * The invoice issuance entry, as a durable accounting EFFECT — D19 of
 * plans/accounting/tasks/53-two-modes-one-ledger.md §7.3.3.
 *
 * ## Why this family first
 *
 * `invoice_issued` is the sharpest of D19's seven, and not because of the
 * register. It is the family where the two books DISAGREE: on an accrual basis
 * an issued invoice recognises revenue the day it is sent, and on a cash basis
 * an issued-but-unpaid invoice is not an event at all. Until it posted through
 * an accepted effect there was nowhere to say "this entry exists on one book and
 * not the other" — `AcceptedDocumentEffectBasisV1.basis` is that place, reserved
 * by D13 on `postings/basis-dimension.ts`.
 *
 * ✅ The family is genuinely its own. `build-invoice-entry.ts` establishes that
 * `invoice` and `order` are DISJOINT document families, so no code path produces
 * both a fulfillment entry and an issuance entry for one sale, and there is no
 * double-count to reconcile against `money/fulfillment-posting`.
 *
 * ## 🛑 What changed for a caller, and what did not
 *
 * `postInvoiceIssuance` still never throws and still answers a `PostResult`, so
 * `invoice-lifecycle.ts` is untouched: an invoice must not fail to SEND because
 * its bookkeeping did. What changed is underneath — the claim is now made by
 * `acceptEntryInTx` against a captured `AccountingWork`, so a re-run converges
 * on the accepted effect rather than on the claim's unique index alone.
 *
 * ✅ The document number is unchanged. `acceptEntryInTx` keeps a document
 * family's own `periodKey`, so an issuance is still `AUXX-INI-INV-0042` and the
 * claim is still one entry per invoice number.
 *
 * @see plans/accounting/tasks/08-invoice-revenue.md
 * @see docs/lib-module-guide.md
 */

import type { Database, Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import { acceptEntryInTx } from '../../postings/accept-entry'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import { resolveFulfillmentDeliveryIntentInTx } from '../../postings/book-connections'
import { buildInvoiceEntry, INVOICE_SOURCE_TYPE } from '../../postings/build-invoice-entry'
import { planAccountingDeliveryInTx } from '../../postings/delivery'
import {
  type AcceptedDocumentEffectBasisV1,
  acceptedDocumentEffectBasisSchema,
  type DocumentAccountingBasisV1,
  type DocumentWorkBasisInput,
  documentRoleScope,
  documentWorkBasisSchema,
} from '../../postings/document-effect-types'
import {
  assertDocumentJournalIsOwnedInTx,
  captureDocumentWorkInTx,
} from '../../postings/document-effect-work'
import { accountingBasisHash } from '../../postings/effect-basis'
import { resolveAccountLines } from '../../postings/resolve-roles'
import { OPENING_BASELINE_SETTING_KEYS } from '../../postings/setup-readiness'
import type { BuiltEntry, PostResult } from '../../postings/types'
import { getOrganizationSetting } from '../../settings/settings-service'
import { loadInvoiceForIssuance, todayInBookTimeZone } from './issuance-reads'

const logger = createScopedLogger('money-invoice-issuance-accounting')

/**
 * The invoice has no readable totals, so there is nothing to recognise.
 *
 * Its own class because it is the one refusal in here that is NOT an error: an
 * invoice with no totals is an empty document, and `post-invoice.ts` reports it
 * as `nothing_to_close` rather than alarming on it.
 */
class UnreadableInvoiceError extends UnprocessableEntityError {}

export interface AcceptInvoiceIssuanceInput {
  organizationId: string
  /** The `invoice` EntityInstance id. */
  invoiceId: string
  actorUserId?: string
  /**
   * Override the invoice's own `issuedAt`. Absent uses the stamped date, and
   * today in the book time zone when nothing was ever stamped.
   */
  issuedAt?: string
}

interface PreparedInvoiceIssuance {
  entry: BuiltEntry
  documentKey: string
  totalMinor: number
  workBasis: DocumentWorkBasisInput
  acceptedBasis: AcceptedDocumentEffectBasisV1
}

/**
 * Read the invoice, resolve its accounts and freeze both bases.
 *
 * 🛑 Called TWICE: once to prepare, and again inside `acceptEntryInTx` under the
 * commit lock as the revalidator. Both runs must produce the identical accepted
 * basis or acceptance refuses, which is exactly the guard — an invoice edited or
 * a role repointed between the two is a change the ledger must not absorb
 * silently.
 */
async function prepareInvoiceIssuance(
  tx: Transaction,
  input: AcceptInvoiceIssuanceInput
): Promise<PreparedInvoiceIssuance> {
  const invoice = await loadInvoiceForIssuance(tx, input.organizationId, input.invoiceId)
  if (!invoice)
    throw new UnreadableInvoiceError(
      `Invoice ${input.invoiceId} has no readable totals, so there is nothing to recognise.`
    )

  const issuedAt =
    input.issuedAt ?? invoice.issuedAt ?? (await todayInBookTimeZone(input.organizationId))

  const currency = await getOrganizationSetting({
    db: tx,
    organizationId: input.organizationId,
    key: 'organization.currency',
  })
  if (currency !== 'USD')
    throw new UnprocessableEntityError('Invoice issuance accounting requires USD')
  const zone = await getOrganizationSetting({
    db: tx,
    organizationId: input.organizationId,
    key: OPENING_BASELINE_SETTING_KEYS.bookTimeZone,
  })
  if (typeof zone !== 'string' || !zone)
    throw new UnprocessableEntityError('Book time zone is not configured')

  const built = buildInvoiceEntry({
    invoiceId: input.invoiceId,
    invoiceNumber: invoice.number,
    issuedAt,
    subtotalMinor: invoice.subtotalMinor,
    taxTotalMinor: invoice.taxTotalMinor,
    totalMinor: invoice.totalMinor,
    contactInstanceId: invoice.contactInstanceId,
  })

  // 🛑 An invoice carries no source axis, so the scope is empty and every role
  // resolves to the org default. Resolved through `documentRoleScope` rather
  // than by passing nothing, so preparation and acceptance cannot disagree.
  const calculationScope = {}
  const resolved = await resolveAccountLines(
    tx,
    input.organizationId,
    built.entry.lines,
    documentRoleScope(calculationScope)
  )
  if (resolved.isErr()) throw resolved.error

  // The resolved accounts are IN the source hash, as they are on the credit
  // path: a role repointed in the chart is a new basis version to select, not a
  // silent restatement of an obligation somebody already approved.
  const sourceHash = accountingBasisHash({
    invoice: {
      id: input.invoiceId,
      number: invoice.number,
      contact: invoice.contactInstanceId,
      subtotalMinor: built.subtotalMinor,
      taxTotalMinor: built.taxTotalMinor,
      totalMinor: built.totalMinor,
    },
    issuedAt,
    accounts: resolved.value.map((account) => account.glAccountId),
  })

  const lines = built.entry.lines.map((line, index) => ({
    lineKey: `line:${index}`,
    accountRole: line.accountRole ?? null,
    glAccountId: line.accountRole ? null : (line.glAccountId ?? null),
    direction: line.direction,
    amountMinor: String(line.amount),
    counterpartyType: line.counterpartyType ?? null,
    counterpartyId: line.counterpartyId ?? null,
    dimensions: line.dimensions ?? {},
  }))

  const calculation: DocumentAccountingBasisV1 = {
    version: 1,
    family: 'invoice_issued',
    documentInstanceId: input.invoiceId,
    documentKey: built.periodKey,
    sourceHash,
    effectiveDate: issuedAt,
    currency: 'USD',
    currencyExponent: 2,
    totalMinor: String(built.totalMinor),
    lines,
  }

  const workBasis = documentWorkBasisSchema.parse({
    version: 1,
    status: 'ready',
    family: 'invoice_issued',
    documentInstanceId: input.invoiceId,
    sourceHash,
    effectiveDate: issuedAt,
    calculation,
  })

  const acceptedBasis = acceptedDocumentEffectBasisSchema.parse({
    version: 1,
    sourceBasisVersion: 1,
    sourceHash,
    policyKey: 'document_entry_v1',
    policyVersion: 1,
    effectiveDate: issuedAt,
    bookTimeZone: zone,
    currency: 'USD',
    currencyExponent: 2,
    documentRefs: [{ resourceKind: INVOICE_SOURCE_TYPE, entityInstanceId: input.invoiceId }],
    calculation,
    accountResolution: built.entry.lines.map((line, index) => ({
      lineKey: `line:${index}`,
      glAccountId: resolved.value[index]!.glAccountId,
      accountRole: line.accountRole ?? null,
      selectedBy: line.accountRole ? 'org_role' : 'document',
      configurationHash: accountingBasisHash(resolved.value[index]!),
    })),
    contribution: built.entry.lines.map((line, index) => ({
      lineKey: `line:${index}`,
      glAccountId: resolved.value[index]!.glAccountId,
      direction: line.direction,
      amountMinor: String(line.amount),
      counterpartyType: line.counterpartyType ?? null,
      counterpartyId: line.counterpartyId ?? null,
      dimensions: line.dimensions ?? {},
    })),
  })

  return {
    entry: built.entry,
    documentKey: built.periodKey,
    totalMinor: built.totalMinor,
    workBasis,
    acceptedBasis,
  }
}

/**
 * Capture the obligation and accept the issuance journal as one transaction.
 *
 * **Never throws.** Every refusal is a {@link PostResult}, for the reason
 * `post-invoice.ts`'s header gives.
 *
 * Idempotent twice over: the work's `effectKey` is unique per invoice, and a
 * second call whose basis is unchanged returns the accepted effect's own
 * journal rather than claiming a second one.
 */
export async function acceptInvoiceIssuanceAccounting(
  db: Database,
  input: AcceptInvoiceIssuanceInput
): Promise<PostResult> {
  if (!(await isAccountingEnabled(db, input.organizationId))) return { status: 'not_enabled' }

  try {
    return await db.transaction(async (tx) => {
      const prepared = await prepareInvoiceIssuance(tx, input)
      await assertDocumentJournalIsOwnedInTx(tx, {
        organizationId: input.organizationId,
        family: 'invoice_issued',
        documentKey: prepared.documentKey,
      })
      const selected = await captureDocumentWorkInTx(tx, {
        organizationId: input.organizationId,
        family: 'invoice_issued',
        documentInstanceId: input.invoiceId,
        // An invoice issuance is posted by the act of sending the invoice, not
        // by a person choosing to post it. Same eligibility a fulfillment gets.
        eligibility: 'automatic',
        basis: prepared.workBasis,
      })
      const accepted = await acceptEntryInTx(
        tx,
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          memo: `Invoice ${prepared.documentKey} issued`,
          entry: prepared.entry,
          members: [
            {
              workId: selected.work.id,
              expectedBasisVersion: selected.work.basisVersion,
              acceptedBasis: {
                ...prepared.acceptedBasis,
                sourceBasisVersion: selected.work.basisVersion,
              },
            },
          ],
          deliveryIntent: await resolveFulfillmentDeliveryIntentInTx(
            tx,
            input.organizationId,
            prepared.entry.txnDate
          ),
        },
        {
          revalidateMemberInTx: async (lockedTx, work) => ({
            ...(await prepareInvoiceIssuance(lockedTx, input)).acceptedBasis,
            sourceBasisVersion: work.basisVersion,
          }),
        }
      )
      if (accepted.status !== 'accepted' || !accepted.glPostingId)
        throw new UnprocessableEntityError('Invoice issuance accounting membership changed')
      await planAccountingDeliveryInTx(tx, {
        organizationId: input.organizationId,
        glPostingId: accepted.glPostingId,
      })
      return {
        status: accepted.existing ? 'already_posted' : 'posted',
        glPostingId: accepted.glPostingId,
      } satisfies PostResult
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof UnreadableInvoiceError)
      return { status: 'nothing_to_close', error: message }
    logger.warn('An invoice issuance was not accepted into the ledger', {
      organizationId: input.organizationId,
      invoiceId: input.invoiceId,
      error: message,
    })
    return {
      status: 'error',
      failureClass: error instanceof AuxxError ? 'data' : 'transport',
      retryable: false,
      error: message,
    }
  }
}
