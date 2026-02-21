// import { getServerAuthSession } from '~/server/auth'
import { WEBAPP_URL } from '@auxx/config/server'
import { configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import crypto from 'crypto'
import { and, eq, gt, inArray } from 'drizzle-orm'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'
import { logger } from '../logger'
// import { createScopedLogger } from '@auxx/logger'
// const logger = createScopedLogger('api-shopify')
// Handle initial OAuth authorization request
export async function GET(req: NextRequest) {
  try {
    // const session = await getServerAuthSession()
    const session = await auth.api.getSession({ headers: await headers() })
    // const {userId, organizationId} = session

    // Check
    if (!session?.user || !session.user.id || !session.user.defaultOrganizationId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id
    const organizationId = session.user.defaultOrganizationId

    const url = new URL(req.url)
    const shop = url.searchParams.get('shop')
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const hmac = url.searchParams.get('hmac')

    // Initial request to authorize
    if (!shop && !code) {
      const redirectUrl = `${WEBAPP_URL}/api/shopify/oauth2/callback`
      const shopParam = url.searchParams.get('shop_domain')

      if (!shopParam) {
        return NextResponse.json({ error: 'Missing shop domain parameter' }, { status: 400 })
      }

      // Generate a unique state for CSRF protection
      const state = crypto.randomBytes(16).toString('hex')

      // Store state in database for verification later
      await db.insert(schema.ShopifyAuthState).values({
        userId,
        organizationId,
        state,
        shopDomain: shopParam,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60 * 10), // 10 minutes
      })

      // Define the scopes
      const scopes = [
        'read_products',
        'write_products',
        'read_orders',
        'write_orders',
        'read_customers',
        'read_inventory',
        'write_inventory',
      ].join(',')

      // Build the authorization URL
      const shopifyAuthUrl = new URL(`https://${shopParam}/admin/oauth/authorize`)
      shopifyAuthUrl.searchParams.append('client_id', configService.get<string>('SHOPIFY_API_KEY')!)
      shopifyAuthUrl.searchParams.append('scope', scopes)
      shopifyAuthUrl.searchParams.append('redirect_uri', redirectUrl)
      shopifyAuthUrl.searchParams.append('state', state)

      // Redirect to Shopify's authorization page
      return NextResponse.redirect(shopifyAuthUrl.toString())
    } else if (shop && code && state && hmac) {
      // This is a callback from Shopify with the authorization code
      return handleCallback(req, session.user.id)
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  } catch (error) {
    logger.error('Shopify integration error:', { error })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// Handle callback after user authorizes the app on Shopify
async function handleCallback(req: NextRequest, userId: string) {
  try {
    const url = new URL(req.url)
    const shop = url.searchParams.get('shop')
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const hmac = url.searchParams.get('hmac')

    if (!shop || !code || !state) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }

    // Verify state parameter to prevent CSRF attacks
    const [storedState] = await db
      .select()
      .from(schema.ShopifyAuthState)
      .where(
        and(
          eq(schema.ShopifyAuthState.userId, userId),
          eq(schema.ShopifyAuthState.state, state),
          eq(schema.ShopifyAuthState.shopDomain, shop),
          gt(schema.ShopifyAuthState.expiresAt, new Date())
        )
      )
      .limit(1)

    if (!storedState) {
      return NextResponse.json({ error: 'Invalid state parameter' }, { status: 403 })
    }

    // Verify HMAC if provided
    if (hmac) {
      const queryParams = Object.fromEntries(url.searchParams.entries())
      delete queryParams.hmac // Remove hmac from params for verification

      const message = Object.entries(queryParams)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('&')

      const generatedHmac = crypto
        .createHmac('sha256', configService.get<string>('SHOPIFY_API_SECRET')!)
        .update(message)
        .digest('hex')

      if (generatedHmac !== hmac) {
        return NextResponse.json({ error: 'Invalid HMAC' }, { status: 403 })
      }
    }

    // Exchange authorization code for access token
    const accessTokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: configService.get<string>('SHOPIFY_API_KEY')!,
        client_secret: configService.get<string>('SHOPIFY_API_SECRET')!,
        code,
      }),
    })

    if (!accessTokenResponse.ok) {
      logger.error('Failed to get access token:', { response: await accessTokenResponse.text() })
      return NextResponse.json({ error: 'Failed to get access token' }, { status: 500 })
    }

    const { access_token: accessToken, scope } = await accessTokenResponse.json()

    const [membership] = await db
      .select({ id: schema.OrganizationMember.id })
      .from(schema.OrganizationMember)
      .where(
        and(
          eq(schema.OrganizationMember.userId, userId),
          eq(schema.OrganizationMember.organizationId, storedState.organizationId),
          inArray(schema.OrganizationMember.role, ['OWNER', 'ADMIN'])
        )
      )
      .limit(1)

    if (!membership) {
      return NextResponse.json(
        { error: "User doesn't have permission to add integrations" },
        { status: 403 }
      )
    }
    const organizationId = storedState.organizationId
    // const organizationId = membership.organizationId

    // Store the integration in the database
    await db
      .insert(schema.ShopifyIntegration)
      .values({
        organizationId,
        shopDomain: shop,
        accessToken,
        scope,
        createdById: userId,
        enabled: true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.ShopifyIntegration.organizationId, schema.ShopifyIntegration.shopDomain],
        set: { accessToken, scope, updatedAt: new Date(), enabled: true },
      })

    // Clean up used state
    await db.delete(schema.ShopifyAuthState).where(eq(schema.ShopifyAuthState.id, storedState.id))

    // Redirect back to the app's integration page
    return NextResponse.redirect(`${WEBAPP_URL}/app/settings/shopify?success=true`)
  } catch (error) {
    logger.error('Shopify callback error:', { error })
    return NextResponse.redirect(`${WEBAPP_URL}/app/settings/shopify?error=true`)
  }
}
