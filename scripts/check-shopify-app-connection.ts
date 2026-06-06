// scripts/check-shopify-app-connection.ts
//
// Verify a Shopify *app-connection* (WorkflowCredentials, type 'app-connection')
// by decrypting its stored token and making a live Shopify Admin API call.
// Answers "is this token actually dead?" independently of the kopilot path.
//
// Usage:
//   npx dotenv -- npx tsx scripts/check-shopify-app-connection.ts [organizationId] [appId]
// Defaults: DemoOrg + the Shopify appId.

import { CredentialService } from '@auxx/credentials'
import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'

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

  const cred = await database.query.WorkflowCredentials.findFirst({
    where: and(
      eq(schema.WorkflowCredentials.organizationId, organizationId),
      eq(schema.WorkflowCredentials.appId, appId),
      eq(schema.WorkflowCredentials.type, 'app-connection')
    ),
  })

  if (!cred) {
    console.error('No app-connection credential found for that org + appId')
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

  const decrypted = CredentialService.decrypt(cred.encryptedData) as {
    accessToken?: string
    secret?: string
    metadata?: Record<string, unknown>
    expiresAt?: string
  }

  const token = decrypted.accessToken ?? decrypted.secret
  const shopDomain = resolveShopDomain(decrypted.metadata)

  console.log('\n--- decrypted (sanitized) ---')
  console.log({
    shopDomain,
    hasToken: Boolean(token),
    tokenPrefix: token ? `${token.slice(0, 8)}…` : null,
    tokenLength: token?.length ?? 0,
    decryptedExpiresAt: decrypted.expiresAt ?? null,
    metadataKeys: Object.keys(decrypted.metadata ?? {}),
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
