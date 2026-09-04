// packages/lib/scripts/drive-aging.ts
//
// Drives slot 2H's aging read against a real org (HANDOFF §7 "Drive it"):
// prints both A/R and A/P aging for DemoOrg1 as of today, and the verdict
// against the balance sheet's own figure for each role.
//
//   npx dotenv -- npx tsx packages/lib/scripts/drive-aging.ts

import { closePools, database } from '@auxx/database'
import { readAging } from '../src/postings/reports/aging'

// DemoOrg1, owner markus@auxx.ai (HANDOFF §9a). Has a write-off against
// INV-0005 and may carry fulfillment postings from another slot.
const ORG_ID = 'abgwpa1l81reht2zmwrcihfu'

function asOfToday(): string {
  return new Date().toISOString().slice(0, 10)
}

async function main() {
  const asOf = asOfToday()
  console.log(`Aging for ${ORG_ID} as of ${asOf}\n`)

  for (const side of ['receivable', 'payable'] as const) {
    const result = await readAging(database, { organizationId: ORG_ID, side, asOf })
    if (result.isErr()) {
      console.error(`readAging(${side}) errored:`, result.error)
      continue
    }
    const aging = result.value
    console.log(
      `── ${side === 'receivable' ? 'A/R' : 'A/P'} aging (account ${aging.accountCode ?? 'unmapped'}) ──`
    )
    for (const group of aging.groups) {
      console.log(`  ${group.groupName} (${group.groupId}): total ${group.totalMinor}`)
      for (const doc of group.documents) {
        console.log(
          `    ${doc.sourceType}:${doc.sourceId} ${doc.label} due=${doc.dueDate ?? 'none'} ` +
            `bucket=${doc.bucket} open=${doc.openMinor}${doc.badge ? ` badge=${doc.badge}` : ''}`
        )
      }
    }
    console.log(`  Total: ${aging.totalMinor}`)
    console.log(`  Balance sheet figure: ${aging.balanceSheetMinor}`)
    console.log(`  Verdict: ${aging.verdict ? 'TIES' : `OFF by ${aging.differenceMinor}`}\n`)
  }

  await closePools()
  process.exit(0)
}

main().catch(async (error) => {
  console.error(error)
  await closePools()
  process.exit(1)
})
