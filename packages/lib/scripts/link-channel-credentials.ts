// packages/lib/scripts/link-channel-credentials.ts
// One-off (pre-launch, dev only): link existing channel (kind:'integration')
// credentials to the platform ConnectionDefinition rows added by the channels-onto-
// connections fold, so the unified resolver/refresh path can serve their tokens.
// Existing creds were written by the old channel-token-accessor with only kind/type
// and no connectionDefinitionId; this backfills the FK by Integration.provider →
// providerKey mapping (§2.3 / §9.1). Idempotent.
// Run: npx dotenv -- npx tsx packages/lib/scripts/link-channel-credentials.ts

import { closePools, database as db, schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'

/** Integration.provider (IntegrationProviderType) → ConnectionDefinition.providerKey. */
const PROVIDER_TO_PROVIDER_KEY: Record<string, string> = {
  google: 'gmail',
  outlook: 'outlookMail',
  facebook: 'facebookOAuth2Api',
  instagram: 'instagramOAuth2Api',
  shopify: 'shopifyOAuth2Api',
  imap: 'imap',
  email: 'smtp',
  openphone: 'openphone',
}

async function main(): Promise<void> {
  // Resolve def ids for every providerKey we may link to.
  const defs = await db.query.ConnectionDefinition.findMany({
    columns: { id: true, providerKey: true },
  })
  const defIdByKey = new Map(defs.filter((d) => d.providerKey).map((d) => [d.providerKey!, d.id]))

  // Every active integration that has a linked credential.
  const integrations = await db
    .select({
      id: schema.Integration.id,
      provider: schema.Integration.provider,
      credentialId: schema.Integration.credentialId,
    })
    .from(schema.Integration)
    .where(isNull(schema.Integration.deletedAt))

  let linked = 0
  let skipped = 0
  for (const integ of integrations) {
    if (!integ.credentialId) {
      skipped++
      continue
    }
    const providerKey = PROVIDER_TO_PROVIDER_KEY[integ.provider]
    const defId = providerKey ? defIdByKey.get(providerKey) : undefined
    if (!defId) {
      // eslint-disable-next-line no-console
      console.warn(`No def for provider "${integ.provider}" (integration ${integ.id}) — skipping`)
      skipped++
      continue
    }

    const res = await db
      .update(schema.Credential)
      .set({ connectionDefinitionId: defId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.Credential.id, integ.credentialId),
          eq(schema.Credential.kind, 'integration'),
          isNull(schema.Credential.connectionDefinitionId)
        )
      )
      .returning({ id: schema.Credential.id })
    if (res.length > 0) linked++
    else skipped++
  }

  await closePools()
  // eslint-disable-next-line no-console
  console.log(`✓ Linked ${linked} channel credential(s) to platform defs (${skipped} skipped)`)
  process.exit(0)
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('✗ Link failed:', err)
  process.exit(1)
})
