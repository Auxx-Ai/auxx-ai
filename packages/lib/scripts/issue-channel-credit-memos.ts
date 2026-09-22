// packages/lib/scripts/issue-channel-credit-memos.ts
//
// 🛑 WRITES. Issues a named list of draft credit memos, one at a time, through
// `issueCreditMemo` - the same door the drawer's Issue button uses. Each one
// posts a real `GlPosting` onto an append-only ledger and can only be undone by
// a void, never by an edit.
//
// The ids are passed in rather than discovered, deliberately: "every draft
// channel memo in January" is a query whose answer can change between the
// moment somebody reads it and the moment the script runs, and this writes to
// the ledger. Read the list first, then hand it over.
//
// A channel memo reverses revenue only for the lines its order's line items say had
// shipped by the memo's date (`readShippedMemoLineIds`, 91 D4).
//
//   npx dotenv -- npx tsx packages/lib/scripts/issue-channel-credit-memos.ts <organizationId> <id> [id...]

import { closePools, database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { issueCreditMemo } from '../src/accounting/sales/credit-memos'

async function main() {
  const [organizationId, ...creditMemoIds] = process.argv.slice(2)
  if (!organizationId || creditMemoIds.length === 0) {
    throw new Error('usage: issue-channel-credit-memos.ts <organizationId> <id> [id...]')
  }

  const [member] = await database
    .select({ userId: schema.OrganizationMember.userId })
    .from(schema.OrganizationMember)
    .where(eq(schema.OrganizationMember.organizationId, organizationId))
    .limit(1)
  if (!member) throw new Error('that organization has no members')

  console.log(`Issuing ${creditMemoIds.length} credit memo(s)\n`)

  let issued = 0
  let failed = 0

  // Serial, never `Promise.all`: each issue posts an entry and the doc-number
  // claim is keyed per memo, so a parallel burst buys nothing and makes a
  // partial failure much harder to read.
  for (const creditMemoInstanceId of creditMemoIds) {
    try {
      const result = await issueCreditMemo(database, {
        organizationId,
        userId: member.userId,
        creditMemoInstanceId,
      })
      issued++
      console.log(
        `  OK   ${creditMemoInstanceId} -> ${result.status} posting=${result.docNumber ?? '(none)'}`
      )
    } catch (error) {
      failed++
      console.log(`  FAIL ${creditMemoInstanceId}: ${(error as Error).message}`)
    }
  }

  console.log(`\nRESULT issued=${issued} failed=${failed}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(closePools)
