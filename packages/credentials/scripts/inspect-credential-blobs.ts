// packages/credentials/scripts/inspect-credential-blobs.ts
// Throwaway: report credential blob shapes + ConnectionDefinition secret-var flags. Keys only, no values.

import { database as db, schema } from '@auxx/database'
import { decryptSecrets, isV2Payload } from '../src/crypto'

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
    const vars = d.connectionVariables
    if (!vars?.length) continue
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

  // Phase 7 post-backfill verification: every non-null cred column should be v2 ciphertext.
  console.log('\n=== ConnectionDefinition cred columns (v2 vs plaintext) ===')
  const tally = { clientId: { v2: 0, plaintext: 0 }, clientSecret: { v2: 0, plaintext: 0 } }
  for (const d of defs) {
    if (d.oauth2ClientId !== null)
      tally.clientId[isV2Payload(d.oauth2ClientId) ? 'v2' : 'plaintext']++
    if (d.oauth2ClientSecret !== null)
      tally.clientSecret[isV2Payload(d.oauth2ClientSecret) ? 'v2' : 'plaintext']++
  }
  console.log(`  oauth2ClientId:     v2=${tally.clientId.v2} plaintext=${tally.clientId.plaintext}`)
  console.log(
    `  oauth2ClientSecret: v2=${tally.clientSecret.v2} plaintext=${tally.clientSecret.plaintext}`
  )
  for (const d of defs) {
    const plainCols = [
      d.oauth2ClientId !== null && !isV2Payload(d.oauth2ClientId) && 'clientId',
      d.oauth2ClientSecret !== null && !isV2Payload(d.oauth2ClientSecret) && 'clientSecret',
    ].filter(Boolean)
    if (plainCols.length) {
      console.log(
        `  ⚠ PLAINTEXT id=${d.id} label=${JSON.stringify(d.label)} cols=[${plainCols.join(',')}]`
      )
    }
  }
  console.log('(end)')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
