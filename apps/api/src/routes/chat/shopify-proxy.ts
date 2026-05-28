// apps/api/src/routes/chat/shopify-proxy.ts

import { createHmac, timingSafeEqual } from 'node:crypto'
import { signUserJwt } from '@auxx/chat/server'
import { CredentialService } from '@auxx/credentials'
import { database, schema } from '@auxx/database'
import { shopifyExternalId } from '@auxx/lib/ingest'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'

const log = createScopedLogger('chat-shopify-proxy-route')

const shopifyProxyRoute = new Hono()

/**
 * Verify a Shopify App Proxy HMAC signature. Shopify appends a `signature`
 * query param to every proxied request; the message is the remaining query
 * params, alphabetically sorted as `key=value` pairs and concatenated without
 * separators, then HMAC-SHA256'd with the Partner App's API secret. Hex
 * compare in constant time.
 *
 * Docs: https://shopify.dev/docs/apps/build/online-store/display-dynamic-data
 */
function verifyAppProxyHmac(searchParams: URLSearchParams, secret: string): boolean {
  const signature = searchParams.get('signature')
  if (!signature) return false

  const pairs: string[] = []
  searchParams.forEach((value, key) => {
    if (key !== 'signature') pairs.push(`${key}=${value}`)
  })
  pairs.sort()
  const message = pairs.join('')
  const calculated = createHmac('sha256', secret).update(message).digest('hex')

  if (calculated.length !== signature.length) return false
  return timingSafeEqual(Buffer.from(calculated), Buffer.from(signature))
}

/**
 * GET /api/chat/shopify-proxy/jwt
 *
 * Called from the storefront via Shopify's App Proxy: shoppers see
 * `myshop.com/apps/auxx-chat/jwt?channel_id=…`, Shopify forwards here with
 * the shop domain, the logged-in customer id, a signature, and a timestamp.
 *
 * Verifies the HMAC, resolves the chat channel's owning org, cross-checks
 * the shop ↔ channel binding by decrypting the org's Shopify
 * `WorkflowCredentials`, loads the channel's active chat signing key, and
 * mints a 1h user JWT with `user_id = "shopify:<shop>:<customerId>"`. The
 * widget's bootstrap then calls `/api/chat/passport` with this JWT, which
 * resolves it to a Contact via `findOrCreateContactFromJwt`.
 *
 * Visitor path (no `logged_in_customer_id`) returns 204 — `boot.js` skips
 * the JWT and boots anonymous.
 */
shopifyProxyRoute.get('/jwt', async (c) => {
  const shopifyApiSecret = process.env.SHOPIFY_API_SECRET
  if (!shopifyApiSecret) {
    log.error('SHOPIFY_API_SECRET not configured')
    return c.json({ error: 'misconfigured' }, 500)
  }

  const url = new URL(c.req.url)
  const params = url.searchParams

  if (!verifyAppProxyHmac(params, shopifyApiSecret)) {
    log.warn('App Proxy HMAC verification failed', { shop: params.get('shop') })
    return c.json({ error: 'forbidden' }, 403)
  }

  const shop = params.get('shop')
  const channelId = params.get('channel_id')
  const customerId = params.get('logged_in_customer_id')

  if (!shop || !channelId) {
    return c.json({ error: 'missing_params' }, 400)
  }

  // No logged-in customer = visitor path. Tell boot.js to boot anonymous.
  if (!customerId) {
    return c.body(null, 204)
  }

  // Resolve org from the channel (single indexed read).
  const integration = await database.query.Integration.findFirst({
    where: and(eq(schema.Integration.id, channelId), eq(schema.Integration.provider, 'chat')),
    with: { chatWidget: true },
  })
  if (!integration?.chatWidget) {
    return c.json({ error: 'channel_not_found' }, 404)
  }
  const orgId = integration.organizationId

  // Cross-check shop ↔ channel binding. Decrypt the org's Shopify
  // app-connection credentials (typically 1-3 rows) and verify one matches
  // the proxy's `shop` param. Prevents shop A from passing shop B's
  // `channel_id` to mint JWTs against shop B's channel.
  const shopifyApp = await database.query.App.findFirst({
    where: (apps, { eq }) => eq(apps.slug, 'shopify'),
    columns: { id: true },
  })
  if (!shopifyApp) {
    log.error('Shopify app row not found in DB')
    return c.json({ error: 'misconfigured' }, 500)
  }

  const creds = await database.query.WorkflowCredentials.findMany({
    where: (rows, { and, eq, isNull }) =>
      and(
        eq(rows.organizationId, orgId),
        eq(rows.appId, shopifyApp.id),
        eq(rows.type, 'app-connection'),
        isNull(rows.userId)
      ),
    columns: { encryptedData: true },
  })

  let bound = false
  for (const cred of creds) {
    try {
      const decrypted = CredentialService.decrypt(cred.encryptedData) as {
        metadata?: { shopDomain?: string }
      }
      if (decrypted.metadata?.shopDomain === shop) {
        bound = true
        break
      }
    } catch (error) {
      log.warn('Failed to decrypt Shopify credential during binding check', {
        orgId,
        error: (error as Error).message,
      })
    }
  }
  if (!bound) {
    log.warn('Shop ↔ channel binding mismatch', { shop, channelId, orgId })
    return c.json({ error: 'forbidden' }, 403)
  }

  // Load the channel's active chat signing key. Same pattern as
  // `chat.signTestJwt` (apps/web/src/server/api/routers/chat.ts).
  const apiKey = await database.query.ApiKey.findFirst({
    where: and(
      eq(schema.ApiKey.organizationId, orgId),
      eq(schema.ApiKey.type, 'chat'),
      eq(schema.ApiKey.referenceId, channelId),
      eq(schema.ApiKey.isActive, true)
    ),
    columns: { id: true, encryptedSecret: true },
  })
  if (!apiKey?.encryptedSecret) {
    log.error('No active chat signing key for channel', { channelId, orgId })
    return c.json({ error: 'no_signing_key' }, 500)
  }

  let signingSecret: string
  try {
    const decrypted = CredentialService.decrypt(apiKey.encryptedSecret)
    const value = (decrypted as { value?: unknown }).value
    if (typeof value !== 'string' || !value) {
      throw new Error('Decrypted payload missing value')
    }
    signingSecret = value
  } catch (error) {
    log.error('Failed to decrypt chat signing key', {
      keyId: apiKey.id,
      channelId,
      error: (error as Error).message,
    })
    return c.json({ error: 'signing_key_failure' }, 500)
  }

  const expiresIn = '1h'
  const userJwt = signUserJwt(
    {
      user_id: shopifyExternalId(shop, customerId),
      attributes: {
        source: 'shopify_storefront',
        shopify_customer_id: customerId,
        shopify_shop_domain: shop,
      },
    },
    signingSecret,
    { expiresIn }
  )

  c.header('Cache-Control', 'no-store')
  return c.json({ userJwt, expiresIn })
})

export default shopifyProxyRoute
