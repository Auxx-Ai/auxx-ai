// packages/lib/scripts/cutover-channels-to-connections.ts
// One-off (pre-launch, dev only): clean up after the channels-onto-connections Phase 4 cutover.
// After Gmail/Outlook channels are reconnected through the unified flow (which writes fresh
// kind:'workflow' credentials), this removes the now-dead artifacts of the old channel auth stack:
//   1. Orphaned kind:'integration' Credential rows (no Integration.credentialId points to them).
//   2. Per-org BYO OAuth client rows in KeyValuePair (GOOGLE/OUTLOOK_CLIENT_ID/SECRET) — BYO client
//      now lives in the credential's encrypted secret fields (§3.2).
//
// Report-only by default. Pass `--apply` to delete.
// Run: npx dotenv -- npx tsx packages/lib/scripts/cutover-channels-to-connections.ts [--apply]

import { closePools, database as db, schema } from '@auxx/database'
import { and, eq, inArray, isNotNull, notInArray } from 'drizzle-orm'

const APPLY = process.argv.includes('--apply')

const BYO_CLIENT_KEYS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'OUTLOOK_CLIENT_ID',
  'OUTLOOK_CLIENT_SECRET',
]

async function main(): Promise<void> {
  // 1. Orphaned channel credentials: kind:'integration' rows not referenced by any Integration.
  const linkedCredentialIds = await db
    .select({ credentialId: schema.Integration.credentialId })
    .from(schema.Integration)
    .where(isNotNull(schema.Integration.credentialId))
  const referenced = linkedCredentialIds
    .map((r) => r.credentialId)
    .filter((id): id is string => !!id)

  const orphanedCreds = await db
    .select({ id: schema.Credential.id, type: schema.Credential.type })
    .from(schema.Credential)
    .where(
      and(
        eq(schema.Credential.kind, 'integration'),
        referenced.length > 0
          ? notInArray(schema.Credential.id, referenced)
          : // No integration references anything → all integration creds are orphaned.
            isNotNull(schema.Credential.id)
      )
    )

  // 2. Per-org BYO OAuth client rows.
  const byoRows = await db
    .select({ id: schema.KeyValuePair.id, key: schema.KeyValuePair.key })
    .from(schema.KeyValuePair)
    .where(
      and(
        eq(schema.KeyValuePair.type, 'CONFIG_VARIABLE'),
        inArray(schema.KeyValuePair.key, BYO_CLIENT_KEYS)
      )
    )

  // eslint-disable-next-line no-console
  console.log(
    `Found ${orphanedCreds.length} orphaned kind:'integration' credential(s) and ${byoRows.length} BYO client config row(s).`
  )

  if (!APPLY) {
    // eslint-disable-next-line no-console
    console.log('Dry run — re-run with --apply to delete.')
    await closePools()
    process.exit(0)
  }

  if (orphanedCreds.length > 0) {
    await db.delete(schema.Credential).where(
      inArray(
        schema.Credential.id,
        orphanedCreds.map((c) => c.id)
      )
    )
  }
  if (byoRows.length > 0) {
    await db.delete(schema.KeyValuePair).where(
      inArray(
        schema.KeyValuePair.id,
        byoRows.map((r) => r.id)
      )
    )
  }

  await closePools()
  // eslint-disable-next-line no-console
  console.log(
    `✓ Deleted ${orphanedCreds.length} orphaned credential(s) and ${byoRows.length} BYO client config row(s).`
  )
  process.exit(0)
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('✗ Cutover cleanup failed:', err)
  process.exit(1)
})
