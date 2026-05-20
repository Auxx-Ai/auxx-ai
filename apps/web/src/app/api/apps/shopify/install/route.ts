// apps/web/src/app/api/apps/shopify/install/route.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import type { OAuth2Features } from '@auxx/database'
import { database as db } from '@auxx/database'
import { resolveAppSlug } from '@auxx/lib/cache'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { interpolateConnectionFields } from '@auxx/services/app-connections'
import crypto from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'

const OAUTH_REDIRECT_BASE = process.env.NGROK_URL || WEBAPP_URL
const SHOP_DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/

const logger = createScopedLogger('shopify-install')

/**
 * Shopify App Store install entry point.
 *
 * Reached by Shopify's "Install" action with `?shop=...&hmac=...&timestamp=...&host=...`.
 * Does no UI, no session lookup — verifies HMAC, parks CSRF state in Redis with a short TTL,
 * and 302s straight to the Shopify authorize page. This satisfies the App Store rule that
 * the merchant must hit OAuth before seeing any of our UI.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const shop = searchParams.get('shop')
  const hmac = searchParams.get('hmac')
  const host = searchParams.get('host')

  if (!shop || !hmac) {
    return new NextResponse('Missing required parameters', { status: 400 })
  }

  if (!SHOP_DOMAIN_REGEX.test(shop)) {
    return new NextResponse('Invalid shop domain', { status: 400 })
  }

  // Verify HMAC against SHOPIFY_API_SECRET per Shopify's spec
  // (all params except hmac, sorted alphabetically, joined as key=value pairs)
  const secret = process.env.SHOPIFY_API_SECRET
  if (!secret) {
    logger.error('SHOPIFY_API_SECRET not configured')
    return new NextResponse('Server misconfigured', { status: 500 })
  }

  const params: Record<string, string> = {}
  for (const [key, value] of searchParams.entries()) {
    if (key !== 'hmac') params[key] = value
  }
  const message = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  const expectedHmac = crypto.createHmac('sha256', secret).update(message).digest('hex')

  // Use timing-safe comparison
  const hmacBuf = Buffer.from(hmac, 'hex')
  const expectedBuf = Buffer.from(expectedHmac, 'hex')
  if (hmacBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(hmacBuf, expectedBuf)) {
    logger.warn('HMAC verification failed', { shop })
    return new NextResponse('Invalid HMAC', { status: 403 })
  }

  try {
    const appId = await resolveAppSlug('shopify')
    if (!appId) {
      logger.error('Shopify app not found in catalog')
      return new NextResponse('App not configured', { status: 500 })
    }

    // Prefer global (org-wide) Shopify connection definition; fall back to any
    const connDef =
      (await db.query.ConnectionDefinition.findFirst({
        where: (cd, { eq, and }) => and(eq(cd.appId, appId), eq(cd.global, true)),
      })) ??
      (await db.query.ConnectionDefinition.findFirst({
        where: (cd, { eq }) => eq(cd.appId, appId),
      }))

    if (!connDef || connDef.connectionType !== 'oauth2-code') {
      logger.error('Shopify ConnectionDefinition missing or not oauth2-code')
      return new NextResponse('App not configured', { status: 500 })
    }

    const features = (connDef.oauth2Features ?? {}) as OAuth2Features
    // Shop subdomain (e.g. "acme" from "acme.myshopify.com") — used by ConnectionDefinition
    // templates like https://{shop}.myshopify.com/admin/oauth/authorize.
    const shopSubdomain = shop.replace(/\.myshopify\.com$/, '')
    const resolved = interpolateConnectionFields(connDef, { shop: shopSubdomain })

    const state = crypto.randomBytes(32).toString('hex')

    const redis = await getRedisClient()
    if (!redis) {
      throw new Error('Redis client unavailable')
    }
    await redis.setex(
      `oauth:shopify-install:${state}`,
      600,
      JSON.stringify({
        shop,
        host,
        source: 'app_store',
        startedAt: new Date().toISOString(),
        connectionDefinitionId: connDef.id,
      })
    )

    const callbackBase = features.callbackBaseUrl || OAUTH_REDIRECT_BASE
    const scopeSeparator = features.scopeSeparator || ','
    const scopes = (connDef.oauth2Scopes ?? []).join(scopeSeparator)

    const authUrl = new URL(resolved.authorizeUrl)
    authUrl.searchParams.set('client_id', resolved.clientId)
    authUrl.searchParams.set('scope', scopes)
    authUrl.searchParams.set('redirect_uri', `${callbackBase}/api/apps/shopify/install/callback`)
    authUrl.searchParams.set('state', state)

    if (features.additionalAuthorizeParams) {
      for (const [key, value] of Object.entries(features.additionalAuthorizeParams)) {
        authUrl.searchParams.set(key, value)
      }
    }

    logger.info('Redirecting App Store install to Shopify authorize', { shop })
    return NextResponse.redirect(authUrl.toString())
  } catch (error) {
    logger.error('Shopify install failed', {
      error: error instanceof Error ? error.message : String(error),
      shop,
    })
    return new NextResponse('Failed to start install', { status: 500 })
  }
}
