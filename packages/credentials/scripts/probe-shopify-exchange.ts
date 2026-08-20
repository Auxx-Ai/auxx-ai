// packages/credentials/scripts/probe-shopify-exchange.ts
// Exchange a Shopify authorization code for an access token using the
// ConnectionDefinition's own baked client id/secret. This is how you recover when
// ngrok's free-tier interstitial eats the OAuth callback: the `?code=` is still sitting
// in the browser URL bar and is good for a short while.
//
// Usage: SHOP=auxxai.myshopify.com CODE=<code> npx tsx scripts/probe-shopify-exchange.ts

import { database as db } from '@auxx/database'
import { decryptSecrets, isV2Payload } from '../src/crypto'

const SHOP = process.env.SHOP || 'auxxai.myshopify.com'
const CODE = process.env.CODE

function decryptOne(v: string | null): string | null {
  if (!v) return null
  if (!isV2Payload(v)) return v
  const out = decryptSecrets(v) as any
  return typeof out === 'string' ? out : (out?.v ?? out?.value ?? null)
}

async function main() {
  if (!CODE) {
    console.error('Set CODE=<authorization code>')
    process.exit(1)
  }

  const app = (await db.query.App.findFirst({ where: (a, { eq }) => eq(a.slug, 'shopify') })) as any
  const def = (await db.query.ConnectionDefinition.findFirst({
    where: (d, { eq, and }) => and(eq(d.appId, app.id), eq(d.global, true)),
  })) as any

  const clientId = decryptOne(def.oauth2ClientId)
  const clientSecret = decryptOne(def.oauth2ClientSecret)
  console.log(`client_id=${clientId}  secret=${clientSecret ? 'set' : 'MISSING'}`)

  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code: CODE }),
  })
  const text = await res.text()
  console.log(`\n[token exchange] status=${res.status}`)
  console.log(text.slice(0, 600))
  if (res.status !== 200) process.exit(1)

  const tok = JSON.parse(text)
  const token: string = tok.access_token
  console.log(
    `\naccess_token prefix=${token.slice(0, 6)} scope=${tok.scope} expires_in=${tok.expires_in ?? 'none (offline)'}`
  )

  // Stash for reuse by the verification script
  console.log(`\nSHOPIFY_PROBE_TOKEN=${token}`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
