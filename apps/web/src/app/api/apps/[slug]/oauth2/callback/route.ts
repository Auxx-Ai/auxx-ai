// apps/web/src/app/api/apps/[slug]/oauth2/callback/route.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'

const OAUTH_REDIRECT_BASE = process.env.NGROK_URL || WEBAPP_URL

import { saveAppConnection } from '@auxx/services/app-connections'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('oauth-callback')

/**
 * OAuth Callback Route
 * GET /api/apps/:slug/oauth2/callback
 *
 * Handles OAuth provider callback, exchanges code for tokens, saves connection
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const { slug } = await params

  // Handle OAuth errors
  if (error) {
    logger.error('OAuth provider returned error', { error, slug })
    return new NextResponse(
      `
      <html>
        <head><title>Connection Failed</title></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 2rem; text-align: center;">
          <h1>Connection Failed</h1>
          <p>The OAuth provider returned an error: ${error}</p>
          <p>You can close this window and try again.</p>
        </body>
      </html>
      `,
      {
        status: 400,
        headers: { 'Content-Type': 'text/html' },
      }
    )
  }

  if (!code || !state) {
    return new NextResponse('Missing code or state parameter', { status: 400 })
  }

  try {
    // Get app by slug to get appId
    const app = await db.query.App.findFirst({
      where: (a, { eq }) => eq(a.slug, slug),
      columns: { id: true },
    })

    if (!app) {
      return new NextResponse('App not found', { status: 404 })
    }

    const appId = app.id

    // Validate state and retrieve metadata
    const redis = await getRedisClient()
    if (!redis) {
      throw new Error('Redis client unavailable')
    }

    const stateData = await redis.get(`oauth:app-connection:${state}`)
    if (!stateData) {
      return new NextResponse('Invalid or expired state token', { status: 400 })
    }

    const metadata = JSON.parse(stateData)
    await redis.del(`oauth:app-connection:${state}`)

    // Verify appId matches stored state
    if (metadata.appId !== appId) {
      return new NextResponse('State validation failed', { status: 400 })
    }

    // Get connection definition using Drizzle query API
    const connDef = await db.query.ConnectionDefinition.findFirst({
      where: (cd, { eq }) => eq(cd.id, metadata.connectionDefinitionId),
    })

    if (!connDef) {
      throw new Error('Connection definition not found')
    }

    // Exchange authorization code for access token
    const tokenRequestBody: Record<string, string> = {
      code,
      client_id: connDef.oauth2ClientId!,
      client_secret: connDef.oauth2ClientSecret!,
      redirect_uri: `${OAUTH_REDIRECT_BASE}/api/apps/${slug}/oauth2/callback`,
      grant_type: 'authorization_code',
    }

    // Use appropriate auth method
    const tokenRequestHeaders: Record<string, string> = {
      // RFC 6749 §4.1.3 requires form-encoded bodies
      'Content-Type': 'application/x-www-form-urlencoded',
    }

    if (connDef.oauth2TokenRequestAuthMethod === 'basic-auth') {
      const basicAuth = Buffer.from(
        `${connDef.oauth2ClientId}:${connDef.oauth2ClientSecret}`
      ).toString('base64')
      tokenRequestHeaders['Authorization'] = `Basic ${basicAuth}`
      // Don't include client_id and client_secret in body for basic auth
      delete tokenRequestBody.client_id
      delete tokenRequestBody.client_secret
    }

    logger.info('Exchanging OAuth code for tokens', {
      appId,
      slug,
      installationId: metadata.installationId,
      tokenUrl: connDef.oauth2AccessTokenUrl,
    })

    const tokenResponse = await fetch(connDef.oauth2AccessTokenUrl!, {
      method: 'POST',
      headers: tokenRequestHeaders,
      body: new URLSearchParams(tokenRequestBody).toString(),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      logger.error('Token exchange failed', {
        status: tokenResponse.status,
        error: errorText,
        appId,
        slug,
      })
      throw new Error(`Failed to exchange code for tokens: ${tokenResponse.status}`)
    }

    const tokens = await tokenResponse.json()

    // Slack (and some other providers) return HTTP 200 even on failure
    if (tokens.ok === false) {
      throw new Error(`OAuth token exchange failed: ${tokens.error}`)
    }
    if (!tokens.access_token) {
      throw new Error('OAuth token exchange returned no access_token')
    }

    logger.info('Successfully received OAuth tokens', {
      appId,
      slug,
      installationId: metadata.installationId,
      hasRefresh: !!tokens.refresh_token,
      expiresIn: tokens.expires_in,
      expiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : undefined,
    })

    // Log what we're about to save
    logger.info('Saving app connection with params:', {
      appId: metadata.appId,
      installationId: metadata.installationId,
      appTitle: metadata.appTitle,
      organizationId: metadata.organizationId,
      userId: metadata.userId,
      userIdField: metadata.global ? null : metadata.userId,
      global: metadata.global,
      hasAccess: !!tokens.access_token,
      hasRefresh: !!tokens.refresh_token,
    })

    // Save connection to WorkflowCredentials
    const result = await saveAppConnection(
      metadata.appId,
      metadata.installationId,
      metadata.appTitle,
      metadata.organizationId,
      metadata.userId,
      metadata.global ? null : metadata.userId, // userId field: null for organization-wide, userId for user
      {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
          : undefined,
        metadata: {
          scope: tokens.scope,
          tokenType: tokens.token_type,
        },
      }
    )

    if (result.isErr()) {
      logger.error('Failed to save app connection', {
        error: result.error,
        appId,
        slug,
      })
      throw result.error
    }

    logger.info('App connection created successfully', {
      appId,
      slug,
      installationId: metadata.installationId,
      global: metadata.global,
      credentialId: result.value,
    })

    // Redirect back to the app's connection page with success indicator
    const redirectUrl = `${WEBAPP_URL}/app/settings/apps/installed/${slug}/connections?success=true`
    return NextResponse.redirect(redirectUrl)
  } catch (error) {
    logger.error('OAuth callback failed', {
      error: error instanceof Error ? error.message : String(error),
      slug,
    })

    return new NextResponse(
      `
      <html>
        <head><title>Connection Failed</title></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 2rem; text-align: center;">
          <h1>Connection Failed</h1>
          <p>An error occurred while setting up your connection.</p>
          <p style="color: #666; font-size: 0.875rem;">${error instanceof Error ? error.message : 'Unknown error'}</p>
          <p><a href="/app/settings/apps">Return to Apps</a></p>
        </body>
      </html>
      `,
      {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      }
    )
  }
}
