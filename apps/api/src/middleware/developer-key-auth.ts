// apps/api/src/middleware/developer-key-auth.ts

import { hashApiKey } from '@auxx/credentials/api-key'
import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { Context, Next } from 'hono'
import { errorResponse } from '../lib/response'
import { getCachedUserRow } from '../lib/user-cache'
import type { AppContext } from '../types/context'

/**
 * Fixed scope set granted to any `type: 'developer'` API key. Developer keys
 * exist solely for headless CLI publishing (CI); per-app authorization is still
 * enforced downstream by `verifyAppAccess` against `DeveloperAccountMember`.
 */
const DEVELOPER_KEY_SCOPES = ['developer', 'apps:write', 'apps:read']

/**
 * Resolve a developer API key (bearer token with the `auxx_dev_` prefix) and set
 * the request context, mirroring the better-auth bearer path. Validation is a
 * single indexed lookup: `hashApiKey` is deterministic (fixed env salt), so we
 * hash the incoming token and query the unique `hashedKey` index — no per-row
 * scrypt loop and no better-auth round-trip.
 *
 * Only `type: 'developer'` keys are accepted here; product keys
 * ('app'/'workflow'/'chat') are rejected so they stay non-publish-capable.
 */
export async function developerKeyAuth(c: Context<AppContext>, next: Next, token: string) {
  const hashedKey = hashApiKey(token)

  const apiKey = await database.query.ApiKey.findFirst({
    where: eq(schema.ApiKey.hashedKey, hashedKey),
  })

  if (!apiKey || !apiKey.isActive || apiKey.type !== 'developer') {
    return c.json(errorResponse('UNAUTHORIZED', 'Invalid API key'), 401)
  }

  // ApiKey.userId is a real User.id. Membership of the target app's developer
  // account is checked per-app by verifyAppAccess, not here. The ApiKey lookup
  // above stays uncached so key revocation applies immediately; the User row
  // is served from the shared 5-minute cache.
  const user = await getCachedUserRow(apiKey.userId)

  if (!user) {
    return c.json(errorResponse('UNAUTHORIZED', 'User not found'), 401)
  }

  c.set('userId', apiKey.userId)
  c.set('user', user)
  c.set('scopes', DEVELOPER_KEY_SCOPES)
  c.set('token', {
    userId: apiKey.userId,
    email: user.email,
    scopes: DEVELOPER_KEY_SCOPES,
    expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
  })

  await next()
}
