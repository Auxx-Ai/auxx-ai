import { env, WEBAPP_URL } from '@auxx/config/server'
import { database as db, schema } from '@auxx/database'
import { setupShopifyWebhooks } from '@auxx/lib/shopify'
import crypto from 'crypto'
import { and, eq, gt, inArray } from 'drizzle-orm'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'
import { logger } from '../../logger'

// Handle OAuth callback from Shopify
export async function GET(req: NextRequest) {
  try {
    // const session = await getServerAuthSession();
    const session = await auth.api.getSession({ headers: await headers() })

    const userId = session?.user?.id

    if (!session?.user || !userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
        .createHmac('sha256', env.SHOPIFY_API_SECRET)
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
        client_id: env.SHOPIFY_API_KEY,
        client_secret: env.SHOPIFY_API_SECRET,
        code,
      }),
    })

    if (!accessTokenResponse.ok) {
      logger.error('Failed to get access token:', { response: await accessTokenResponse.text() })
      return NextResponse.json({ error: 'Failed to get access token' }, { status: 500 })
    }

    const { access_token: accessToken, scope } = await accessTokenResponse.json()

    const organizationId = storedState.organizationId

    const [membership] = await db
      .select({ id: schema.OrganizationMember.id })
      .from(schema.OrganizationMember)
      .where(
        and(
          eq(schema.OrganizationMember.userId, userId),
          eq(schema.OrganizationMember.organizationId, organizationId),
          inArray(schema.OrganizationMember.role, ['OWNER', 'ADMIN'])
        )
      )
      .limit(1)

    // Get the current user's organization
    // const user = await db.user.findUnique({
    //   where: { id: session.user.id },
    //   include: { memberships: true },
    // })

    // if (!user || !user.memberships.length) {
    //   return NextResponse.json(
    //     { error: 'User has no organization' },
    //     { status: 400 }
    //   )
    // }

    // Find the user's organization where they have OWNER or ADMIN role
    // const membership = user.memberships.find(
    //   (m) =>
    //     m.role === 'OWNER' ||
    //     (m.role === 'ADMIN' && m.organizationId === storedState.organizationId)
    // )

    if (!membership) {
      return NextResponse.json(
        { error: "User doesn't have permission to add integrations" },
        { status: 403 }
      )
    }
    // const organizationId = membership.organizationId

    // Store the integration in the database
    const [integration] = await db
      .insert(schema.ShopifyIntegration)
      .values({
        organizationId,
        shopDomain: shop!,
        accessToken,
        scope,
        createdById: session.user.id,
        enabled: true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.ShopifyIntegration.organizationId, schema.ShopifyIntegration.shopDomain],
        set: { accessToken, scope, updatedAt: new Date(), enabled: true },
      })
      .returning({
        id: schema.ShopifyIntegration.id,
        shopDomain: schema.ShopifyIntegration.shopDomain,
        accessToken: schema.ShopifyIntegration.accessToken,
      })

    // Clean up used state
    await db.delete(schema.ShopifyAuthState).where(eq(schema.ShopifyAuthState.id, storedState.id))

    // Set up webhooks for the connected store
    try {
      await setupShopifyWebhooks(integration.id)
      // This could also be moved to a background job
      // await setupShopifyWebhooks(shop, accessToken);
    } catch (webhookError) {
      logger.error('Error setting up webhooks:', { webhookError })
      // Continue anyway, we can set up webhooks later
    }

    // Redirect back to the app's integration page
    return NextResponse.redirect(`${WEBAPP_URL}/app/settings/shopify?success=true`)
  } catch (error) {
    logger.error('Shopify callback error:', { error })
    return NextResponse.redirect(`${WEBAPP_URL}/app/settings/shopify?error=true`)
  }
}

// Set up each webhook
/*
// Helper function to set up webhooks
async function setupShopifyWebhooksOld(shop: string, accessToken: string) {
  // Create admin API client
  // const adminClient = new AdminApiClient({
  //   shopDomain: shop,
  //   apiVersion: '2024-04',
  //   accessToken: accessToken
  // });

  const adminClient = createAdminApiClient({
    shopDomain: shop,
    apiVersion: '2025-04',
    accessToken: accessToken,
  })

  //

  // Define the webhooks to set up
  const webhookTopics = [
    'PRODUCTS_CREATE',
    'PRODUCTS_UPDATE',
    'PRODUCTS_DELETE',
    'ORDERS_CREATE',
    'ORDERS_UPDATED',
    'ORDERS_CANCELLED',
    'INVENTORY_LEVELS_UPDATE',
  ]

  // Set up each webhook
  for (const topic of webhookTopics) {
    const webhookUrl = `${env.}/api/integrations/shopify/webhook`

    const createWebhookMutation = `
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    const variables = {
      topic,
      webhookSubscription: { callbackUrl: webhookUrl, format: 'JSON' },
    }

    try {
      await adminClient.request(createWebhookMutation, variables)
    } catch (error) {
      console.error(`Error creating webhook for topic ${topic}:`, error)
      // Continue with other webhooks
    }
  }

  return true
}
*/
