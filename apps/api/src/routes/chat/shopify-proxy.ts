// apps/api/src/routes/chat/shopify-proxy.ts

import { decryptSecrets } from '@auxx/credentials/crypto'
import { listCredentials } from '@auxx/credentials/store'
import { database, schema } from '@auxx/database'
import { signChannelUserJwt } from '@auxx/lib/chat'
import { shopifyExternalId } from '@auxx/lib/ingest'
import { verifyShopifyAppProxy } from '@auxx/lib/webhooks'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'

const log = createScopedLogger('chat-shopify-proxy-route')

const shopifyProxyRoute = new Hono()

/**
 * GET /api/chat/shopify-proxy/jwt
 *
 * Called from the storefront via Shopify's App Proxy: shoppers see
 * `myshop.com/apps/auxx-chat/jwt?channel_id=…`, Shopify forwards here with
 * the shop domain, the logged-in customer id, a signature, and a timestamp.
 *
 * Verifies the HMAC, resolves the chat channel's owning org, cross-checks
 * the shop ↔ channel binding against the org's Shopify `Credential`
 * metadata, loads the channel's active chat signing key, and
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

  if (!verifyShopifyAppProxy(params, shopifyApiSecret)) {
    log.warn('App Proxy HMAC verification failed', { shop: params.get('shop') })
    return c.json({ error: 'forbidden' }, 403)
  }

  const shop = params.get('shop')
  const channelId = params.get('channel_id')
  const customerId = params.get('logged_in_customer_id')

  // No logged-in customer = visitor path. Tell boot.js to boot anonymous.
  // Checked BEFORE the param guard: a visitor needs no channel binding to boot
  // anonymously, and gating the 204 behind `channel_id` would make this branch
  // unreachable for any caller that omits it.
  if (!customerId) {
    return c.body(null, 204)
  }

  if (!shop || !channelId) {
    // Was silent. This is the storefront's contract with us, and `boot.js` omitting
    // `channel_id` is exactly what made identified chat fail everywhere — if it ever
    // regresses, this line is how we find out without a merchant reporting it.
    log.warn('App Proxy JWT request missing params', {
      shop,
      hasChannelId: Boolean(channelId),
    })
    return c.json({ error: 'missing_params' }, 400)
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

  // Cross-check shop ↔ channel binding. Match the proxy's `shop` param
  // against the org's Shopify app credentials' plaintext metadata (typically
  // 1-3 rows, no decryption). Prevents shop A from passing shop B's
  // `channel_id` to mint JWTs against shop B's channel.
  const shopifyApp = await database.query.App.findFirst({
    where: (apps, { eq }) => eq(apps.slug, 'shopify'),
    columns: { id: true },
  })
  if (!shopifyApp) {
    log.error('Shopify app row not found in DB')
    return c.json({ error: 'misconfigured' }, 500)
  }

  const credsResult = await listCredentials({
    organizationId: orgId,
    kind: 'app',
    appId: shopifyApp.id,
    userId: null,
  })
  if (credsResult.isErr()) {
    log.error('Failed to list Shopify credentials during binding check', {
      orgId,
      error: credsResult.error.message,
    })
    return c.json({ error: 'misconfigured' }, 500)
  }

  const bound = credsResult.value.some((cred) => cred.metadata.shopDomain === shop)
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
    const decrypted = decryptSecrets<{ value?: unknown }>(apiKey.encryptedSecret)
    const value = decrypted.value
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
  const userJwt = await signChannelUserJwt(
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

  // The success line. A storefront that renders no widget is either not reaching this route
  // at all (nothing logged → the embed block or the metafield is the problem) or reaching it
  // and failing above (a warn/error line names which check). Never logs the JWT itself.
  log.info('Minted Shopify storefront chat JWT', {
    shop,
    channelId,
    organizationId: orgId,
    expiresIn,
  })

  c.header('Cache-Control', 'no-store')
  return c.json({ userJwt, expiresIn })
})

export default shopifyProxyRoute
