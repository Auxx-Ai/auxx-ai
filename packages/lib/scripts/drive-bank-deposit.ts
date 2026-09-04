// packages/lib/scripts/drive-bank-deposit.ts
//
// Drives HANDOFF slot 1D end to end against a real org: group every undeposited
// cheque into one bank deposit, post `Dr cash Cr undeposited_funds`, then walk
// the refusal ladder and build the deposit slip payload.
//
// The sibling of `drive-journal-entry.ts`. Read-mostly except the deposit it
// records, which is real: it posts a `GlPosting`. Point it at a dev org.
//
//   npx dotenv -- npx tsx packages/lib/scripts/drive-bank-deposit.ts <organizationId>

import { closePools, database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { buildBankDepositPdfPayload } from '../src/documents/payload'
import {
  clearBankDeposit,
  createBankDeposit,
  getBankDeposit,
  listBankDeposits,
  listUndepositedPayments,
  updateBankDeposit,
} from '../src/money/bank-deposits'

async function main() {
  const organizationId = process.argv[2]
  if (!organizationId) throw new Error('usage: drive-bank-deposit.ts <organizationId>')

  const [member] = await database
    .select({ userId: schema.OrganizationMember.userId })
    .from(schema.OrganizationMember)
    .where(eq(schema.OrganizationMember.organizationId, organizationId))
    .limit(1)
  if (!member) throw new Error('that organization has no members')
  const actorUserId = member.userId

  const undeposited = await listUndepositedPayments(database, { organizationId })
  if (undeposited.isErr()) throw undeposited.error
  const cheques = undeposited.value.filter((row) => row.method === 'check')
  console.log(`RESULT undeposited=${undeposited.value.length} cheques=${cheques.length}`)
  if (cheques.length === 0) throw new Error('no undeposited cheques to group')

  const created = await createBankDeposit(database, {
    organizationId,
    actorUserId,
    paymentIds: cheques.map((c) => c.paymentId),
    depositDate: new Date().toISOString().slice(0, 10),
    bankAccountCode: '1000',
    reference: 'SLIP-DRIVE',
  })
  if (created.isErr()) throw created.error
  const { deposit, post } = created.value
  console.log(
    `RESULT created=${deposit.number} total=${deposit.totalMinor} post=${post.status} doc=${post.docNumber ?? ''} ${post.error ?? ''}`
  )

  const regroup = await createBankDeposit(database, {
    organizationId,
    actorUserId,
    paymentIds: cheques.map((c) => c.paymentId),
    depositDate: deposit.depositDate!,
    bankAccountCode: '1000',
  })
  console.log(`RESULT regroup=${regroup.isErr() ? regroup.error.message : 'NOT REFUSED'}`)

  const cleared = await clearBankDeposit(database, {
    organizationId,
    actorUserId,
    depositId: deposit.depositId,
    bankTransactionId: 'bt-drive-001',
  })
  console.log(`RESULT clear=${cleared.isOk() ? cleared.value.status : cleared.error.message}`)

  const edit = await updateBankDeposit(database, {
    organizationId,
    actorUserId,
    depositId: deposit.depositId,
    reference: 'SLIP-EDITED',
  })
  console.log(`RESULT editAfterClear=${edit.isErr() ? edit.error.message : 'NOT REFUSED'}`)

  const detail = await getBankDeposit(database, { organizationId, depositId: deposit.depositId })
  if (detail.isErr() || !detail.value) throw detail.isErr() ? detail.error : new Error('gone')
  const { payload } = await buildBankDepositPdfPayload({
    organizationId,
    userId: actorUserId,
    bankDepositRecordId: detail.value.recordId,
  })
  console.log(
    `RESULT slip=${payload.number} account=${payload.bankAccountCode} lines=${payload.lines.length} total=${payload.total}`
  )

  const list = await listBankDeposits(database, { organizationId })
  console.log(
    `RESULT deposits=${list.isOk() ? list.value.map((d) => `${d.number}:${d.status}:${d.totalMinor}`).join(',') : list.error.message}`
  )

  await closePools()
  process.exit(0)
}

main().catch(async (error) => {
  console.error(error)
  await closePools()
  process.exit(1)
})
