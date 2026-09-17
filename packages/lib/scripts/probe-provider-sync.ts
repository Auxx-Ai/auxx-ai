// packages/lib/scripts/probe-provider-sync.ts
// Probe: run the INBOUND provider sync exactly as the settings panel does, and
// print the refusal verbatim.
//
// The panel's refusal only exists in the browser — `provider-sync/guard.ts`
// logs nothing for an `AuxxError`, so a refused sync leaves no trace in the log
// history.
//
// The adapter registers from the APP layer, which a standalone script never
// boots, so this installs the same two hooks `drive-opening-fill.ts` does.
// Without them every org resolves to the null provider and the sync refuses
// with "nothing connected" on a connected org.
//
// Run: npx dotenv -- npx tsx packages/lib/scripts/probe-provider-sync.ts
import { closePools, database as db } from '@auxx/database'
import { registerAccountingProvider, setConnectedProviderResolver } from '../src/postings/provider'
import { syncProviderLedger } from '../src/postings/provider-sync/sync'

const ORG = process.env.SYNC_ORG_ID ?? 'abgwpa1l81reht2zmwrcihfu'
const TO = process.env.SYNC_TO ?? '2026-09-16'
const FROM = process.env.SYNC_FROM

async function registerQuickbooks() {
  const { createQuickbooksAccountingProvider } = await import(
    '../src/money/quickbooks/quickbooks-accounting-provider'
  )
  registerAccountingProvider('quickbooks', async () => createQuickbooksAccountingProvider())
  setConnectedProviderResolver(async () => 'quickbooks')
}

async function main() {
  await registerQuickbooks()
  const result = await syncProviderLedger(db, ORG, { from: FROM, to: TO })
  if (result.isErr()) {
    const e = result.error as Error & { context?: unknown; meta?: unknown }
    console.error('REFUSED:', e.name)
    console.error('MESSAGE:', e.message)
    console.error('CONTEXT:', JSON.stringify(e.context ?? e.meta ?? null, null, 2))
  } else {
    console.log('OK:', JSON.stringify(result.value, null, 2))
  }
  await closePools()
  process.exit(0)
}
main()
