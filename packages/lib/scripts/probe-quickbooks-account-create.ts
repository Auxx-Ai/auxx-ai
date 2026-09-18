// packages/lib/scripts/probe-quickbooks-account-create.ts
//
// DEV-ONLY spike for the chart PUSH direction (handoff 2026-09-10 §8.7 item 1).
//
// The seam is pull-only today: `importChartFromProvider` brings QuickBooks'
// chart into ours and `setAccountIdentity` links a pair that already exists on
// both sides. Nothing can create an account IN QuickBooks - which is exactly
// why DemoOrg1's 26 unlinked accounts are stuck, because they are the ones
// auxx created and the sandbox has no counterpart to match.
//
// Before building the push (a provider method, a type mapping table, a row
// button), three facts have to come from the API rather than from Intuit's
// documentation:
//
//   1. Does `AcctNum` STICK? QuickBooks stores account numbers only when the
//      company has them enabled. With them off it takes the create and drops
//      the number silently - no fault - and every later match degrades to
//      names forever. If that is what the sandbox does, the push has to say so
//      in the UI rather than pretend the code landed.
//
//   2. Is `AccountSubType` required, or does `AccountType` alone do? This
//      decides whether the outbound mapping table needs one column or two, and
//      it is the whole of brief 16.8's question asked from the other side.
//
//      ANSWERED 2026-09-10: type alone is accepted and Intuit then picks a
//      subtype of its own - an `Other Current Asset` came back as
//      `EmployeeCashAdvances`. So the answer is two columns, for a reason the
//      question did not anticipate: not that the API demands a subtype, but
//      that the one it invents is arbitrary and is what QBO's own reports
//      group by.
//
//   3. What does a DUPLICATE name return? The reuse-before-create guard in
//      `create_quickbooks_account` exists to never reach this, but the fault
//      it would have produced is what tells us the guard is the right shape.
//
// 🛑 THIS WRITES. Every arm creates a real account in the sandbox company, and
// QuickBooks does not let you DELETE an account - only deactivate it. Each one
// is named `AUXX PROBE <stamp> …` so it is obvious in the chart, and the
// cleanup is Accounting > Chart of accounts > Make inactive, by hand.
//
// It refuses to run without --confirm.
//
//   pnpm exec turbo dev --filter=@auxx/lambda     # must be up: the tool call
//                                                 # leaves the machine via 3008
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/probe-quickbooks-account-create.ts <orgId> --confirm
//
// Delete this script with the other spike tooling once the push is built.

import { resolveQuickbooksContext } from '../src/accounting/providers/quickbooks/invoke-quickbooks-tool'

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const [orgId] = argv.filter((a) => !a.startsWith('--'))

if (!orgId) {
  console.error('Usage: probe-quickbooks-account-create.ts <orgId> --confirm')
  process.exit(1)
}

if (!flags.has('--confirm')) {
  console.error(
    `Would CREATE up to three accounts in org ${orgId}'s QuickBooks company.\n` +
      'QuickBooks cannot delete an account - the cleanup is deactivating them by hand.\n' +
      'Re-run with --confirm.'
  )
  process.exit(1)
}

/** Minutes, so two runs on the same day do not collide on a name. */
const STAMP = new Date().toISOString().slice(2, 16).replace(/[-:T]/g, '')

/**
 * A number far outside any chart auxx seeds, so a collision with a real account
 * is not possible and the answer to question 1 is unambiguous.
 */
const PROBE_ACCT_NUM = '9911'

interface ToolAccount {
  id: string
  name: string
  fullyQualifiedName: string
  acctNum: string | null
  accountType: string
  accountSubType: string | null
  classification: string
  active: boolean
}

interface CreateResult {
  account: ToolAccount
  outcome: 'created' | 'existing'
  matchedOn: string | null
  acctNumDropped: boolean
}

type CallTool = (toolId: string, inputs: Record<string, unknown>) => Promise<any>

function describe(account: ToolAccount): string {
  return (
    `id ${account.id} | acctNum ${account.acctNum ?? 'NULL'} | ` +
    `${account.accountType} / ${account.accountSubType ?? 'NULL'} | ` +
    `${account.classification} | ${account.name}`
  )
}

/**
 * 🛑 A transport failure is NOT an answer. Recording "Intuit refuses X" when
 * the truth is that nothing was listening on port 3008 is worse than recording
 * nothing - it is the one distinction this probe exists to keep straight.
 */
function isTransport(error: any): boolean {
  const message = error?.message ?? ''
  return (
    error?.code === 'LAMBDA_INVOCATION_ERROR' ||
    /ECONNREFUSED|fetch failed|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(message)
  )
}

function reportFault(label: string, error: any): void {
  if (isTransport(error)) {
    console.log(`\n⚪ ${label}: INCONCLUSIVE - the request never reached QuickBooks.`)
    console.log('   message:', error?.message)
    console.log('   Start the Lambda host and re-run: pnpm exec turbo dev --filter=@auxx/lambda')
    process.exitCode = 2
    return
  }
  console.log(`\n🔴 ${label}: QuickBooks returned a fault.`)
  console.log('   message:', error?.message)
  console.log('   code   :', error?.code)
  console.log('   fault  :', JSON.stringify(error?.fault ?? error?.cause ?? null, null, 2))
}

/** Question 1 + 2a: type AND subtype together, with a number. The happy path. */
async function probeFullySpecified(callTool: CallTool): Promise<ToolAccount | null> {
  const name = `AUXX PROBE ${STAMP} Full`
  console.log('\n── 1. AccountType + AccountSubType + AcctNum ' + '─'.repeat(30))
  try {
    const result: CreateResult = await callTool('create_quickbooks_account', {
      name,
      acctNum: PROBE_ACCT_NUM,
      accountType: 'Other Current Asset',
      accountSubType: 'OtherCurrentAssets',
      description: 'auxx chart-push probe - DEACTIVATE ME',
      reuseExisting: false,
    })
    console.log(`   ${result.outcome}: ${describe(result.account)}`)
    console.log(
      result.acctNumDropped
        ? `\n   🔴 ANSWER 1: AcctNum was DROPPED. This company has account numbers OFF.\n` +
            '      A pushed account can never be matched by number. The push must link by\n' +
            '      id at creation time and the UI must not promise the code carried over.'
        : `\n   ✅ ANSWER 1: AcctNum STUCK as '${result.account.acctNum}'. Account numbers are on.`
    )
    return result.account
  } catch (error) {
    reportFault('1. Fully specified', error)
    return null
  }
}

/** Question 2b: does AccountType alone work, and what subtype does Intuit infer? */
async function probeTypeOnly(callTool: CallTool): Promise<void> {
  const name = `AUXX PROBE ${STAMP} TypeOnly`
  console.log('\n── 2. AccountType alone, no AccountSubType ' + '─'.repeat(32))
  try {
    const result: CreateResult = await callTool('create_quickbooks_account', {
      name,
      accountType: 'Other Current Asset',
      description: 'auxx chart-push probe - DEACTIVATE ME',
      reuseExisting: false,
    })
    console.log(`   ${result.outcome}: ${describe(result.account)}`)
    console.log(
      `\n   ⚠️  ANSWER 2: AccountType alone is ACCEPTED, but Intuit INVENTS a subtype -\n` +
        `      it filed this one under '${result.account.accountSubType ?? 'NULL'}'.\n` +
        '      Accepted is not the same as correct: the subtype is what QuickBooks\n' +
        '      groups by in its own reports, so a clearing account left to the default\n' +
        '      lands somewhere nobody chose. The outbound table must send BOTH columns.'
    )
  } catch (error) {
    reportFault('2. Type only', error)
    console.log(
      '\n   ANSWER 2 (if the fault above names AccountSubType): a subtype is REQUIRED,\n' +
        '      so the outbound table must carry one for all five classifications.'
    )
  }
}

/** Question 3: what a duplicate name returns, with the reuse guard turned off. */
async function probeDuplicate(callTool: CallTool, first: ToolAccount): Promise<void> {
  console.log('\n── 3. The same name again, reuseExisting: false ' + '─'.repeat(28))
  try {
    const result: CreateResult = await callTool('create_quickbooks_account', {
      name: first.name,
      accountType: 'Other Current Asset',
      accountSubType: 'OtherCurrentAssets',
      reuseExisting: false,
    })
    console.log(`   ${result.outcome}: ${describe(result.account)}`)
    console.log(
      `\n   🔴 ANSWER 3: QuickBooks ACCEPTED a second account named '${first.name}'\n` +
        `      (id ${result.account.id} beside id ${first.id}). Nothing on Intuit's side\n` +
        '      stops a duplicate, so reuse-before-create is the ONLY guard there is.'
    )
  } catch (error) {
    reportFault('3. Duplicate name', error)
    if (!isTransport(error)) {
      console.log(
        '\n   ✅ ANSWER 3: QuickBooks REFUSES a duplicate name. The reuse guard turns\n' +
          '      that fault into a link, which is the outcome the screen wants anyway.'
      )
    }
  }
}

/** Question 4, free: does the reuse guard find what arm 1 just created? */
async function probeReuse(callTool: CallTool, first: ToolAccount): Promise<void> {
  console.log('\n── 4. The same name again, reuse guard ON (the real path) ' + '─'.repeat(18))
  try {
    const result: CreateResult = await callTool('create_quickbooks_account', {
      name: first.name,
      acctNum: PROBE_ACCT_NUM,
      accountType: 'Other Current Asset',
      accountSubType: 'OtherCurrentAssets',
    })
    console.log(`   ${result.outcome} (matchedOn ${result.matchedOn}): ${describe(result.account)}`)
    console.log(
      result.outcome === 'existing' && result.account.id === first.id
        ? `\n   ✅ ANSWER 4: the guard held - it returned id ${first.id} and wrote nothing.`
        : '\n   🔴 ANSWER 4: the guard did NOT hold. It created another account. Fix that\n' +
            '      before any of this reaches a button.'
    )
  } catch (error) {
    reportFault('4. Reuse guard', error)
  }
}

async function main() {
  const resolved = await resolveQuickbooksContext({ organizationId: orgId as string })
  if (!resolved.connected) {
    console.error(`Org ${orgId} has no usable QuickBooks installation, deployment or connection.`)
    console.error('If the tool itself is missing, sync-dev the apps repo first:')
    console.error('  cd /Users/mklooth/Sites/auxxai-apps && pnpm sync-dev')
    process.exit(1)
  }

  const { callTool, realmId } = resolved.context
  const started = Date.now()
  console.log(`\nProbing realm ${realmId ?? '?'} for org ${orgId}. Stamp ${STAMP}.`)

  const first = await probeFullySpecified(callTool)
  await probeTypeOnly(callTool)
  if (first) {
    await probeDuplicate(callTool, first)
    await probeReuse(callTool, first)
  }

  console.log(
    `\n🛑 Accounts named 'AUXX PROBE ${STAMP} …' now exist in the sandbox chart.\n` +
      '   QuickBooks cannot delete an account. Deactivate them by hand:\n' +
      '   Accounting > Chart of accounts > the row > Make inactive.\n'
  )
  console.error(`realm ${realmId ?? '?'}, ${Date.now() - started}ms`)
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
