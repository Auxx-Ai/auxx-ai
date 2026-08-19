// packages/lib/src/channels/social-provisioning-hook.ts
// Post-connect provisioning for social channels (Facebook / Instagram). The generic OAuth
// callback commits a Credential holding the short-lived Facebook USER token, then runs this
// hook to discover the grant. A FRESH connect never finishes here: it parks a pending marker and
// returns `awaiting` — NO Integration, NO page token, NO webhook — for the in-app picker to
// finish. The one exception is a full-OAuth reconnect of a live channel, which is forced onto the
// Page it already has (see below) and provisions inline.
//
// `/me/accounts` returns every Page the connecting user administers. Auto-selecting `pages[0]`
// gave a multi-Page business whichever Page Graph happened to return first, silently.
//
// The picker runs even when the grant reaches exactly ONE Page, where it is a confirmation rather
// than a choice. That is deliberate and NOT a UX oversight: Meta's app review requires us to
// demonstrate what `pages_show_list` is for, and a connect that silently auto-selects shows a
// reviewer nothing. A screen that lists the Pages the grant reached, and connects the one the
// user picks, IS the justification for the permission.
//
// Token model: the page token is what every runtime read (facebook-provider / instagram-provider
// / getPageAccessToken / revoke) needs, and getChannelTokens already serves the credential secret
// — so writing the page token via setChannelTokens makes the runtime paths work unchanged.
// Long-lived page tokens (~60d, often non-expiring) have no OAuth refresh grant, so expiresAt is
// stored null and a dead token surfaces as requiresReauth rather than a scanner refresh.
//
// ⚠️ The pending window deliberately keeps the SHORT-LIVED user token on the credential. A
// pending credential has no Integration, so it is invisible in principle to Meta's data-deletion
// callback (which joins on `Integration.metadata.userId`); holding a ~60-day grant there would
// mean holding something a deletion request structurally cannot reach. The short-lived token
// expires on its own within the hour, with no code involved — that is what makes the pending
// state self-limiting.

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { onCacheEvent } from '../cache'
import {
  deleteSupersededPendingCredentials,
  writePendingSelection,
} from '../connections/pending-selection'
import type {
  PostConnectHook,
  PostConnectHookContext,
  PostConnectHookResult,
} from '../connections/post-connect-hooks'
import { publisher } from '../events'
import { InboxService } from '../inboxes/inbox-service'
import { setChannelTokens } from '../providers/channel-token-accessor'
import {
  exchangeForLongLived,
  type FacebookPage,
  fetchFacebookUserId,
  fetchInstagramAccount,
  fetchUserPages,
  type InstagramAccount,
} from '../providers/social/connect-api'
import { assertSharedConnectInbox } from './connect-inbox'
import {
  type CachedSocialPage,
  cacheAvailablePages,
  resolveUserTokenForCredential,
  type SocialIdentity,
  type SocialProvider,
  subscribePageToApp,
  upsertSocialIntegration,
} from './internal/social-integration'
import {
  findLiveSocialIntegrationForCredential,
  SOCIAL_PAGE_SELECTION_KIND,
  type SocialPageSelectionPayload,
  selectSocialCandidates,
} from './social-page-selection'

const logger = createScopedLogger('social-provisioning-hook')

const PROVIDER_BY_KEY: Record<string, SocialProvider> = {
  facebook: 'facebook',
  instagram: 'instagram',
}

/** Re-exported: `CachedSocialPage` was defined here before the phase split. */
export type { CachedSocialPage } from './internal/social-integration'

/** Everything one OAuth grant can reach, resolved once and shared by both branches. */
interface SocialGrant {
  longLivedUserToken: string
  facebookUserId: string
  pages: FacebookPage[]
  availablePages: CachedSocialPage[]
}

/**
 * Read the whole grant: long-lived user token, ASID, and every managed Page.
 *
 * Order is load-bearing and unchanged: `exchangeForLongLived` → `fetchFacebookUserId` (still
 * FATAL, still before anything is written) → `fetchUserPages` → the empty-pages throw. The ASID
 * failure must precede any write, including the pending marker, so a connect that cannot be
 * matched to a Meta deletion request leaves nothing behind at all.
 */
async function fetchGrant(userToken: string): Promise<SocialGrant> {
  const longLivedUserToken = await exchangeForLongLived(userToken)
  const facebookUserId = await fetchFacebookUserId(longLivedUserToken)
  const pages = await fetchUserPages(longLivedUserToken)
  if (pages.length === 0) {
    throw new Error(
      'No Facebook Pages found. Ensure a Page is managed and permissions were granted.'
    )
  }
  const availablePages: CachedSocialPage[] = pages.map((page) => ({
    id: page.id,
    name: page.name,
    igBusinessAccountId: page.instagram_business_account?.id,
    igUsername: page.instagram_business_account?.username,
  }))
  return { longLivedUserToken, facebookUserId, pages, availablePages }
}

/** Build the identity for one chosen Page, including its long-lived page token. */
async function buildIdentity(
  grant: SocialGrant,
  page: FacebookPage,
  instagram?: { id: string; username: string }
): Promise<SocialIdentity> {
  const longLivedPageToken = await exchangeForLongLived(page.access_token)
  return {
    pageId: page.id,
    pageName: page.name,
    longLivedPageToken,
    longLivedUserToken: grant.longLivedUserToken,
    facebookUserId: grant.facebookUserId,
    availablePages: grant.availablePages,
    ...(instagram && {
      instagramAccountId: instagram.id,
      instagramUsername: instagram.username,
    }),
  }
}

/** Resolve the IG account for ONE page: the expanded field first, the per-page probe second. */
async function resolveInstagramFor(page: FacebookPage): Promise<InstagramAccount | undefined> {
  if (page.instagram_business_account?.id) {
    return {
      id: page.instagram_business_account.id,
      username: page.instagram_business_account.username ?? '',
    }
  }
  return (await fetchInstagramAccount(page.id, page.access_token)) ?? undefined
}

/**
 * Turn one chosen Page into a channel — the tail the forced reconnect runs. A fresh connect never
 * reaches it; the picker's `provisionSocialChannel` is what provisions those.
 *
 * Deliberately the SAME body phase two runs (`provisionSocialChannel`): token swap → Integration
 * upsert → inbox link → page cache → webhook → publish. Two copies of this is how the reconnect
 * path and the picker path would drift.
 */
async function provisionChosenPage(
  ctx: PostConnectHookContext,
  provider: SocialProvider,
  grant: SocialGrant,
  page: FacebookPage,
  instagram?: InstagramAccount
): Promise<void> {
  const identity = await buildIdentity(grant, page, instagram)

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

  // Inbox-first (channels v2): a new (or legacy unlinked) channel REQUIRES a validated shared
  // inbox chosen up-front (forwarded via `pc_inboxId` → `ctx.extra.inboxId`); a reconnect of an
  // already-linked channel keeps its link and ignores the param.
  const existingLink = await db.query.InboxIntegration.findFirst({
    where: eq(schema.InboxIntegration.integrationId, integration.id),
  })
  if (!existingLink) {
    const recordId = await assertSharedConnectInbox(
      db,
      ctx.organizationId,
      ctx.extra?.inboxId as string | undefined
    )
    await new InboxService(db, ctx.organizationId, ctx.userId).addIntegration(
      recordId,
      integration.id
    )
  }

  await cacheAvailablePages(ctx.credentialId, identity.availablePages)

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
}

/** The social channel post-connect hook — handles `facebook` and `instagram`. */
export const socialProvisioningHook: PostConnectHook = {
  providerKeys: ['facebook', 'instagram'],
  async run(ctx: PostConnectHookContext): Promise<void | PostConnectHookResult> {
    const provider = PROVIDER_BY_KEY[ctx.providerKey]
    if (!provider) {
      logger.warn('No social provider mapping for key', { providerKey: ctx.providerKey })
      return
    }

    const userToken = await resolveUserTokenForCredential({
      credentialId: ctx.credentialId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
    })
    const grant = await fetchGrant(userToken)

    // A full-OAuth reconnect of a LIVE channel must relink the Page it already has, never show a
    // picker: a mis-click there would move a live channel onto a different Page or collide with
    // the `webhookRouteKey` unique index. Checked BEFORE candidate selection, so a reconnect
    // never pays for the Instagram probe fallback over pages it is not going to use.
    //
    // The rule keys on the INTEGRATION and NOT on `ctx.connectionId`: re-authing a *pending*
    // credential also arrives with `connectionId` set, has no Integration, and must legitimately
    // get the picker again. `isNull(deletedAt)` inside the lookup is what keeps a reconnect
    // after disconnect a fresh connect.
    const bound = await findLiveSocialIntegrationForCredential(ctx.credentialId, provider)
    if (bound?.pageId) {
      const forcedPage = grant.pages.find((page) => page.id === bound.pageId)
      if (!forcedPage) {
        throw new Error(
          `The Page “${bound.pageName ?? bound.pageId}” this channel is connected to is not ` +
            'available on this Facebook account. Grant it on the Facebook consent screen and try ' +
            'again, or disconnect the channel and connect a different Page.'
        )
      }
      const forcedInstagram =
        provider === 'instagram' ? await resolveInstagramFor(forcedPage) : undefined
      if (provider === 'instagram' && !forcedInstagram) {
        throw new Error(
          `The Facebook Page “${forcedPage.name}” no longer has a linked Instagram ` +
            'Professional account. Re-link it in Meta Business Suite and try again.'
        )
      }
      await provisionChosenPage(ctx, provider, grant, forcedPage, forcedInstagram)
      return
    }

    const { candidates } = await selectSocialCandidates(provider, grant.pages)

    // PICKER PATH — validate the inbox first so a bad one fails here rather than after the user
    // has picked, park the marker, and hand the choice to the UI. Nothing is provisioned.
    const inboxRecordId = await assertSharedConnectInbox(
      db,
      ctx.organizationId,
      ctx.extra?.inboxId as string | undefined
    )

    // Repeated abandoned connects would otherwise accumulate orphan credentials, because
    // `saveConnection` with no `connectionId` always INSERTs. Caps them at one per
    // (org, provider, user).
    await deleteSupersededPendingCredentials({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      providerKey: ctx.providerKey,
      keepCredentialId: ctx.credentialId,
    })

    const payload: SocialPageSelectionPayload = {
      provider,
      inboxRecordId,
      facebookUserId: grant.facebookUserId,
      candidateIds: candidates.map((page) => page.id),
      pages: grant.availablePages,
    }
    await writePendingSelection<SocialPageSelectionPayload>(ctx.credentialId, ctx.organizationId, {
      kind: SOCIAL_PAGE_SELECTION_KIND,
      providerKey: ctx.providerKey,
      payload,
    })
    await cacheAvailablePages(ctx.credentialId, grant.availablePages)

    logger.info('Social connect awaiting a page selection', {
      credentialId: ctx.credentialId,
      provider,
      candidates: candidates.length,
      pages: grant.pages.length,
    })
    return { awaiting: { kind: SOCIAL_PAGE_SELECTION_KIND, credentialId: ctx.credentialId } }
  },
}
