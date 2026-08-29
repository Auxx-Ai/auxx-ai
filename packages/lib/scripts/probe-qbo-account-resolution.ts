// packages/lib/scripts/probe-qbo-account-resolution.ts
//
// Read-only probe: can this org's GL account codes be resolved to accounts in
// the connected accounting system?
//
// Under decision `G19` that question is answered by the ACCOUNT MAP - a person
// confirms once that one of our accounts IS one of theirs, and the mapping is
// stored in the `qboAccountId` cell on the `gl_account` instance. There is no
// matching at post time, so an unmapped account is the only reason a code fails
// to resolve. This walks the whole chart and reports which are mapped, which are
// merely suggested, and which have nothing.
//
// It WRITES NOTHING, to the provider or to the database.
//
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/probe-qbo-account-resolution.ts <orgId>

import { database as db } from '@auxx/database'
import {
  listAccountIdentities,
  registerAccountingProvider,
  setConnectedProviderResolver,
} from '../src/postings'

const ORG = process.argv[2] ?? ''
if (!ORG) {
  console.error('usage: probe-qbo-account-resolution.ts <organizationId>')
  process.exit(1)
}

/**
 * The adapter registers from the APP layer (`apps/web/src/server/accounting-providers.ts`),
 * which a standalone script never boots - so the script installs the same two
 * hooks itself. Without this every org resolves to the null provider and the
 * probe would report "nothing connected" for a connected org.
 */
async function registerQuickbooks() {
  const { createQuickbooksAccountingProvider } = await import(
    '../src/money/quickbooks/quickbooks-accounting-provider'
  )
  registerAccountingProvider('quickbooks', async () => createQuickbooksAccountingProvider())
  setConnectedProviderResolver(async () => 'quickbooks')
}

async function main() {
  await registerQuickbooks()

  const result = await listAccountIdentities(db, ORG)
  if (result.isErr()) {
    console.error(`listAccountIdentities refused: ${result.error.message}`)
    process.exit(1)
  }

  const { providerId, rows, providerAccounts, broken } = result.value
  console.log(`\nprovider: ${providerId}`)
  console.log(`provider chart: ${providerAccounts.length} accounts`)
  console.log(`auxx chart:     ${rows.length} accounts\n`)

  let mapped = 0
  let suggested = 0
  let unmapped = 0

  for (const row of rows) {
    const label = `${row.account.code.padEnd(8)} ${row.account.name}`
    if (row.state === 'confirmed') {
      mapped++
      const live = row.liveProviderAccount
      console.log(
        live
          ? `  ✅ ${label} -> ${live.fullyQualifiedName} (id ${live.id})`
          : `  🛑 ${label} -> id ${row.providerAccountId} NO LONGER EXISTS`
      )
    } else if (row.suggestion) {
      suggested++
      console.log(
        `  💡 ${label} -> suggested ${row.suggestion.account.fullyQualifiedName} (${row.suggestion.reason})`
      )
    } else {
      unmapped++
      console.log(`  ❌ ${label} -> nothing mapped, nothing suggested`)
    }
  }

  console.log(
    `\nmapped ${mapped}/${rows.length}   suggested ${suggested}   unmapped ${unmapped}   broken ${broken.length}`
  )
  if (broken.length > 0) console.log(`broken: ${broken.join(', ')}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('SCRIPT ERROR:', err)
    process.exit(1)
  })
