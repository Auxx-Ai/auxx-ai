// apps/api/src/lib/callback-auth.ts

import { type CallbackScope, verifyCallbackToken } from '@auxx/credentials/lambda-auth'
import type { Context } from 'hono'
import { errorResponse } from './response'

/**
 * Verify a callback token from Lambda SDK requests.
 *
 * Extracts the installation ID from X-App-Installation-Id header
 * and the callback token from the Authorization: Bearer header.
 *
 * Returns the verified installationId and organizationId on success,
 * or sends a 401 response and returns null on failure.
 */
export function verifyCallbackAuth(
  c: Context,
  scope: CallbackScope
): { installationId: string; organizationId: string; connectionId?: string } | null {
  const installationId = c.req.header('X-App-Installation-Id')

  if (!installationId) {
    c.res = c.json(errorResponse('UNAUTHORIZED', 'App installation ID required'), 401) as any
    return null
  }

  const secret = process.env.LAMBDA_INVOKE_SECRET
  if (!secret) {
    // FAIL CLOSED. This previously fell through to "installation ID only", which
    // meant a deploy missing LAMBDA_INVOKE_SECRET silently disabled auth on every
    // /api/v1/sdk/* route — and `installationId` is a caller-supplied header, so
    // anyone could name any installation. Keying the bypass on the env var rather
    // than on NODE_ENV turned one missing variable into a platform-wide hole.
    //
    // The dev convenience is kept, but gated explicitly on NODE_ENV.
    if (process.env.NODE_ENV !== 'development') {
      c.res = c.json(
        errorResponse('AUTH_CONFIG_ERROR', 'Callback auth is not configured'),
        500
      ) as any
      return null
    }

    console.warn(
      '[CallbackAuth] LAMBDA_INVOKE_SECRET unset — callback tokens are NOT verified. Development only.'
    )
    return { installationId, organizationId: '' }
  }

  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    c.res = c.json(errorResponse('UNAUTHORIZED', 'Missing callback auth token'), 401) as any
    return null
  }

  const result = verifyCallbackToken({
    token: authHeader.slice(7),
    expectedInstallationId: installationId,
    expectedScope: scope,
    secret,
  })

  if (!result.valid) {
    c.res = c.json(
      errorResponse('UNAUTHORIZED', result.error ?? 'Invalid callback token'),
      401
    ) as any
    return null
  }

  return {
    installationId,
    organizationId: result.organizationId ?? '',
    connectionId: result.connectionId,
  }
}
