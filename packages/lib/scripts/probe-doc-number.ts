// packages/lib/scripts/probe-doc-number.ts
// Read-only probe: what does the provider hold for one DocNumber right now.
// Run: npx dotenv -- npx tsx packages/lib/scripts/probe-doc-number.ts <doc>...
import { closePools } from '@auxx/database'
import { resolveQuickbooksContext } from '../src/accounting/providers/quickbooks/invoke-quickbooks-tool'

const ORG = process.env.SYNC_ORG_ID ?? 'abgwpa1l81reht2zmwrcihfu'

async function main() {
  const docs = process.argv.slice(2)
  const resolved = await resolveQuickbooksContext({ organizationId: ORG })
  if (!resolved.connected) return console.log('NOT CONNECTED')
  for (const docNumber of docs) {
    const found = (await resolved.context.callTool('find_quickbooks_journal_entry', {
      docNumber,
      limit: 5,
    })) as { journalEntries?: unknown[] } | undefined
    console.log(docNumber, JSON.stringify(found?.journalEntries ?? null))
  }
}

main()
  .catch((e) => console.error('ERR', e))
  .finally(() => closePools())
