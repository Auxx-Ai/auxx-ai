// packages/credentials/scripts/persist-shopify-token.ts
// Throwaway: write a working Shopify offline token into an existing Credential row so the
// paused data connector can sync again. Clears the dead refresh token + expiry.
//
// Usage: CRED_ID=<id> TOKEN=<shpat_...> npx tsx scripts/persist-shopify-token.ts

import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { decryptSecrets, encryptSecrets } from '../src/crypto'

const CRED_ID = process.env.CRED_ID
const TOKEN = process.env.TOKEN
const SHOP = process.env.SHOP || 'auxxai.myshopify.com'

async function main() {
  if (!CRED_ID || !TOKEN) {
    console.error('Set CRED_ID and TOKEN')
    process.exit(1)
  }

  const before = await db.query.Credential.findFirst({
    where: (c, { eq: e }) => e(c.id, CRED_ID),
  })
  if (!before) {
    console.error(`No Credential ${CRED_ID}`)
    process.exit(1)
  }

  console.log('BEFORE:')
  console.log(`  name=${before.name} org=${before.organizationId}`)
  console.log(`  blobKeys=[${Object.keys(decryptSecrets(before.encryptedSecrets)).join(',')}]`)
  console.log(`  expiresAt=${before.expiresAt?.toISOString() ?? 'none'}`)
  console.log(`  metadata=${JSON.stringify(before.metadata)}`)

  // Verify the token actually works before overwriting anything.
  const check = await fetch(`https://${SHOP}/admin/api/2024-10/shop.json`, {
    headers: { 'X-Shopify-Access-Token': TOKEN },
  })
  if (check.status !== 200) {
    console.error(`Token failed /shop.json with ${check.status} — refusing to write.`)
    process.exit(1)
  }
  console.log(`\nToken verified against ${SHOP} (200).`)

  const scopesRes = await fetch(`https://${SHOP}/admin/oauth/access_scopes.json`, {
    headers: { 'X-Shopify-Access-Token': TOKEN },
  })
  const scopes = ((await scopesRes.json()) as any).access_scopes
    ?.map((s: any) => s.handle)
    .join(',')

  const shopSub = SHOP.replace(/\.myshopify\.com$/, '')
  const metadata = {
    ...((before.metadata ?? {}) as Record<string, unknown>),
    scope: scopes,
    shopDomain: SHOP,
    connectionVariables: { shop: shopSub },
  }

  await db
    .update(schema.Credential)
    // Offline token: no refreshToken, no expiry. Storing a refreshToken here is what
    // produced the dead credentials — the refresh endpoint 401s once it lapses.
    .set({
      encryptedSecrets: encryptSecrets({ accessToken: TOKEN }),
      expiresAt: null,
      metadata: metadata as any,
      requiresReauth: false,
      lastAuthError: null,
      lastAuthErrorAt: null,
      lastRefreshError: null,
      lastRefreshFailureAt: null,
      consecutiveRefreshFailures: 0,
    })
    .where(eq(schema.Credential.id, CRED_ID))

  const after = await db.query.Credential.findFirst({
    where: (c, { eq: e }) => e(c.id, CRED_ID),
  })
  console.log('\nAFTER:')
  console.log(`  blobKeys=[${Object.keys(decryptSecrets(after!.encryptedSecrets)).join(',')}]`)
  console.log(`  expiresAt=${after!.expiresAt?.toISOString() ?? 'none'}`)
  console.log(
    `  requiresReauth=${after!.requiresReauth} lastRefreshError=${after!.lastRefreshError}`
  )
  console.log(`  metadata=${JSON.stringify(after!.metadata)}`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
