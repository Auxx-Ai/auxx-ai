// packages/lib/scripts/drive-bank-review.ts
//
// Drives HANDOFF slot 3B end to end against a real org: seed a bank account and
// a handful of statement lines, then walk all four treatments - match, code,
// transfer, exclude - plus undo, and print `verifyBooksBalance` and every
// posting that came out.
//
// The sibling of `drive-bank-deposit.ts`. It WRITES: it creates records and
// posts `GlPosting` rows. Point it at a dev org.
//
//   npx dotenv -- npx tsx packages/lib/scripts/drive-bank-review.ts <organizationId>
//
// 🛑 The most important line of output is `match post=null`. A matched bank line
// posts NOTHING (decision B5) - the document's own entry already credited cash,
// and a second entry from the feed credits it twice while balancing perfectly.

import { closePools, database, schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { createBankAccount, listBankAccounts, updateBankAccount } from '../src/banking'
import {
  codeTransaction,
  excludeTransaction,
  listForReview,
  listMatchCandidates,
  matchTransaction,
  readHistory,
  readQueueStats,
  transferTransaction,
  undoReview,
} from '../src/banking/review'
import { getCachedEntityDefId } from '../src/cache'
import { listBankDeposits } from '../src/money/bank-deposits'
import { createChartAccount } from '../src/postings/chart-write'
import { listChartAccounts } from '../src/postings/role-map'
import { verifyBooksBalance } from '../src/postings/verify-balance'
import { UnifiedCrudHandler } from '../src/resources/crud/unified-handler'
import { toRecordId } from '../src/resources/resource-id'

/** Today, and a few days either side, as `YYYY-MM-DD`. */
function day(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
}

async function main() {
  const organizationId = process.argv[2]
  if (!organizationId) throw new Error('usage: drive-bank-review.ts <organizationId>')

  const [member] = await database
    .select({ userId: schema.OrganizationMember.userId })
    .from(schema.OrganizationMember)
    .where(eq(schema.OrganizationMember.organizationId, organizationId))
    .limit(1)
  if (!member) throw new Error('that organization has no members')
  const actorUserId = member.userId

  // ── 1. Two bank accounts, so a transfer has somewhere to go ──────────────
  const chart = await listChartAccounts(database, organizationId)
  if (chart.isErr()) throw chart.error
  const codes = new Set(chart.value.map((account) => account.code))
  if (!codes.has('1010')) {
    const created = await createChartAccount(database, {
      organizationId,
      actorUserId,
      code: '1010',
      name: 'Savings',
      accountType: 'asset',
    })
    console.log(`RESULT chart 1010=${created.isErr() ? created.error.message : 'created'}`)
  }
  if (!codes.has('6100')) {
    const created = await createChartAccount(database, {
      organizationId,
      actorUserId,
      code: '6100',
      name: 'Bank Fees',
      accountType: 'expense',
    })
    console.log(`RESULT chart 6100=${created.isErr() ? created.error.message : 'created'}`)
  }

  const existing = await listBankAccounts(database, { organizationId })
  if (existing.isErr()) throw existing.error
  let accounts = existing.value

  const ensureAccount = async (name: string, last4: string, glAccountCode: string) => {
    const found = accounts.find((account) => account.last4 === last4)
    if (found) {
      // An account another slot's script created may carry no mapping, and an
      // unmapped account is exactly what refuses every code with "there is
      // nothing to credit". Map it rather than leaving the drive half-run.
      if (found.glAccountCode) return found
      const mapped = await updateBankAccount(database, {
        organizationId,
        actorUserId,
        bankAccountId: found.id,
        glAccountCode,
      })
      if (mapped.isErr()) throw mapped.error
      accounts = accounts.map((account) => (account.id === found.id ? mapped.value : account))
      return mapped.value
    }
    const created = await createBankAccount(database, {
      organizationId,
      actorUserId,
      name,
      institution: name.split(' ')[0],
      last4,
      type: 'depository',
      glAccountCode,
      feedStartDate: day(-30),
    })
    if (created.isErr()) throw created.error
    accounts = [...accounts, created.value]
    return created.value
  }

  const primary = await ensureAccount('Bank of America Business Adv', '5381', '1000')
  const savings = await ensureAccount('Wells Fargo Savings', '6670', '1010')
  console.log(
    `RESULT accounts primary=${primary.id}(${primary.glAccountCode}) savings=${savings.id}(${savings.glAccountCode})`
  )

  // ── 2. Statement lines ───────────────────────────────────────────────────
  const defId = await getCachedEntityDefId(organizationId, 'bank_transaction')
  if (!defId) throw new Error('this org has no bank_transaction def (entity migration 125)')
  const bankAccountDefId = await getCachedEntityDefId(organizationId, 'bank_account')
  if (!bankAccountDefId) throw new Error('this org has no bank_account def')

  const deposits = await listBankDeposits(database, { organizationId })
  if (deposits.isErr()) throw deposits.error
  const deposit = deposits.value.find((row) => !row.bankTransactionId) ?? deposits.value[0]

  const [vendorPaymentTxn] = await database
    .select({ id: schema.PaymentTransaction.id, amount: schema.PaymentTransaction.amount })
    .from(schema.PaymentTransaction)
    .where(
      and(
        eq(schema.PaymentTransaction.organizationId, organizationId),
        eq(schema.PaymentTransaction.kind, 'charge'),
        eq(schema.PaymentTransaction.status, 'succeeded')
      )
    )
    .limit(1)

  const seeds = [
    {
      externalId: 'drv-fee-001',
      account: toRecordId(bankAccountDefId, primary.id),
      postedAt: day(-2),
      description: 'MONTHLY MAINTENANCE FEE',
      amountMinor: -3_500,
    },
    {
      externalId: 'drv-dep-001',
      account: toRecordId(bankAccountDefId, primary.id),
      postedAt: deposit?.depositDate ?? day(-1),
      description: 'DEPOSIT BRANCH 0042',
      amountMinor: deposit?.totalMinor ?? 17_000,
    },
    {
      externalId: 'drv-pmt-001',
      account: toRecordId(bankAccountDefId, primary.id),
      postedAt: day(-1),
      description: 'ACH CREDIT CUSTOMER PAYMENT',
      amountMinor: vendorPaymentTxn?.amount ?? 10_000,
    },
    {
      externalId: 'drv-xfer-out',
      account: toRecordId(bankAccountDefId, primary.id),
      postedAt: day(-3),
      description: 'ONLINE TRANSFER TO SAVINGS',
      amountMinor: -250_000,
    },
    {
      externalId: 'drv-xfer-in',
      account: toRecordId(bankAccountDefId, savings.id),
      postedAt: day(-3),
      description: 'ONLINE TRANSFER FROM CHECKING',
      amountMinor: 250_000,
    },
    {
      externalId: 'drv-junk-001',
      account: toRecordId(bankAccountDefId, primary.id),
      postedAt: day(-4),
      description: 'STARBUCKS #4412 PERSONAL',
      amountMinor: -1_275,
    },
  ]

  const crud = new UnifiedCrudHandler(organizationId, actorUserId, database)
  const seeded: Record<string, string> = {}
  for (const seed of seeds) {
    const found = await findByExternalId(organizationId, defId, seed.externalId)
    if (found) {
      // Re-runnable: heal the account link on a row an earlier run left bare.
      await crud.update(toRecordId(defId, found), {
        bank_transaction_bank_account: seed.account,
      })
      seeded[seed.externalId] = found
      continue
    }
    const created = await crud.create(defId, {
      bank_transaction_external_id: seed.externalId,
      // 🛑 A RELATIONSHIP takes a RECORD id (`<defId>:<instanceId>`), never a
      // bare instance id: a bare id is accepted and silently written as nothing,
      // which leaves the line on no account at all.
      bank_transaction_bank_account: seed.account,
      bank_transaction_posted_at: seed.postedAt,
      bank_transaction_description: seed.description,
      bank_transaction_amount: seed.amountMinor,
      bank_transaction_bank_status: 'posted',
      bank_transaction_match_key: seed.description
        .toLowerCase()
        .replace(/[0-9#]+/g, '')
        .trim(),
      bank_transaction_source: 'import',
      bank_transaction_review_status: 'for_review',
    })
    seeded[seed.externalId] = created.instance.id
  }
  console.log(`RESULT seeded=${Object.keys(seeded).length} lines`)

  // ── 2b. Put every seeded line back in the queue, so a re-run walks the
  //        whole ladder rather than tripping over its own last pass ─────────
  for (const id of Object.values(seeded)) {
    const reset = await undoReview(database, { organizationId, actorUserId, transactionId: id })
    if (reset.isOk() && reset.value.warnings.length > 0) {
      console.log(`RESULT reset ${id}: ${reset.value.warnings[0]}`)
    }
  }

  // ── 3. The queue and its stats ───────────────────────────────────────────
  const queue = await listForReview(database, { organizationId, state: 'for_review' })
  if (queue.isErr()) throw queue.error
  console.log(`RESULT queue=${queue.value.length} for review`)

  const stats = await readQueueStats(database, { organizationId, bankAccountId: primary.id })
  if (stats.isErr()) throw stats.error
  console.log(
    `RESULT stats forReview=${stats.value.forReviewCount} oldest=${stats.value.oldestUnreviewedDate} ` +
      `in=${stats.value.unreviewedInMinor} out=${stats.value.unreviewedOutMinor} ` +
      `coverageFrom=${stats.value.coverageFrom} gaps=${stats.value.coverageGapCount}`
  )

  // ── 4. MATCH - and prove it posted nothing ───────────────────────────────
  const depositLineId = seeded['drv-dep-001']
  if (depositLineId) {
    const candidates = await listMatchCandidates(database, {
      organizationId,
      transactionId: depositLineId,
    })
    if (candidates.isErr()) throw candidates.error
    console.log(
      `RESULT candidates=${candidates.value
        .map(
          (c) =>
            `${c.recordType}:${c.label}@${c.amountMinor}/${c.score}/taken=${c.matchedToBankTransactionId ?? 'no'}`
        )
        .join(' ')}`
    )
    const target = candidates.value.find(
      (c) => c.recordType === 'bank_deposit' && !c.matchedToBankTransactionId
    )
    if (target) {
      const matched = await matchTransaction(database, {
        organizationId,
        actorUserId,
        transactionId: depositLineId,
        recordType: target.recordType,
        recordId: target.recordId,
      })
      console.log(
        matched.isErr()
          ? `RESULT match=REFUSED ${matched.error.message}`
          : `RESULT match=${matched.value.transaction.reviewStatus} post=${matched.value.post === null ? 'null (B5 - nothing posted)' : 'POSTED, WRONG'}`
      )
    } else {
      console.log('RESULT match=no unmatched deposit candidate in the window')
    }
  }

  // ── 5. CODE ──────────────────────────────────────────────────────────────
  const feeLineId = seeded['drv-fee-001']
  if (feeLineId) {
    const coded = await codeTransaction(database, {
      organizationId,
      actorUserId,
      transactionId: feeLineId,
      glAccountCode: '6100',
      memo: 'Monthly maintenance fee',
    })
    console.log(
      coded.isErr()
        ? `RESULT code=REFUSED ${coded.error.message}`
        : `RESULT code=${coded.value.transaction.reviewStatus} post=${coded.value.post?.status} doc=${coded.value.post?.docNumber ?? ''} ${coded.value.post?.error ?? ''}`
    )

    // The same line again: a posted line is corrected by reversing, never re-coded.
    const again = await codeTransaction(database, {
      organizationId,
      actorUserId,
      transactionId: feeLineId,
      glAccountCode: '6100',
    })
    console.log(`RESULT recode=${again.isErr() ? again.error.message : 'NOT REFUSED'}`)
  }

  // ── 6. TRANSFER - one entry for two legs ─────────────────────────────────
  const transferOutId = seeded['drv-xfer-out']
  if (transferOutId) {
    const moved = await transferTransaction(database, {
      organizationId,
      actorUserId,
      transactionId: transferOutId,
      counterpartBankAccountId: savings.id,
    })
    console.log(
      moved.isErr()
        ? `RESULT transfer=REFUSED ${moved.error.message}`
        : `RESULT transfer=${moved.value.transaction.reviewStatus} post=${moved.value.post?.status} doc=${moved.value.post?.docNumber ?? ''} warnings=${moved.value.warnings.length}`
    )
    const otherLeg = seeded['drv-xfer-in']
    if (otherLeg) {
      const rows = await listForReview(database, { organizationId, state: 'all', limit: 500 })
      if (rows.isOk()) {
        const leg = rows.value.find((row) => row.id === otherLeg)
        console.log(
          `RESULT transfer other leg=${leg?.reviewStatus} matchedTo=${leg?.matchedRecordId} posting=${leg?.glPostingId ?? 'none (one event, one entry)'}`
        )
      }
    }
  }

  // ── 7. EXCLUDE ───────────────────────────────────────────────────────────
  const junkLineId = seeded['drv-junk-001']
  if (junkLineId) {
    const blank = await excludeTransaction(database, {
      organizationId,
      actorUserId,
      transactionId: junkLineId,
      reason: '   ',
    })
    console.log(
      `RESULT exclude blank reason=${blank.isErr() ? blank.error.message : 'NOT REFUSED'}`
    )

    const excluded = await excludeTransaction(database, {
      organizationId,
      actorUserId,
      transactionId: junkLineId,
      reason: 'Personal coffee on the company card, reimbursed separately',
    })
    console.log(
      excluded.isErr()
        ? `RESULT exclude=REFUSED ${excluded.error.message}`
        : `RESULT exclude=${excluded.value.transaction.reviewStatus} post=${excluded.value.post === null ? 'null' : 'POSTED, WRONG'}`
    )
  }

  // ── 8. UNDO the coded line, which reverses its posting ───────────────────
  if (feeLineId) {
    const history = await readHistory(database, { organizationId, transactionId: feeLineId })
    if (history.isOk()) {
      console.log(
        `RESULT history=${history.value.map((row) => `${row.kind}:${row.detail ?? ''}`).join(' | ')}`
      )
    }
    const undone = await undoReview(database, {
      organizationId,
      actorUserId,
      transactionId: feeLineId,
    })
    console.log(
      undone.isErr()
        ? `RESULT undo=REFUSED ${undone.error.message}`
        : `RESULT undo=${undone.value.transaction.reviewStatus} reversal=${undone.value.post?.status} account=${undone.value.transaction.glAccountCode ?? 'cleared'}`
    )
    // Re-code it, so the org is left with a coded line to look at in the browser.
    const recoded = await codeTransaction(database, {
      organizationId,
      actorUserId,
      transactionId: feeLineId,
      glAccountCode: '6100',
      memo: 'Monthly maintenance fee',
    })
    console.log(
      `RESULT recode-after-undo=${recoded.isErr() ? recoded.error.message : recoded.value.post?.status}`
    )
  }

  // ── 9. The books ─────────────────────────────────────────────────────────
  const postings = await database
    .select({
      docNumber: schema.GlPosting.docNumber,
      postingType: schema.GlPosting.postingType,
      status: schema.GlPosting.status,
      txnDate: schema.GlPosting.txnDate,
      totalMinor: schema.GlPosting.totalMinor,
    })
    .from(schema.GlPosting)
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        eq(schema.GlPosting.postingType, 'bank_transaction')
      )
    )
  for (const posting of postings) {
    console.log(
      `RESULT posting ${posting.docNumber} ${posting.postingType} ${posting.status} ${posting.txnDate} ${posting.totalMinor}`
    )
  }

  const balance = await verifyBooksBalance(database, organizationId)
  console.log(`RESULT booksBalance=${JSON.stringify(balance)}`)
}

/** One `bank_transaction` by its external id, so the script is re-runnable. */
async function findByExternalId(
  organizationId: string,
  defId: string,
  externalId: string
): Promise<string | null> {
  const [field] = await database
    .select({ id: schema.CustomField.id })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, defId),
        eq(schema.CustomField.systemAttribute, 'bank_transaction_external_id')
      )
    )
    .limit(1)
  if (!field) return null
  const [value] = await database
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.FieldValue.entityId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, field.id),
        eq(schema.FieldValue.valueText, externalId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)
  return value?.entityId ?? null
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => closePools())
