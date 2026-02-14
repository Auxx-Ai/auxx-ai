// apps/web/src/app/api/apps/[slug]/oauth2/authorize/route.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import crypto from 'crypto'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

const logger = createScopedLogger('oauth-authorize')

/**
 * Ensure offline access scope is present for OAuth2 connections to enable refresh tokens
 *
 * Different providers use different mechanisms:
 * - Google: Uses 'access_type=offline' parameter (not a scope)
 * - Microsoft/Azure: Uses 'offline_access' scope
 * - Generic OAuth2: Uses 'offline_access' scope
 *
 * @param scopes - Original scopes from ConnectionDefinition
 * @param authUrl - OAuth provider's authorization URL
 * @returns Enhanced scopes and any additional URL parameters
 */
function ensureOfflineAccessScope(
  scopes: string[],
  authUrl: string
): { scopes: string[]; additionalParams?: Record<string, string> } {
  // Google: Use access_type=offline parameter instead of scope
  if (authUrl.includes('accounts.google.com')) {
    return {
      scopes,
      additionalParams: { access_type: 'offline', prompt: 'consent' },
    }
  }

  // Microsoft/Azure: Use offline_access scope
  if (authUrl.includes('login.microsoftonline.com') || authUrl.includes('login.windows.net')) {
    if (!scopes.includes('offline_access')) {
      logger.info('Auto-injecting offline_access scope for Microsoft OAuth2')
      return { scopes: [...scopes, 'offline_access'] }
    }
    return { scopes }
  }

  // Generic OAuth2: Add offline_access if not present
  if (!scopes.includes('offline_access')) {
    logger.info('Auto-injecting offline_access scope for OAuth2', { authUrl })
    return { scopes: [...scopes, 'offline_access'] }
  }

  return { scopes }
}

/**
 * OAuth Authorize Route
 * GET /api/apps/:slug/oauth2/authorize?installation=:installationId&type=user|organization
 *
 * Redirects user to OAuth provider's authorization page
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const organizationId = (session.user as any).defaultOrganizationId
  if (!organizationId) {
    return NextResponse.json({ error: 'No organization' }, { status: 401 })
  }

  const { slug } = await params
  const searchParams = request.nextUrl.searchParams
  const installationId = searchParams.get('installation')
  const connectionType = searchParams.get('type') // 'user' or 'organization'

  if (!installationId || !connectionType) {
    return NextResponse.json(
      { error: 'Missing required parameters: installation and type' },
      { status: 400 }
    )
  }

  const isGlobal = connectionType === 'organization'

  try {
    // Get app by slug first
    const app = await db.query.App.findFirst({
      where: (a, { eq }) => eq(a.slug, slug),
      columns: { id: true, slug: true },
    })

    if (!app) {
      return NextResponse.json({ error: 'App not found' }, { status: 404 })
    }

    const appId = app.id

    // Get installation to verify it exists and belongs to org
    const installation = await db.query.AppInstallation.findFirst({
      where: (inst, { eq, and }) =>
        and(
          eq(inst.id, installationId),
          eq(inst.appId, appId),
          eq(inst.organizationId, organizationId)
        ),
      with: {
        currentVersion: {
          columns: {
            major: true,
          },
        },
        app: {
          columns: {
            title: true,
          },
        },
      },
    })

    if (!installation) {
      return NextResponse.json({ error: 'Installation not found' }, { status: 404 })
    }

    // Get connection definition
    const connDef = await db.query.ConnectionDefinition.findFirst({
      where: (cd, { eq, and }) =>
        and(
          eq(cd.appId, appId),
          eq(cd.major, installation.currentVersion!.major),
          eq(cd.global, isGlobal)
        ),
    })

    if (!connDef || connDef.connectionType !== 'oauth2-code') {
      return NextResponse.json(
        { error: 'OAuth not configured for this app connection' },
        { status: 400 }
      )
    }

    // Generate state token for CSRF protection
    const state = crypto.randomBytes(32).toString('hex')

    // Store state in Redis with metadata (expires in 10 minutes)
    const redis = await getRedisClient()
    await redis.setex(
      `oauth:app-connection:${state}`,
      600,
      JSON.stringify({
        userId: session.user.id,
        organizationId,
        appId,
        installationId,
        appTitle: installation.app!.title,
        connectionDefinitionId: connDef.id,
        global: connDef.global,
      })
    )

    // Ensure offline access for refresh tokens
    const { scopes: enhancedScopes, additionalParams } = ensureOfflineAccessScope(
      connDef.oauth2Scopes || [],
      connDef.oauth2AuthorizeUrl!
    )

    // Build OAuth authorization URL
    const authUrl = new URL(connDef.oauth2AuthorizeUrl!)
    authUrl.searchParams.set('client_id', connDef.oauth2ClientId!)
    authUrl.searchParams.set('redirect_uri', `${WEBAPP_URL}/api/apps/${slug}/oauth2/callback`)
    authUrl.searchParams.set('scope', enhancedScopes.join(' '))
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('response_type', 'code')

    // Add any provider-specific parameters (e.g., access_type=offline for Google)
    if (additionalParams) {
      Object.entries(additionalParams).forEach(([key, value]) => {
        authUrl.searchParams.set(key, value)
      })
    }

    logger.info('Redirecting to OAuth provider', {
      appId,
      slug,
      installationId,
      global: isGlobal,
      provider: connDef.oauth2AuthorizeUrl,
      originalScopes: connDef.oauth2Scopes,
      enhancedScopes,
      additionalParams,
    })

    // Redirect to OAuth provider
    return NextResponse.redirect(authUrl.toString())
  } catch (error) {
    logger.error('OAuth authorize failed', {
      error: error instanceof Error ? error.message : String(error),
      slug,
      installationId,
    })
    return NextResponse.json({ error: 'Failed to initiate OAuth' }, { status: 500 })
  }
}
