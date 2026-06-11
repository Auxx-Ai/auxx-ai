// packages/credentials/scripts/inspect-credential-blobs.ts
// Throwaway: report credential blob shapes + ConnectionDefinition secret-var flags. Keys only, no values.

import { database as db, schema } from '@auxx/database'
import { decryptSecrets } from '../src/crypto'

function keys(o: unknown): string[] {
  return o && typeof o === 'object' ? Object.keys(o as object) : []
}

async function main() {
  // Map appId -> secret-flagged connectionVariable keys (union across definition versions).
  const defs = await db.select().from(schema.ConnectionDefinition)
  const secretVarsByApp = new Map<string, Set<string>>()
  const allVarsByApp = new Map<string, Set<string>>()
  for (const d of defs) {
    if (!d.appId) continue
    const vars = (d.oauth2Features as { connectionVariables?: { key: string; secret?: boolean }[] })
      ?.connectionVariables
    if (!vars) continue
    const secretSet = secretVarsByApp.get(d.appId) ?? new Set<string>()
    const allSet = allVarsByApp.get(d.appId) ?? new Set<string>()
    for (const v of vars) {
      allSet.add(v.key)
      if (v.secret) secretSet.add(v.key)
    }
    secretVarsByApp.set(d.appId, secretSet)
    allVarsByApp.set(d.appId, allSet)
  }

  const rows = await db.select().from(schema.Credential)
  console.log(`\n=== ${rows.length} credential rows ===`)
  for (const row of rows) {
    let blob: Record<string, unknown> = {}
    try {
      blob = decryptSecrets(row.encryptedSecrets)
    } catch (e) {
      console.log(`  id=${row.id} type=${row.type} DECRYPT FAILED: ${e}`)
      continue
    }
    const md = (blob.metadata ?? {}) as Record<string, unknown>
    const cv = (md.connectionVariables ?? {}) as Record<string, unknown>
    const secretVars = row.appId ? (secretVarsByApp.get(row.appId) ?? new Set()) : new Set()
    const cvSecretHits = keys(cv).filter((k) => secretVars.has(k))
    console.log(
      `  type=${String(row.type).padEnd(14)} appId=${row.appId ?? '-'} ` +
        `blobKeys=[${keys(blob).join(',')}] metaKeys=[${keys(md).join(',')}] ` +
        `connVars=[${keys(cv).join(',')}]` +
        (cvSecretHits.length ? ` ⚠ SECRET-FLAGGED connVars=[${cvSecretHits.join(',')}]` : '')
    )
  }

  console.log('\n=== ConnectionDefinitions with secret-flagged connectionVariables ===')
  for (const [appId, set] of secretVarsByApp) {
    if (set.size) console.log(`  appId=${appId} secretVars=[${[...set].join(',')}]`)
  }
  console.log('(end)')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
