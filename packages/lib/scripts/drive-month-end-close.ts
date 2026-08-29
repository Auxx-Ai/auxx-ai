// packages/lib/scripts/drive-month-end-close.ts
//
// Drive the month-end close against a real organization, read-only.
//
// This is the data half of task 14's browser drive: it proves that
// `previewMonthEnd` reaches a real chart, a real role map and a real subledger
// and produces a balanced entry - which is the thing the console renders. It
// PERSISTS NOTHING. `previewEntry` claims no period and writes no row.
//
//   npx dotenv -- npx tsx packages/lib/scripts/drive-month-end-close.ts <orgId> [periodKey]
//
// With no periodKey it walks every month the console would offer and reports
// what each one answers, which is the same walk an operator does on day one.

import { database as db } from '@auxx/database'
import { listClosePeriods, previewMonthEnd } from '../src/postings'

const ORG = process.argv[2] ?? ''
const ONE_PERIOD = process.argv[3]

if (!ORG) {
  console.error('usage: drive-month-end-close.ts <organizationId> [periodKey]')
  process.exit(1)
}

function money(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '-'
  return `$${(minor / 100).toFixed(2)}`
}

async function main() {
  console.log(`\norganization ${ORG}\n`)

  const periods = await listClosePeriods(db, ORG)
  if (periods.isErr()) {
    console.error(`listClosePeriods refused: ${periods.error.message}`)
    process.exit(1)
  }

  const strip = periods.value
  console.log(`period strip: ${strip.length} month(s)`)
  for (const p of strip) {
    console.log(
      `  ${p.periodKey}  ${p.state.padEnd(7)} ${p.docNumber ?? ''} ${money(p.totalMinor)}`
    )
  }

  const targets: string[] = ONE_PERIOD ? [ONE_PERIOD] : strip.map((p) => p.periodKey)
  console.log(`\npreviewing ${targets.length} month(s)\n`)

  for (const periodKey of targets) {
    const preview = await previewMonthEnd(db, { organizationId: ORG, periodKey })

    if (preview.blockedBy) {
      console.log(`${periodKey}  REFUSED [${preview.blockedBy.status}]`)
      console.log(`          ${preview.blockedBy.error}`)
      continue
    }

    const debit = preview.lines
      .filter((l) => l.direction === 'debit')
      .reduce((sum, l) => sum + l.amount, 0)
    const credit = preview.lines
      .filter((l) => l.direction === 'credit')
      .reduce((sum, l) => sum + l.amount, 0)

    console.log(`${periodKey}  BUILDS  ${preview.docNumber}  total ${money(preview.totalMinor)}`)
    console.log(
      `          debits ${money(debit)}  credits ${money(credit)}  ${debit === credit ? 'BALANCED' : 'OUT OF BALANCE'}`
    )
    console.log(`          assertions: ${preview.assertions ? 'present' : 'MISSING'}`)
    for (const line of preview.lines) {
      console.log(
        `            ${line.direction.padEnd(6)} ${line.accountCode} ${(line.accountName ?? '').padEnd(32)} ${money(line.amount)}`
      )
    }
  }

  console.log('')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nthrew, which previewMonthEnd is not supposed to do:')
    console.error(error)
    process.exit(1)
  })
