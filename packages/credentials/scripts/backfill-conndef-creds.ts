// packages/credentials/scripts/backfill-conndef-creds.ts
// Phase 7 backfill: encrypt plaintext ConnectionDefinition.oauth2ClientId/oauth2ClientSecret
// with the v2 secret box. Idempotent — already-encrypted columns are skipped.
//
// Run from packages/credentials (dry run by default, prints the plan):
//   npx dotenv -e ../../.env -- npx tsx scripts/backfill-conndef-creds.ts
//   npx dotenv -e ../../.env -- npx tsx scripts/backfill-conndef-creds.ts --execute

import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { encryptValue, isV2Payload } from '../src/crypto'

const execute = process.argv.includes('--execute')

async function main() {
  const defs = await db.select().from(schema.ConnectionDefinition)

  let updated = 0
  for (const def of defs) {
    const clientIdPlain = def.oauth2ClientId !== null && !isV2Payload(def.oauth2ClientId)
    const clientSecretPlain =
      def.oauth2ClientSecret !== null && !isV2Payload(def.oauth2ClientSecret)
    if (!clientIdPlain && !clientSecretPlain) continue

    updated++
    console.log(
      `  id=${def.id} label=${JSON.stringify(def.label)} ` +
        `clientId=${clientIdPlain ? 'ENCRYPT' : 'ok'} ` +
        `clientSecret=${clientSecretPlain ? 'ENCRYPT' : 'ok'}`
    )

    if (!execute) continue
    await db
      .update(schema.ConnectionDefinition)
      .set({
        ...(clientIdPlain && { oauth2ClientId: encryptValue(def.oauth2ClientId as string) }),
        ...(clientSecretPlain && {
          oauth2ClientSecret: encryptValue(def.oauth2ClientSecret as string),
        }),
      })
      .where(eq(schema.ConnectionDefinition.id, def.id))
  }

  console.log(
    `\n${defs.length} definitions scanned, ${updated} with plaintext creds ` +
      (execute ? 'encrypted.' : 'to encrypt (dry run — pass --execute to apply).')
  )
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
