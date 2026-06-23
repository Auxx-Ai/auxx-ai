// packages/lib/src/channels/social-provisioning-hook.ts
// Post-connect provisioning for social channels (Facebook / Instagram). The generic OAuth
// callback commits a Credential holding the short-lived Facebook USER token, then runs this
// hook to do the work that used to live in FacebookOAuthService.handleCallback /
// InstagramOAuthService.handleCallback (minus the user-token storage the credential layer owns):
//   exchange the user token for a long-lived one, discover the managed Page (+ linked Instagram
//   Business Account), exchange for a long-lived PAGE token, SWAP that page token onto the
//   credential (the working channel token), create-or-relink the Integration row, link the default
//   inbox, and subscribe the Page to the app webhook (the social analogue of arming Gmail watch).
//
// Token model: the page token is what every runtime read (facebook-provider / instagram-provider /
// getPageAccessToken / revoke) needs, and getChannelTokens already serves the credential secret —
// so writing the page token via setChannelTokens makes the runtime paths work unchanged. Long-lived
// page tokens (~60d, often non-expiring) have no OAuth refresh grant, so expiresAt is stored null
// and a dead token surfaces as requiresReauth rather than a scanner refresh.

import { configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { onCacheEvent } from '../cache'
import type { PostConnectHook, PostConnectHookContext } from '../connections/post-connect-hooks'
import { resolveConnectionForRuntime } from '../connections/resolve-connection-for-runtime'
import { publisher } from '../events'
import { InboxService } from '../inboxes/inbox-service'
import { setChannelTokens } from '../providers/channel-token-accessor'

const logger = createScopedLogger('social-provisioning-hook')

const DEFAULT_API_VERSION = 'v19.0'

type SocialProvider = 'facebook' | 'instagram'

const PROVIDER_BY_KEY: Record<string, SocialProvider> = {
  facebook: 'facebook',
  instagram: 'instagram',
}

interface FacebookPage {
  id: string
  name: string
  access_token: string
}

interface InstagramAccount {
  id: string
  username: string
}

/** The connected Page (+ optional linked IG account) plus its long-lived page token. */
interface SocialIdentity {
  pageId: string
  pageName: string
  longLivedPageToken: string
  longLivedUserToken: string
  facebookUserId?: string
  instagramAccountId?: string
  instagramUsername?: string
}

function apiVersion(): string {
  try {
    return configService.get<string>('FACEBOOK_GRAPH_API_VERSION') || DEFAULT_API_VERSION
  } catch {
    return DEFAULT_API_VERSION
  }
}

/** Platform Facebook app client (v1 uses the platform app only — no per-org BYO client). */
function facebookClient(): { clientId: string; clientSecret: string } {
  const clientId = configService.get<string>('FACEBOOK_APP_ID') || ''
  const clientSecret = configService.get<string>('FACEBOOK_APP_SECRET') || ''
  if (!clientId || !clientSecret) {
    throw new Error(
      'Facebook app credentials (FACEBOOK_APP_ID / FACEBOOK_APP_SECRET) not configured'
    )
  }
  return { clientId, clientSecret }
}

/** Resolve the just-committed credential's access token (the short-lived Facebook user token). */
async function resolveUserToken(ctx: PostConnectHookContext): Promise<string> {
  const resolved = await resolveConnectionForRuntime({
    connectionId: ctx.credentialId,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    ensureFresh: true,
  })
  if (resolved.isErr()) {
    throw new Error(`Failed to resolve social channel token: ${resolved.error.message}`)
  }
  const conn = resolved.value.organizationConnection ?? resolved.value.userConnection
  if (!conn?.value) throw new Error('Social credential resolved without an access token')
  return conn.value
}

/** Exchange a short-lived token for a long-lived one (`fb_exchange_token`). Returns input on failure. */
async function exchangeForLongLived(shortToken: string): Promise<string> {
  const { clientId, clientSecret } = facebookClient()
  const url = `https://graph.facebook.com/${apiVersion()}/oauth/access_token`
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: clientId,
    client_secret: clientSecret,
    fb_exchange_token: shortToken,
  })
  try {
    const res = await fetch(`${url}?${params.toString()}`)
    const data = await res.json()
    if (!res.ok || !data.access_token) {
      logger.warn('Long-lived token exchange failed; using short-lived token', {
        error: data.error?.message,
      })
      return shortToken
    }
    return data.access_token as string
  } catch (error) {
    logger.warn('Long-lived token exchange errored; using short-lived token', {
      error: error instanceof Error ? error.message : String(error),
    })
    return shortToken
  }
}

async function fetchFacebookUserId(token: string): Promise<string | undefined> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${apiVersion()}/me?fields=id&access_token=${token}`
    )
    const data = await res.json()
    return data?.id
  } catch {
    return undefined
  }
}

/** Pages the user manages, each with its own page access token. */
async function fetchUserPages(token: string): Promise<FacebookPage[]> {
  const url = `https://graph.facebook.com/${apiVersion()}/me/accounts?fields=id,name,access_token&access_token=${token}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok || !Array.isArray(data.data)) {
    throw new Error(
      `Could not retrieve Facebook Pages: ${data.error?.message ?? 'ensure permissions were granted'}`
    )
  }
  return data.data
}

/** The Instagram Business Account linked to a Page, if any. */
async function fetchInstagramAccount(
  pageId: string,
  pageToken: string
): Promise<InstagramAccount | null> {
  try {
    const url = `https://graph.facebook.com/${apiVersion()}/${pageId}?fields=instagram_business_account{id,username}&access_token=${pageToken}`
    const res = await fetch(url)
    const data = await res.json()
    if (res.ok && data.instagram_business_account) {
      return {
        id: data.instagram_business_account.id,
        username: data.instagram_business_account.username,
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Discover the Page (and, for Instagram, its linked IG Business Account) and mint the
 * long-lived page token. v1 auto-selects the first matching Page (Facebook: the first page;
 * Instagram: the first page that has a linked IG account) — multi-page selection is deferred.
 */
async function discoverIdentity(
  provider: SocialProvider,
  userToken: string
): Promise<SocialIdentity> {
  const longLivedUserToken = await exchangeForLongLived(userToken)
  const facebookUserId = await fetchFacebookUserId(longLivedUserToken)
  const pages = await fetchUserPages(longLivedUserToken)
  if (pages.length === 0) {
    throw new Error(
      'No Facebook Pages found. Ensure a Page is managed and permissions were granted.'
    )
  }

  if (provider === 'facebook') {
    const page = pages[0]!
    const longLivedPageToken = await exchangeForLongLived(page.access_token)
    return {
      pageId: page.id,
      pageName: page.name,
      longLivedPageToken,
      longLivedUserToken,
      facebookUserId,
    }
  }

  // Instagram: pick the first Page with a linked Instagram Business Account.
  for (const page of pages) {
    const igAccount = await fetchInstagramAccount(page.id, page.access_token)
    if (igAccount) {
      const longLivedPageToken = await exchangeForLongLived(page.access_token)
      return {
        pageId: page.id,
        pageName: page.name,
        longLivedPageToken,
        longLivedUserToken,
        facebookUserId,
        instagramAccountId: igAccount.id,
        instagramUsername: igAccount.username,
      }
    }
  }
  throw new Error(
    'No managed Facebook Page with a linked Instagram Professional account was found. ' +
      'Link the account and grant permissions, then retry.'
  )
}

/** Subscribe the Page to the app's webhook (the social analogue of arming Gmail watch). */
async function subscribePageToApp(
  provider: SocialProvider,
  pageId: string,
  pageToken: string
): Promise<void> {
  const url = `https://graph.facebook.com/${apiVersion()}/${pageId}/subscribed_apps`
  const subscribedFields =
    provider === 'instagram'
      ? 'messages,messaging_postbacks'
      : 'messages,messaging_postbacks,message_reads'
  const params = new URLSearchParams({
    subscribed_fields: subscribedFields,
    access_token: pageToken,
  })
  try {
    const res = await fetch(url, { method: 'POST', body: params })
    const data = await res.json()
    if (!res.ok || !data.success) {
      logger.warn('Page webhook subscription failed — real-time messages may not arrive', {
        pageId,
        provider,
        status: res.status,
      })
    }
  } catch (error) {
    logger.error('Error subscribing Page to app webhook', {
      pageId,
      provider,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Create the Integration row, or relink the credential onto the existing one (reauth / reconnect).
 * Social channels are matched by the Page id (Facebook) or Instagram Business Account id
 * (Instagram) carried in metadata, not by the email column (which stays null).
 */
async function upsertSocialIntegration(args: {
  organizationId: string
  provider: SocialProvider
  credentialId: string
  identity: SocialIdentity
}): Promise<{ id: string; isNew: boolean; displayName: string }> {
  const { organizationId, provider, credentialId, identity } = args
  const matchId = provider === 'instagram' ? identity.instagramAccountId! : identity.pageId
  const displayName =
    provider === 'instagram' ? (identity.instagramUsername ?? identity.pageName) : identity.pageName

  const metadata: Record<string, unknown> = {
    pageId: identity.pageId,
    pageName: identity.pageName,
    userId: identity.facebookUserId,
    ...(provider === 'instagram' && {
      instagramBusinessAccountId: identity.instagramAccountId,
      instagramUsername: identity.instagramUsername,
    }),
  }

  // Match on the page/IG id inside the jsonb metadata (no clean drizzle json-path filter), so
  // reauth/reconnect relinks the existing row instead of inserting a duplicate.
  const rows = await db
    .select({ id: schema.Integration.id, metadata: schema.Integration.metadata })
    .from(schema.Integration)
    .where(
      and(
        eq(schema.Integration.organizationId, organizationId),
        eq(schema.Integration.provider, provider)
      )
    )
  const existing =
    rows.find((r) => {
      const m = r.metadata as Record<string, unknown> | null
      const id = provider === 'instagram' ? m?.instagramBusinessAccountId : m?.pageId
      return id === matchId
    }) ?? null

  if (existing) {
    await db
      .update(schema.Integration)
      .set({ credentialId, enabled: true, metadata: metadata as any, updatedAt: new Date() })
      .where(eq(schema.Integration.id, existing.id))
    return { id: existing.id, isNew: false, displayName }
  }

  const [created] = await db
    .insert(schema.Integration)
    .values({
      organizationId,
      provider,
      credentialId,
      enabled: true,
      metadata: metadata as any,
      updatedAt: new Date(),
    })
    .returning({ id: schema.Integration.id })
  return { id: created!.id, isNew: true, displayName }
}

/** The social channel post-connect hook — handles `facebook` and `instagram`. */
export const socialProvisioningHook: PostConnectHook = {
  providerKeys: ['facebook', 'instagram'],
  async run(ctx: PostConnectHookContext): Promise<void> {
    const provider = PROVIDER_BY_KEY[ctx.providerKey]
    if (!provider) {
      logger.warn('No social provider mapping for key', { providerKey: ctx.providerKey })
      return
    }

    const userToken = await resolveUserToken(ctx)
    const identity = await discoverIdentity(provider, userToken)

    const integration = await upsertSocialIntegration({
      organizationId: ctx.organizationId,
      provider,
      credentialId: ctx.credentialId,
      identity,
    })

    // Swap the credential's stored token from the Facebook USER token to the long-lived PAGE token
    // (the working channel token). The user token rides along as the "refresh" slot for revoke.
    // Long-lived page tokens have no refresh grant → expiresAt null (no scanner refresh).
    await setChannelTokens(
      integration.id,
      {
        accessToken: identity.longLivedPageToken,
        refreshToken: identity.longLivedUserToken,
        expiresAt: null,
      },
      { createdById: ctx.userId }
    )

    const inboxService = new InboxService(db, ctx.organizationId, ctx.userId)
    await inboxService.addIntegrationToDefaultInbox(integration.id)

    await subscribePageToApp(provider, identity.pageId, identity.longLivedPageToken)

    await onCacheEvent('channel.connected', { orgId: ctx.organizationId })

    await publisher.publishLater({
      type: 'integration:connected',
      data: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        provider,
        identifier: integration.displayName,
        integrationId: integration.id,
      },
    })

    logger.info('Social channel provisioned', {
      integrationId: integration.id,
      provider,
      pageId: identity.pageId,
      isNew: integration.isNew,
    })
  },
}
