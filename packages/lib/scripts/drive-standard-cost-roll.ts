// packages/lib/scripts/drive-standard-cost-roll.ts
//
// Preview the org-wide standard cost roll against a real organization.
//
// PERSISTS NOTHING - `previewStandardCostRoll` is the same read the Settings >
// Accounting > General panel makes, and it writes no field value and claims no
// period. It exists because the Next dev server caches its compiled copy of
// `@auxx/lib/dist`, so a lib change cannot always be seen in a browser without
// restarting the whole turbo run.
//
//   npx dotenv -- npx tsx packages/lib/scripts/drive-standard-cost-roll.ts <orgId>

import { database as db } from '@auxx/database'
import { skipReasonLabel } from '../src/builds/client'
import { previewStandardCostRoll } from '../src/builds/standard-cost-queries'

const ORG = process.argv[2] ?? ''

if (!ORG) {
  console.error('usage: drive-standard-cost-roll.ts <organizationId>')
  process.exit(1)
}

const money = (cents: number | null | undefined) =>
  cents == null ? '-' : `$${(cents / 100).toFixed(2)}`

async function main() {
  const result = await previewStandardCostRoll(db, ORG, { effectiveAt: new Date() })

  if (result.isErr()) {
    console.log(`REFUSED  ${result.error.message}`)
    process.exit(0)
  }

  const plan = result.value
  console.log(`\nwould revalue ${plan.lines.length} part(s)`)
  for (const line of plan.lines.slice(0, 12)) {
    console.log(
      `  ${line.partName ?? line.partId}  ${money(line.previousStandardCost)} -> ${money(line.standardCost)}`
    )
  }
  if (plan.lines.length > 12) console.log(`  ... and ${plan.lines.length - 12} more`)

  console.log(`\nskipped ${plan.skipped.length} part(s), written as nothing`)
  const byReason = new Map<string, number>()
  for (const s of plan.skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1)
  for (const [reason, count] of byReason) console.log(`  ${count}x ${reason}`)

  const blocked = plan.skipped.filter((s) => s.reason === 'component-not-valuable')
  if (blocked.length > 0) {
    console.log(`\nblocked by a component with no price:`)
    for (const s of blocked.slice(0, 12)) {
      console.log(`  ${s.partName ?? s.partId}  -  ${skipReasonLabel(s)}`)
    }
    if (blocked.length > 12) console.log(`  ... and ${blocked.length - 12} more`)

    const roots = [...new Set(blocked.map((s) => s.blockedByPartName ?? '(unnamed)'))]
    console.log(`\nthe ${roots.length} part(s) to go price:`)
    for (const r of roots) console.log(`  ${r}`)
  }

  console.log(`\ninventory revaluation: ${money(plan.revaluationDelta)}`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
