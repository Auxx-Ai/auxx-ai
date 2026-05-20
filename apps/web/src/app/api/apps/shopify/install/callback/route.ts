// apps/web/src/app/api/apps/shopify/install/callback/route.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import { database as db } from '@auxx/database'
import { resolveAppSlug } from '@auxx/lib/cache'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { interpolateConnectionFields } from '@auxx/services/app-connections'
import crypto from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('shopify-install-callback')

const CLAIM_COOKIE_NAME = 'shopify_claim_token'
const CLAIM_COOKIE_MAX_AGE = 3600
const CLAIM_TTL_SECONDS = 3600

/**
 * App-Store install callback. Physically separate from the generic
 * `/api/apps/[slug]/oauth2/callback` so the anonymous, pre-org code path
 * never touches the shared trust boundary that other apps rely on.
 *
 * Flow:
 *  1. Verify state from Redis + HMAC.
 *  2. Exchange code for access token.
 *  3. Detect reinstall via Redis shop→credential lookup; if known, upsert silently.
 *  4. Otherwise park `{shop, accessToken, scope, ...}` under a fresh claimToken
 *     and 302 the merchant to `/shopify/claim` with the token in an httpOnly cookie.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const shop = searchParams.get('shop')
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const hmac = searchParams.get('hmac')

  if (!shop || !code || !state || !hmac) {
    return new NextResponse('Missing required parameters', { status: 400 })
  }

  const secret = process.env.SHOPIFY_API_SECRET
  if (!secret) {
    logger.error('SHOPIFY_API_SECRET not configured')
    return new NextResponse('Server misconfigured', { status: 500 })
  }

  // Verify HMAC of callback params
  const params: Record<string, string> = {}
  for (const [k, v] of searchParams.entries()) {
    if (k !== 'hmac') params[k] = v
  }
  const message = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const expectedHmac = crypto.createHmac('sha256', secret).update(message).digest('hex')
  const hmacBuf = Buffer.from(hmac, 'hex')
  const expectedBuf = Buffer.from(expectedHmac, 'hex')
  if (hmacBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(hmacBuf, expectedBuf)) {
    logger.warn('Callback HMAC verification failed', { shop })
    return new NextResponse('Invalid HMAC', { status: 403 })
  }

  try {
    const redis = await getRedisClient()
    if (!redis) throw new Error('Redis client unavailable')

    const stateKey = `oauth:shopify-install:${state}`
    const stateRaw = await redis.get(stateKey)
    if (!stateRaw) {
      return new NextResponse('Invalid or expired state', { status: 400 })
    }
    const stateData = JSON.parse(stateRaw) as {
      shop: string
      host?: string
      source?: string
      startedAt: string
      connectionDefinitionId: string
    }

    if (stateData.shop !== shop) {
      logger.warn('Shop mismatch between state and callback', {
        stateShop: stateData.shop,
        callbackShop: shop,
      })
      return new NextResponse('State validation failed', { status: 400 })
    }

    const appId = await resolveAppSlug('shopify')
    if (!appId) {
      return new NextResponse('App not configured', { status: 500 })
    }

    const connDef = await db.query.ConnectionDefinition.findFirst({
      where: (cd, { eq }) => eq(cd.id, stateData.connectionDefinitionId),
    })
    if (!connDef) {
      throw new Error('Connection definition not found')
    }

    const shopSubdomain = shop.replace(/\.myshopify\.com$/, '')
    const resolved = interpolateConnectionFields(connDef, { shop: shopSubdomain })

    // Exchange code for token. Shopify accepts both form-encoded and JSON; use JSON to
    // match Shopify's documented example and the legacy route.
    const tokenResponse = await fetch(resolved.accessTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: resolved.clientId,
        client_secret: resolved.clientSecret,
        code,
      }),
    })

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text()
      logger.error('Shopify token exchange failed', { status: tokenResponse.status, errText })
      throw new Error(`Token exchange failed: ${tokenResponse.status}`)
    }

    const tokens = (await tokenResponse.json()) as {
      access_token?: string
      scope?: string
    }
    if (!tokens.access_token) {
      throw new Error('Token response missing access_token')
    }

    // Park pending claim. claimToken is independent of the OAuth state to avoid
    // ever exposing the state value past callback termination. A shop can be
    // attached to multiple Auxx orgs — the claim page lets the merchant pick which.
    const claimToken = crypto.randomBytes(32).toString('hex')
    const claimPayload = {
      shop,
      accessToken: tokens.access_token,
      scope: tokens.scope,
      connectionDefinitionId: connDef.id,
      createdAt: new Date().toISOString(),
    }
    await redis.setex(
      `shopify:pending-claim:${claimToken}`,
      CLAIM_TTL_SECONDS,
      JSON.stringify(claimPayload)
    )
    await redis.del(stateKey)

    // Redirect to the claim page. Token lives only in the httpOnly cookie for the
    // primary path; the claim page also accepts ?token=... as a cross-device fallback
    // (see §7.3 of the plan — email verification on a different device).
    const claimUrl = new URL('/shopify/claim', WEBAPP_URL)
    // Cross-device fallback: include token in URL so a verification email opened on
    // a different device (no cookie) can still resolve the Redis entry.
    claimUrl.searchParams.set('token', claimToken)

    const response = NextResponse.redirect(claimUrl.toString())
    response.cookies.set(CLAIM_COOKIE_NAME, claimToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: CLAIM_COOKIE_MAX_AGE,
    })
    return response
  } catch (error) {
    logger.error('Shopify install callback failed', {
      error: error instanceof Error ? error.message : String(error),
      shop,
    })
    return new NextResponse('Installation failed', { status: 500 })
  }
}
