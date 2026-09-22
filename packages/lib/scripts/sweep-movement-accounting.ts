// packages/lib/scripts/sweep-movement-accounting.ts
//
// Run `sweepMovementAccounting` once, by hand, over one org with no limit —
// the recovery job caps at 100 per org per pass (`accounting-recovery-job.ts`),
// which takes many passes to re-read a large backlog after a fix like 78 F1/F2
// clears its refusal. Generic: reusable wherever a backlog needs one full pass
// (plan 79 G5).
//
// Run from the repo root:
//   npx dotenv -- npx tsx packages/lib/scripts/sweep-movement-accounting.ts --org <organizationId>

import { database } from '@auxx/database'
// Relative import on purpose — see the note in backfill-po-line-rollups.ts.
import { sweepMovementAccounting } from '../src/accounting/money/blocked-movements'

const ORG_ARG = (() => {
  const flagIndex = process.argv.indexOf('--org')
  return flagIndex === -1 ? undefined : process.argv[flagIndex + 1]
})()

async function main(): Promise<void> {
  if (!ORG_ARG) {
    console.error('usage: sweep-movement-accounting.ts --org <organizationId>')
    process.exit(1)
  }

  // The sweep clamps to 500 per call, so loop until a pass clears nothing; a refusal
  // reschedules its own work item, so it is not rescanned in the next pass.
  const total: Record<string, number> = {}
  for (;;) {
    const counts = await sweepMovementAccounting(database, {
      organizationId: ORG_ARG,
      limit: 500,
      timeBudgetMs: 5 * 60 * 1000,
    })
    for (const [key, value] of Object.entries(counts)) total[key] = (total[key] ?? 0) + value
    console.log(`org ${ORG_ARG}: pass`, counts)
    if (counts.scanned === 0 || counts.accepted === 0) break
  }
  console.log(`org ${ORG_ARG}: total`, total)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
