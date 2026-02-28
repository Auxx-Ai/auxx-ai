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
): { installationId: string; organizationId: string } | null {
  const installationId = c.req.header('X-App-Installation-Id')

  if (!installationId) {
    c.res = c.json(errorResponse('UNAUTHORIZED', 'App installation ID required'), 401) as any
    return null
  }

  const secret = process.env.LAMBDA_INVOKE_SECRET
  if (!secret) {
    // No secret configured — fall back to installation ID only (dev mode)
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

  return { installationId, organizationId: result.organizationId ?? '' }
}
