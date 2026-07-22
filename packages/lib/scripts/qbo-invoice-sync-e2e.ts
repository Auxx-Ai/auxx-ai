// packages/lib/scripts/qbo-invoice-sync-e2e.ts
//
// Throwaway e2e driver for QuickBooks invoice sync against the DemoOrg sandbox connection
// (plan 37e-quickbooks-invoice-sync.md, P3). Two phases so nothing writes to QBO until we've
// picked a valid income account:
//
//   list                         → resolve the QB Lambda context + list sandbox income accounts
//   sync <invoiceInstanceId> [incomeAccountId]
//                                → optionally set the default income account, then run the
//                                  orchestrator on one invoice and print the result
//
// Run (full dev must be up so the app Lambda runtime is reachable):
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/qbo-invoice-sync-e2e.ts list

import { onCacheEvent } from '../src/cache'
import { resolveQuickbooksContext } from '../src/money/quickbooks/invoke-quickbooks-tool'
import { syncInvoiceToQuickbooks } from '../src/money/quickbooks/sync-invoice'
import { getOrganizationSetting, updateOrganizationSetting } from '../src/settings/settings-service'

const ORG = 'abgwpa1l81reht2zmwrcihfu' // DemoOrg1

async function list() {
  const resolved = await resolveQuickbooksContext({ organizationId: ORG })
  if (!resolved.connected) {
    console.error('❌ QuickBooks not connected for org', ORG)
    return
  }
  console.log('✅ connected — realmId:', resolved.context.realmId)
  const out = await resolved.context.callTool('list_quickbooks_accounts', {})
  const accounts: Array<{
    id: string
    name: string
    accountType: string
    classification: string
    active: boolean
  }> = out.accounts ?? []
  const income = accounts.filter((a) => a.classification === 'Revenue' && a.active)
  console.log(`\nIncome (Revenue) accounts — ${income.length}:`)
  for (const a of income) {
    console.log(`  ${a.id.padEnd(6)}  ${a.name}  (${a.accountType})`)
  }
}

async function sync(invoiceInstanceId: string, incomeAccountId?: string) {
  if (incomeAccountId) {
    await updateOrganizationSetting({
      organizationId: ORG,
      key: 'quickbooks.defaultIncomeAccountId',
      value: incomeAccountId,
    })
    // The service only writes the DB; the tRPC router busts the cache separately.
    // Replicate that here so getOrganizationSetting reads fresh (not the stale Redis snapshot).
    await onCacheEvent('org.settings.changed', { orgId: ORG, broadcastUserKeys: true })
    console.log('set quickbooks.defaultIncomeAccountId =', incomeAccountId)
  }
  const acct = await getOrganizationSetting({
    organizationId: ORG,
    key: 'quickbooks.defaultIncomeAccountId',
  })
  console.log('default income account:', acct)
  console.log('syncing invoice', invoiceInstanceId, '...')
  const result = await syncInvoiceToQuickbooks({ organizationId: ORG, invoiceInstanceId })
  console.log('\nSYNC RESULT:', JSON.stringify(result, null, 2))
}

async function main() {
  const [cmd, arg1, arg2] = process.argv.slice(2)
  if (cmd === 'list') {
    await list()
  } else if (cmd === 'sync' && arg1) {
    await sync(arg1, arg2)
  } else {
    console.error(
      'usage: qbo-invoice-sync-e2e.ts list | sync <invoiceInstanceId> [incomeAccountId]'
    )
    process.exitCode = 1
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('SCRIPT ERROR:', err)
    process.exit(1)
  })
