// packages/lib/scripts/spike-quickbooks-balance-sheet.ts
//
// DEV-ONLY spike for plans/accounting/tasks/19-opening-balances-from-the-provider.md §3.1.
//
// Calls the QuickBooks app's `get_quickbooks_balance_sheet` tool for one org
// through the same installation -> deployment -> connection -> Lambda chain the
// accounting provider uses, and prints the RAW report JSON. The point is to
// learn the real response shape (does an account row's `ColData[0]` carry the
// `Account.Id`? how do Summary and Header rows nest? how are negatives
// rendered?) before a mapper is written against it.
//
//   npx dotenv -- npx tsx packages/lib/scripts/spike-quickbooks-balance-sheet.ts <orgId> <YYYY-MM-DD> [Accrual|Cash] [startDate]
//
// Read-only. Nothing is written anywhere. Requires the tool to have been
// `sync-dev`ed to the org first (the apps repo), or the Lambda answers with an
// unknown-tool error. The JSON is printed on stdout after the logger's boot
// lines; the report starts at the first line that is exactly `{`.

import { resolveQuickbooksContext } from '../src/money/quickbooks/invoke-quickbooks-tool'

const [orgId, asOf, method = 'Accrual', startDate] = process.argv.slice(2)

if (!orgId || !asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
  console.error(
    'Usage: spike-quickbooks-balance-sheet.ts <orgId> <YYYY-MM-DD> [Accrual|Cash] [startDate]'
  )
  process.exit(1)
}

async function main() {
  const resolved = await resolveQuickbooksContext({ organizationId: orgId as string })
  if (!resolved.connected) {
    console.error(`Org ${orgId} has no usable QuickBooks installation, deployment or connection.`)
    process.exit(1)
  }

  const started = Date.now()
  const result = await resolved.context.callTool('get_quickbooks_balance_sheet', {
    asOf,
    accountingMethod: method,
    ...(startDate ? { startDate } : {}),
  })
  const ms = Date.now() - started

  console.log(JSON.stringify(result, null, 2))
  console.error(`\nrealm ${resolved.context.realmId ?? '?'}, as_of ${asOf}, ${method}, ${ms}ms`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
