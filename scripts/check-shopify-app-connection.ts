// scripts/check-shopify-app-connection.ts
//
// Verify a Shopify *app connection* (Credential, kind 'app') by revealing
// its stored token via the credential store and making a live Shopify
// Admin API call. Answers "is this token actually dead?" independently of
// the kopilot path.
//
// Usage:
//   npx dotenv -- npx tsx scripts/check-shopify-app-connection.ts [organizationId] [appId]
// Defaults: DemoOrg + the Shopify appId.

import { findCredential, revealSecrets } from '@auxx/credentials/store'

const DEFAULT_ORG = 'abgwpa1l81reht2zmwrcihfu' // DemoOrg
const DEFAULT_SHOPIFY_APP_ID = 'ni0jjtpn6sreobwrue44r8re'
const API_VERSION = '2024-10'

const organizationId = process.argv[2] ?? DEFAULT_ORG
const appId = process.argv[3] ?? DEFAULT_SHOPIFY_APP_ID

function resolveShopDomain(metadata: Record<string, unknown> | undefined): string {
  const vars = metadata?.connectionVariables as Record<string, string> | undefined
  const shop = vars?.shop
  if (!shop) return ''
  return shop.includes('.') ? shop : `${shop}.myshopify.com`
}

async function main() {
  console.log({ organizationId, appId })

  const credResult = await findCredential({ organizationId, kind: 'app', appId })
  if (credResult.isErr()) {
    console.error('Credential lookup failed:', credResult.error.message)
    process.exit(1)
  }
  const cred = credResult.value
  if (!cred) {
    console.error('No app credential found for that org + appId')
    process.exit(1)
  }

  console.log('\n--- credential row ---')
  console.log({
    id: cred.id,
    name: cred.name,
    label: cred.label,
    expiresAt: cred.expiresAt,
    consecutiveRefreshFailures: cred.consecutiveRefreshFailures,
    lastRefreshFailureAt: cred.lastRefreshFailureAt,
    createdAt: cred.createdAt,
  })

  const revealed = await revealSecrets<{ accessToken?: string; secret?: string }>(
    cred.id,
    organizationId
  )
  if (revealed.isErr()) {
    console.error('Failed to reveal secrets:', revealed.error.message)
    process.exit(1)
  }
  const { record, secrets } = revealed.value

  const token = secrets.accessToken ?? secrets.secret
  const shopDomain = resolveShopDomain(record.metadata)

  console.log('\n--- revealed (sanitized) ---')
  console.log({
    shopDomain,
    hasToken: Boolean(token),
    tokenPrefix: token ? `${token.slice(0, 8)}…` : null,
    tokenLength: token?.length ?? 0,
    expiresAt: record.expiresAt,
    metadataKeys: Object.keys(record.metadata),
  })

  if (!token || !shopDomain) {
    console.error('\nMissing token or shop domain — cannot test live.')
    process.exit(1)
  }

  // Live probe: /shop.json is the cheapest authenticated read.
  const url = `https://${shopDomain}/admin/api/${API_VERSION}/shop.json`
  console.log('\n--- live probe ---')
  console.log('GET', url)

  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
  })

  const bodyText = await res.text()
  console.log('status:', res.status, res.statusText)
  if (res.ok) {
    const shop = JSON.parse(bodyText)?.shop
    console.log('✅ token VALID — shop:', {
      name: shop?.name,
      domain: shop?.domain,
      plan: shop?.plan_name,
    })
  } else {
    console.log(`❌ token REJECTED (${res.status}) — body:`, bodyText.slice(0, 500))
    if (res.status === 401 || res.status === 403) {
      console.log('→ This is the revoked/expired case the app maps to ConnectionExpiredError.')
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\nthrew:', e instanceof Error ? e.message : e)
    process.exit(1)
  })
