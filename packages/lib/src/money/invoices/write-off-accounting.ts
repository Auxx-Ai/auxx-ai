// packages/lib/src/money/invoices/write-off-accounting.ts

/**
 * The invoice write-off entry, as a durable accounting EFFECT — D19 of
 * plans/accounting/tasks/53-two-modes-one-ledger.md §7.3.3.
 *
 * ## 🔑 Why this family was the hard one, and what actually unblocked it
 *
 * Every other D19 family is one journal per document forever. A write-off is
 * not: `resolveWriteOffAmount` bounds a write-off by what is still outstanding
 * precisely so a PARTIAL one can be topped up later, and
 * `build-write-off-entry.ts` already carries an ATTEMPT in its `periodKey`
 * because an earlier version keyed on the invoice number alone and silently lost
 * the second write-off to `already_posted`.
 *
 * 🛑 **A top-up is not a correction.** `operation: 'correction'` says the first
 * entry was a mistake. A July write-off after a March one is new bad debt, on
 * its own date, and booking it as a correction would move the loss into the
 * wrong month. So the obligation stays `operation: 'original'` and the
 * repetition is carried by identity instead:
 *
 * - `documentAccountingEffectKey` takes the attempt as its OCCURRENCE, so the
 *   second write-off of one invoice mints its own `effectKey` rather than
 *   colliding on `AccountingWork_org_effect_key`;
 * - `AccountingWork_fulfillment_original_key` — the partial unique that says
 *   "one original per entity per kind" — is narrowed to exclude this family,
 *   because that sentence is simply false of a write-off.
 *
 * ⚠️ The attempt is counted off `GlPostingLine`, under the accounting commit
 * lock, so preparation and the revalidator cannot disagree about which write-off
 * this is while another acceptance commits between them.
 *
 * ## 🛑 What changed for a caller, and what did not
 *
 * `acceptInvoiceWriteOffAccounting` never throws and answers a `PostResult`,
 * exactly as `postEntry` did, so `write-off.ts` still stamps
 * `invoice_written_off` on the same `isExpectedPostOutcome` test it always did:
 * an invoice must not fail to be written off because its bookkeeping did. What
 * changed is underneath — the claim is now made by `acceptEntryInTx` against a
 * captured `AccountingWork`, so the entry carries a frozen basis and can carry a
 * cash/accrual discriminator (D13).
 *
 * @see plans/accounting/tasks/53-two-modes-one-ledger.md
 * @see docs/lib-module-guide.md
 */

import type { Database, Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import { acceptEntryInTx } from '../../postings/accept-entry'
import { withAccountingCommitLock } from '../../postings/accounting-commit-lock'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import { resolveFulfillmentDeliveryIntentInTx } from '../../postings/book-connections'
import { buildWriteOffEntry, WRITE_OFF_SOURCE_TYPE } from '../../postings/build-write-off-entry'
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
import { todayInBookTimeZone } from './issuance-reads'
import { countWriteOffPostings, loadInvoiceForWriteOff } from './write-off-reads'

const logger = createScopedLogger('money-invoice-write-off-accounting')

/**
 * The invoice cannot be read any more, so there is nothing to write off.
 *
 * Its own class for the reason `issuance-accounting.ts`'s twin has one: it is a
 * refusal that is not an alarm. `writeOffInvoice` has already validated the
 * invoice before it gets here, so reaching this means the record vanished
 * between the two reads.
 */
class UnreadableInvoiceError extends UnprocessableEntityError {}

export interface AcceptInvoiceWriteOffInput {
  organizationId: string
  /** The `invoice` EntityInstance id. */
  invoiceId: string
  /** Integer minor units, > 0. Decided by the caller, never re-derived here. */
  amountMinor: number
  /** The write-off's reason, which is also the journal and line memo. */
  reason: string
  actorUserId?: string
  /**
   * A `gl_account` id out of the org's own chart, overriding the debit leg.
   * Omit to use the `bad_debt_expense` role (the ordinary case).
   */
  expenseGlAccountId?: string
}

interface PreparedWriteOff {
  entry: BuiltEntry
  documentKey: string
  /** The attempt, as the effect key's occurrence. `'original'` for the first. */
  occurrence: string
  workBasis: DocumentWorkBasisInput
  acceptedBasis: AcceptedDocumentEffectBasisV1
}

/**
 * Read the invoice, count the prior write-offs, resolve the accounts and freeze
 * both bases.
 *
 * 🛑 Called TWICE: once to prepare, and again inside `acceptEntryInTx` under the
 * commit lock as the revalidator. Both runs must produce the identical accepted
 * basis or acceptance refuses — an invoice re-numbered, a contact repointed or a
 * `bad_debt_expense` role moved between the two is a change the ledger must not
 * absorb silently.
 *
 * ⚠️ The AMOUNT is the one input that is not re-derived. How much of a balance
 * to give up is a human decision made in the dialog; re-deriving it here would
 * quietly turn a partial write-off into a full one.
 */
async function prepareWriteOff(
  tx: Transaction,
  input: AcceptInvoiceWriteOffInput
): Promise<PreparedWriteOff> {
  const invoice = await loadInvoiceForWriteOff(tx, input.organizationId, input.invoiceId)
  if (!invoice)
    throw new UnreadableInvoiceError(
      `Invoice ${input.invoiceId} can no longer be read, so there is nothing to write off.`
    )

  const currency = await getOrganizationSetting({
    db: tx,
    organizationId: input.organizationId,
    key: 'organization.currency',
  })
  if (currency !== 'USD')
    throw new UnprocessableEntityError('Invoice write-off accounting requires USD')
  const zone = await getOrganizationSetting({
    db: tx,
    organizationId: input.organizationId,
    key: OPENING_BASELINE_SETTING_KEYS.bookTimeZone,
  })
  if (typeof zone !== 'string' || !zone)
    throw new UnprocessableEntityError('Book time zone is not configured')

  const txnDate = await todayInBookTimeZone(input.organizationId)
  const attempt = await countWriteOffPostings(tx, input.organizationId, input.invoiceId)

  const built = buildWriteOffEntry({
    invoiceId: input.invoiceId,
    invoiceNumber: invoice.number,
    attempt,
    amountMinor: input.amountMinor,
    txnDate,
    expenseGlAccountId: input.expenseGlAccountId,
    memo: input.reason,
    contactInstanceId: invoice.contactInstanceId,
  })

  // 🛑 An invoice carries no source axis, so the scope is empty and every role
  // resolves to the org default. Resolved through `documentRoleScope` rather
  // than by passing nothing, so preparation and acceptance cannot disagree.
  const calculationScope = {}
  const resolved = await resolveAccountLines(
    tx,
    input.organizationId,
    built.lines,
    documentRoleScope(calculationScope)
  )
  if (resolved.isErr()) throw resolved.error

  // The resolved accounts are IN the source hash, as they are on the issuance
  // and credit paths: a role repointed in the chart is a new basis version to
  // select, not a silent restatement of an obligation somebody approved.
  const sourceHash = accountingBasisHash({
    invoice: {
      id: input.invoiceId,
      number: invoice.number,
      contact: invoice.contactInstanceId,
    },
    writeOff: {
      attempt,
      amountMinor: String(input.amountMinor),
      expenseGlAccountId: input.expenseGlAccountId ?? null,
      reason: input.reason,
    },
    txnDate,
    accounts: resolved.value.map((account) => account.glAccountId),
  })

  const lines = built.lines.map((line, index) => ({
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
    family: 'invoice_write_off',
    documentInstanceId: input.invoiceId,
    documentKey: built.periodKey,
    sourceHash,
    effectiveDate: txnDate,
    currency: 'USD',
    currencyExponent: 2,
    totalMinor: String(input.amountMinor),
    lines,
  }

  const workBasis = documentWorkBasisSchema.parse({
    version: 1,
    status: 'ready',
    family: 'invoice_write_off',
    documentInstanceId: input.invoiceId,
    sourceHash,
    effectiveDate: txnDate,
    calculation,
  })

  const acceptedBasis = acceptedDocumentEffectBasisSchema.parse({
    version: 1,
    sourceBasisVersion: 1,
    sourceHash,
    policyKey: 'document_entry_v1',
    policyVersion: 1,
    effectiveDate: txnDate,
    bookTimeZone: zone,
    currency: 'USD',
    currencyExponent: 2,
    documentRefs: [{ resourceKind: WRITE_OFF_SOURCE_TYPE, entityInstanceId: input.invoiceId }],
    calculation,
    accountResolution: built.lines.map((line, index) => ({
      lineKey: `line:${index}`,
      glAccountId: resolved.value[index]!.glAccountId,
      accountRole: line.accountRole ?? null,
      selectedBy: line.accountRole ? 'org_role' : 'document',
      configurationHash: accountingBasisHash(resolved.value[index]!),
    })),
    contribution: built.lines.map((line, index) => ({
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
    entry: built,
    documentKey: built.periodKey,
    // 🛑 `'original'` for the FIRST write-off, byte for byte the key this family
    // would mint if it were 1:1. Only a repeat carries a discriminator, so an
    // invoice written off once has exactly the identity every other D19 family
    // has.
    occurrence: attempt === 0 ? 'original' : `attempt:${attempt}`,
    workBasis,
    acceptedBasis,
  }
}

/**
 * Capture the obligation and accept the write-off journal as one transaction.
 *
 * **Never throws.** Every refusal is a {@link PostResult}, so `writeOffInvoice`
 * can still reduce the invoice's balance when the books refuse the entry.
 *
 * Idempotent within one attempt: a retry of the same transaction re-counts the
 * same prior postings under the same commit lock, mints the same `effectKey`,
 * and converges on the accepted effect's own journal. A genuinely NEW write-off
 * counts one more posting, mints a new key, and posts.
 */
export async function acceptInvoiceWriteOffAccounting(
  db: Database,
  input: AcceptInvoiceWriteOffInput
): Promise<PostResult> {
  if (!(await isAccountingEnabled(db, input.organizationId))) return { status: 'not_enabled' }

  try {
    return await db.transaction(async (tx) => {
      // 🛑 Taken BEFORE preparation, which no 1:1 family needs to do. The attempt
      // is read out of `GlPostingLine`, and every accounting acceptance takes
      // this same lock, so without it a write-off accepted by another request
      // between preparation and revalidation would change the count underneath
      // us and the revalidator would refuse a change nobody made.
      await withAccountingCommitLock(tx, input.organizationId)
      const prepared = await prepareWriteOff(tx, input)
      await assertDocumentJournalIsOwnedInTx(tx, {
        organizationId: input.organizationId,
        family: 'invoice_write_off',
        documentKey: prepared.documentKey,
      })
      const selected = await captureDocumentWorkInTx(tx, {
        organizationId: input.organizationId,
        family: 'invoice_write_off',
        documentInstanceId: input.invoiceId,
        occurrence: prepared.occurrence,
        // A write-off is a person deciding to give up a receivable, so the
        // obligation is `manual` — unlike an issuance, which the act of sending
        // the invoice posts.
        eligibility: 'manual',
        basis: prepared.workBasis,
      })
      const accepted = await acceptEntryInTx(
        tx,
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          memo: input.reason,
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
            ...(await prepareWriteOff(lockedTx, input)).acceptedBasis,
            sourceBasisVersion: work.basisVersion,
          }),
        }
      )
      if (accepted.status !== 'accepted' || !accepted.glPostingId)
        throw new UnprocessableEntityError('Invoice write-off accounting membership changed')
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
    logger.warn('An invoice write-off was not accepted into the ledger', {
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
