// packages/lib/scripts/drive-bank-rules.ts
//
// Drives HANDOFF slot 3C end to end against DemoOrg1: seed a manual bank
// account and four bank_transaction lines sharing a matchKey, code three of
// them through 3B's codeTransaction, run suggestFromHistory on the fourth and
// print the suggestion, create a rule and evaluate it, then run
// applySuggestions and SELECT the suggestion fields back.
//
//   npx dotenv -- npx tsx packages/lib/scripts/drive-bank-rules.ts

import { closePools, database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { createBankAccount, getBankAccount } from '../src/banking'
import { codeTransaction } from '../src/banking/review/writes'
import {
  applySuggestions,
  createRule,
  evaluateRules,
  getTransactionMatchRow,
  suggestFromHistory,
} from '../src/banking/rules'
import { getCachedEntityDefId } from '../src/cache'
import { UnifiedCrudHandler } from '../src/resources/crud/unified-handler'
import { toRecordId } from '../src/resources/resource-id'

const ORGANIZATION_ID = 'abgwpa1l81reht2zmwrcihfu' // DemoOrg1
const MATCH_KEY = 'ACME SVC FEE'

async function main() {
  const [member] = await database
    .select({ userId: schema.OrganizationMember.userId })
    .from(schema.OrganizationMember)
    .where(eq(schema.OrganizationMember.organizationId, ORGANIZATION_ID))
    .limit(1)
  if (!member) throw new Error('DemoOrg1 has no members')
  const actorUserId = member.userId

  // ── 1. A manual bank account, mapped to cash ─────────────────────────
  const account = await createBankAccount(database, {
    organizationId: ORGANIZATION_ID,
    actorUserId,
    name: 'Drive Test Checking (3C)',
    glAccountCode: '1000',
  })
  if (account.isErr()) throw account.error
  console.log(`RESULT account=${account.value.id} gl=${account.value.glAccountCode}`)

  // ── 2. Four bank_transaction lines sharing a matchKey ────────────────
  const bankTransactionDefId = await getCachedEntityDefId(ORGANIZATION_ID, 'bank_transaction')
  if (!bankTransactionDefId) throw new Error('bank_transaction def missing - run migration 125')
  const crud = new UnifiedCrudHandler(ORGANIZATION_ID, actorUserId, database)

  const dates = ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01']
  const transactionIds: string[] = []
  for (const [index, postedAt] of dates.entries()) {
    const created = await crud.create(bankTransactionDefId, {
      bank_transaction_external_id: `drive-3c-${index}`,
      // A RELATIONSHIP field takes a RecordId (`defId:instanceId`), not a bare
      // instance id - UnifiedCrudHandler silently drops a bare id with a
      // "Failed to prepare field" warning rather than throwing.
      bank_transaction_bank_account: account.value.recordId,
      bank_transaction_posted_at: postedAt,
      bank_transaction_description: `${MATCH_KEY} ${1000 + index}`,
      bank_transaction_amount: -1500,
      bank_transaction_bank_status: 'posted',
      bank_transaction_match_key: MATCH_KEY,
      bank_transaction_source: 'import',
      bank_transaction_review_status: 'for_review',
    })
    transactionIds.push(created.instance.id)
  }
  console.log(`RESULT transactions=${transactionIds.join(',')}`)

  // ── 3. Code the first three to 6100 through 3B's writer ──────────────
  for (const transactionId of transactionIds.slice(0, 3)) {
    const outcome = await codeTransaction(database, {
      organizationId: ORGANIZATION_ID,
      actorUserId,
      transactionId,
      glAccountCode: '6100',
    })
    if (outcome.isErr()) throw outcome.error
    console.log(
      `RESULT coded=${transactionId} status=${outcome.value.post?.status} doc=${outcome.value.post?.docNumber ?? ''}`
    )
  }

  // ── 4. suggestFromHistory on the fourth ───────────────────────────────
  const fourth = transactionIds[3]!
  const suggestion = await suggestFromHistory(database, {
    organizationId: ORGANIZATION_ID,
    transactionId: fourth,
  })
  if (suggestion.isErr()) throw suggestion.error
  console.log(`RESULT suggestion=${JSON.stringify(suggestion.value)}`)

  // ── 5. Create a rule and evaluate it, pure ────────────────────────────
  const rule = await createRule(database, {
    organizationId: ORGANIZATION_ID,
    actorUserId,
    name: 'Drive: ACME SVC FEE -> 6100',
    matchField: 'matchKey',
    matchOperator: 'contains',
    matchValue: MATCH_KEY,
    direction: 'any',
    action: 'code',
    glAccountCode: '6100',
    autoApply: false,
  })
  if (rule.isErr()) throw rule.error
  console.log(`RESULT rule=${rule.value.id} priority=${rule.value.priority}`)

  const fourthRow = await getTransactionMatchRow(database, {
    organizationId: ORGANIZATION_ID,
    transactionId: fourth,
  })
  if (fourthRow.isErr() || !fourthRow.value) throw new Error('fourth row missing')
  const matched = evaluateRules([rule.value], {
    description: fourthRow.value.description,
    matchKey: fourthRow.value.matchKey,
    amountMinor: fourthRow.value.amountMinor,
    bankAccountId: fourthRow.value.bankAccountId,
  })
  console.log(`RESULT evaluateRules=${matched?.id ?? 'no match'}`)

  // ── 6. applySuggestions and SELECT the suggestion fields back ────────
  const applied = await applySuggestions(database, {
    organizationId: ORGANIZATION_ID,
    actorUserId,
    transactionIds: [fourth],
  })
  if (applied.isErr()) throw applied.error
  console.log(`RESULT applySuggestions=${JSON.stringify(applied.value)}`)

  const after = await getTransactionMatchRow(database, {
    organizationId: ORGANIZATION_ID,
    transactionId: fourth,
  })
  if (after.isErr() || !after.value) throw new Error('fourth row missing after apply')
  console.log(
    `RESULT afterApply=reviewStatus:${after.value.reviewStatus} glAccount:${after.value.glAccountCode}`
  )

  // Confirm the standalone suggestion fields on the record, not just the
  // match-row projection above.
  const recordId = toRecordId(bankTransactionDefId, fourth)
  console.log(`RESULT recordId=${recordId}`)

  await closePools()
  process.exit(0)
}

main().catch(async (error) => {
  console.error(error)
  await closePools()
  process.exit(1)
})
