// packages/lib/src/providers/social/disconnect.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm'

const logger = createScopedLogger('social-disconnect')

/**
 * May we revoke this app's permissions for the Facebook user?
 *
 * `DELETE /{user-id}/permissions` revokes the app's access for the WHOLE user, not
 * for one page — so disconnecting a Facebook channel would silently kill every
 * other channel connected through the same Facebook account: the linked Instagram
 * channel, a second page, another org member's channel on the same login. They
 * keep their rows and their tokens and simply stop working.
 *
 * The page-level `subscribed_apps` unsubscribe is the correct per-channel teardown
 * and always runs. This gate only protects the account-wide step.
 *
 * @returns true when this is the last live channel on that Facebook user id.
 */
export async function isLastChannelForFacebookUser(args: {
  integrationId: string
  facebookUserId: string
}): Promise<boolean> {
  const { integrationId, facebookUserId } = args

  const siblings = await db
    .select({ id: schema.Integration.id })
    .from(schema.Integration)
    .where(
      and(
        ne(schema.Integration.id, integrationId),
        isNull(schema.Integration.deletedAt),
        or(
          eq(schema.Integration.provider, 'facebook'),
          eq(schema.Integration.provider, 'instagram')
        ),
        sql`${schema.Integration.metadata} ->> 'userId' = ${facebookUserId}`
      )
    )
    .limit(1)

  if (siblings.length > 0) {
    logger.info('Skipping app-permission revoke: other channels still use this Facebook account', {
      integrationId,
      facebookUserId,
    })
    return false
  }
  return true
}
