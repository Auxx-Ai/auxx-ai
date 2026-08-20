// packages/credentials/scripts/probe-shopify-conndef.ts
// Throwaway: which Shopify Partner app is the ConnectionDefinition actually wired to?

import { database as db, schema } from '@auxx/database'
import { decryptSecrets, isV2Payload } from '../src/crypto'

const KNOWN = {
  '588ef3496716248f2de2d485e57364ec': 'PROD app "auxxai" (shopify.app.toml)',
  a34d5f05c6a335cd31ceebbfa3242f50: 'DEV app "auxxai-dev" (shopify.app.dev.toml)',
}

function decryptOne(v: string | null): string | null {
  if (!v) return null
  if (!isV2Payload(v)) return v
  try {
    const out = decryptSecrets(v) as any
    return typeof out === 'string' ? out : (out?.value ?? JSON.stringify(out))
  } catch (e) {
    return `DECRYPT FAILED: ${e}`
  }
}

async function main() {
  const defs = await db.select().from(schema.ConnectionDefinition)
  const apps = await db.select().from(schema.App)
  const appById = new Map(apps.map((a) => [a.id, a]))

  for (const d of defs) {
    const app = d.appId ? appById.get(d.appId) : null
    const isShopify = /shopify/i.test(d.providerKey ?? '') || /shopify/i.test(app?.slug ?? '')
    if (!isShopify) continue

    const cid = decryptOne(d.oauth2ClientId)
    const csec = decryptOne(d.oauth2ClientSecret)
    console.log(`\n=== ConnectionDefinition ${d.id} ===`)
    console.log(`  app=${app?.slug ?? '-'} providerKey=${d.providerKey ?? '-'} global=${d.global}`)
    console.log(
      `  clientId=${cid ?? '(none)'}  -> ${cid ? (KNOWN[cid as keyof typeof KNOWN] ?? 'UNKNOWN app') : '-'}`
    )
    console.log(`  clientSecret=${csec ? `set (${csec.length} chars)` : '(none)'}`)
    console.log(`  oauth2Features=${JSON.stringify(d.oauth2Features)}`)
    console.log(`  authorizeUrl=${d.oauth2AuthorizeUrl}`)
    console.log(`  tokenUrl=${d.oauth2AccessTokenUrl}`)
    console.log(`  scopes=${JSON.stringify(d.oauth2Scopes)}`)
  }

  console.log(`\n=== env ===`)
  for (const k of [
    'SHOPIFY_API_KEY',
    'SHOPIFY_CLIENT_ID',
    'SHOPIFY_CLIENT_SECRET',
    'SHOPIFY_APP_ID',
    'NGROK_URL',
  ]) {
    const v = process.env[k]
    console.log(`  ${k}=${v ? (k.includes('SECRET') ? `set (${v.length} chars)` : v) : '(unset)'}`)
  }

  console.log(`\n=== Shopify AppInstallation rows ===`)
  const shopifyApp = apps.find((a) => a.slug === 'shopify')
  if (shopifyApp) {
    const installs = await db.query.AppInstallation.findMany({
      where: (i, { eq }) => eq(i.appId, shopifyApp.id),
    })
    for (const i of installs) {
      console.log(
        `  id=${i.id} org=${i.organizationId} status=${(i as any).status ?? '-'} enabled=${(i as any).enabled ?? '-'} createdAt=${i.createdAt?.toISOString?.() ?? '-'}`
      )
    }
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
