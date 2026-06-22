// packages/lib/src/channels/oauth.ts

import crypto from 'node:crypto'
import { BadRequestError } from '../errors'
import { createScopedLogger } from '../logger'
import { FacebookOAuthService } from '../providers/facebook/facebook-oauth'
import { InstagramOAuthService } from '../providers/instagram/instagram-oauth'
import type { ChannelProviderType } from '../providers/types'
import { Result, type TypedResult } from '../result'
import type { ChannelCtx } from './types'

const logger = createScopedLogger('channels.oauth')

/**
 * Get OAuth URL for the given provider. `userId` is required.
 *
 * Gmail/Outlook connect through the unified connections OAuth flow (the generic
 * `/api/connections/[id]/oauth2/authorize` route); this dispatcher now only serves the
 * social channels (Facebook / Instagram) that still use the legacy per-provider flow.
 */
export async function getAuthUrl(
  ctx: ChannelCtx & { userId: string },
  provider: ChannelProviderType,
  redirectPath?: string
): Promise<TypedResult<{ authUrl: string | null; csrfToken: string }, BadRequestError>> {
  if (provider === 'chat') {
    return Result.error(
      new BadRequestError('OAuth authentication is not applicable for chat widgets')
    )
  }

  let authUrl: string | null = null
  const csrfToken = crypto.randomBytes(32).toString('hex')

  try {
    switch (provider) {
      case 'facebook': {
        const facebookOAuthService = FacebookOAuthService.getInstance()
        authUrl = await facebookOAuthService.getAuthUrl(ctx.organizationId, ctx.userId, {
          redirectPath,
          csrfToken,
        })
        break
      }
      case 'instagram': {
        const instagramOAuthService = InstagramOAuthService.getInstance()
        authUrl = instagramOAuthService.getAuthUrl(ctx.organizationId, ctx.userId, {
          redirectPath,
          csrfToken,
        })
        break
      }
      default:
        return Result.error(new BadRequestError(`Unsupported provider: ${provider}`))
    }
  } catch (error: any) {
    logger.error('Error generating auth URL:', {
      error: error.message,
      provider,
    })
    throw error
  }

  return Result.ok({ authUrl, csrfToken })
}
