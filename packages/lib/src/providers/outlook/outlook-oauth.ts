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
  /** Revokes access (clears encrypted tokens and disables). */
  public static async revokeAccess(integrationId: string): Promise<boolean> {
    try {
      logger.warn('Attempting to revoke Outlook access (clearing tokens & disabling)', {
        integrationId,
      })

      await deleteChannelTokens(integrationId)

      await db
        .update(schema.Integration)
        .set({
          enabled: false,
          metadata: null,
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
