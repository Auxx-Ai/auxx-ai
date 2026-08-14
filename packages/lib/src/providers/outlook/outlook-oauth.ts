// packages/lib/src/providers/outlook/outlook-oauth.ts
//
// Outlook channel runtime auth helpers. The OAuth *connect* flow (auth URL, callback,
// initial/reauth provisioning) and token refresh have moved to the unified connections
// layer (generic authorize/callback + post-connect provisioning hook + resolver-based
// refresh). What remains here is the runtime Graph client builder used for message ops.
//
// Token refresh is no longer owned here: `getAuthenticatedClient` pulls a fresh bearer
// token from the connection layer (`getChannelAccessToken`), which lazily refreshes and
// rotates Microsoft's rolling refresh token through `ensureFreshCredentialToken`. MSAL
// (`@azure/msal-node`) was dropped after the §7 verification confirmed a raw Microsoft
// token POST returns and persists a usable rolling refresh_token.

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { Client } from '@microsoft/microsoft-graph-client'
import { eq } from 'drizzle-orm'
import { AuthErrorHandler } from '../auth-error-handler'
import { deleteChannelTokens, getChannelAccessToken } from '../channel-token-accessor'

const logger = createScopedLogger('outlook-oauth')

/** Data stored in Integration.metadata for Outlook */
export interface OutlookIntegrationMetadata {
  email: string
  homeAccountId: string
  emailAliases?: string[]
  isCustomCredentials?: boolean
  credentialClientId?: string
}

/** Context needed to create an authenticated Graph client. Only `integrationId` is used at
 * runtime — the token is resolved fresh per request via the connection layer. */
export interface OutlookClientContext {
  integrationId: string
  organizationId: string
  refreshToken?: string | null
  accessToken?: string | null
  expiresAt?: Date | null
  homeAccountId?: string
  email?: string
}

export class OutlookOAuthService {
  /**
   * Revokes access: removes the Graph subscription first, then clears encrypted tokens and
   * disables the integration.
   *
   * Order matters (mirrors `GoogleOAuthService.revokeAccess`'s
   * `disablePushNotifications`-first shape): once tokens are gone and `webhookRouteKey` /
   * `metadata` are wiped, removing the subscription is no longer possible — the provider can't
   * authenticate to Graph and there is no id left to delete. Left un-removed, it silently
   * orphans and only self-heals when it expires (≤7 days). Removal is best-effort — a Graph
   * outage or an already-gone subscription must never block a disconnect.
   */
  public static async revokeAccess(integrationId: string): Promise<boolean> {
    try {
      logger.warn('Attempting to revoke Outlook access (clearing tokens & disabling)', {
        integrationId,
      })

      const [row] = await db
        .select({
          id: schema.Integration.id,
          organizationId: schema.Integration.organizationId,
          enabled: schema.Integration.enabled,
        })
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)

      if (row) {
        try {
          // Dynamic: a static import would cycle (ProviderRegistryService imports
          // OutlookProvider, which imports this file).
          const { ProviderRegistryService } = await import('../provider-registry-service')
          const provider = await new ProviderRegistryService(row.organizationId).getProvider(
            integrationId
          )
          await provider.removeWebhook() // 404-tolerant internally
        } catch (error) {
          logger.warn(
            'Could not remove Graph subscription during revoke — it will expire on its own (≤7 days)',
            { integrationId, error: error instanceof Error ? error.message : String(error) }
          )
        }
      }

      await deleteChannelTokens(integrationId)

      await db
        .update(schema.Integration)
        .set({
          enabled: false,
          metadata: null,
          // `metadata: null` no longer implicitly clears the subscription id now that it
          // lives in this column (§3.4) — null it explicitly.
          webhookRouteKey: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.Integration.id, integrationId))

      logger.info(
        `Cleared tokens/metadata and disabled Outlook integration ${integrationId} in DB.`
      )
      return true
    } catch (error: unknown) {
      const err = error as { message?: string }
      logger.error('Error revoking Outlook access:', { error: err.message, integrationId })
      throw new Error(`Failed to revoke Outlook access: ${err.message}`)
    }
  }

  /**
   * Creates an authenticated Graph client for a channel. The Graph `authProvider` callback
   * resolves a fresh access token from the connection layer on every request — lazy refresh,
   * single-flight, and rolling-refresh-token persistence all happen inside
   * `getChannelAccessToken` → `resolveConnectionForRuntime`.
   */
  public static async getAuthenticatedClient(ctx: OutlookClientContext): Promise<Client> {
    if (!ctx.integrationId) {
      throw new Error('Cannot create authenticated client: Missing integrationId.')
    }
    const { integrationId } = ctx

    return Client.init({
      authProvider: async (done) => {
        try {
          const accessToken = await getChannelAccessToken(integrationId)
          if (!accessToken) {
            throw new Error('Could not resolve a fresh Outlook access token')
          }
          done(null, accessToken)
        } catch (error) {
          const handler = new AuthErrorHandler('outlook', integrationId)
          // Fire-and-forget: the Graph authProvider callback must call `done()`; the handler
          // write is best-effort and the surfaced error still triggers the caller's retry path.
          handler
            .handleAuthError(error, 'graph_auth_provider')
            .catch((handlerErr: unknown) =>
              logger.error('AuthErrorHandler failed in Graph authProvider', { handlerErr })
            )

          done(error instanceof Error ? error : new Error(String(error)), null)
        }
      },
    })
  }
}
