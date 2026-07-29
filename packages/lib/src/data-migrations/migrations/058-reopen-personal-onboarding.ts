// packages/lib/src/data-migrations/migrations/058-reopen-personal-onboarding.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNotNull, isNull, or } from 'drizzle-orm'
import { onCacheEvent } from '../../cache'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-057')

/**
 * Reopen the personal onboarding step for users who were marked done without ever
 * being asked for a name.
 *
 * `seedNewUserDatabase`'s invite branch used to set `completedOnboarding: true` the
 * moment an invited account was created, and signup sends `name: ''` — so an invited
 * member landed in the app with no name, no avatar, and no screen that would ever ask
 * for one. The org-level gate can't catch them (they join an org that is already
 * onboarded) and the user-level gate was never armed. That flag is now `false` for
 * new invitees; this migration retroactively opens the gate for the ones already in
 * the database.
 *
 * Targets only genuinely nameless accounts. `userType = 'USER'` is load-bearing:
 * AGENT and system users carry `completedOnboarding: true` deliberately
 * (`system-user-service.ts`, `createAgent`) and must never be gated — they never sign
 * in, so a redirect they can't satisfy would be invisible until something breaks.
 * Demo users are seeded with a name and are excluded by the name predicate.
 *
 * Busts each affected user's `userProfile` cache: `completedOnboarding` is read back
 * out of that key to build the dehydrated state the `/app` gate reads
 * (`user-profile-provider.ts`), so a row-only update would leave the gate looking at
 * the pre-migration value.
 *
 * Idempotent: re-running matches strictly fewer rows each time (a user who completes
 * the step gains a name and drops out of the predicate), and writing `false` onto a
 * row that already reads `false` is a no-op.
 */
export const migration058ReopenPersonalOnboarding: DataMigrationDef = {
  id: '058-reopen-personal-onboarding',
  description:
    'Reopen the personal onboarding step for nameless users marked complete by the old invite path',
  async run(db: Database): Promise<void> {
    const nameless = and(
      eq(schema.User.userType, 'USER'),
      eq(schema.User.banned, false),
      eq(schema.User.completedOnboarding, true),
      // Load-bearing: the personal step submits through `user.updateProfile`, a
      // `protectedProcedure`, which throws UNAUTHORIZED without a default org
      // (trpc.ts). Reopening the gate for a user who has none would strand them on
      // a screen they can never get past.
      isNotNull(schema.User.defaultOrganizationId),
      isNull(schema.User.firstName),
      isNull(schema.User.lastName),
      or(isNull(schema.User.name), eq(schema.User.name, ''))
    )

    const affected = await db
      .select({ id: schema.User.id, defaultOrganizationId: schema.User.defaultOrganizationId })
      .from(schema.User)
      .where(nameless)

    if (affected.length === 0) {
      logger.info('No nameless users to reopen onboarding for')
      return
    }

    await db
      .update(schema.User)
      .set({ completedOnboarding: false, updatedAt: new Date() })
      .where(nameless)

    for (const user of affected) {
      // `defaultOrganizationId` is non-null by the predicate above.
      await onCacheEvent('user.updated', {
        orgId: user.defaultOrganizationId!,
        userId: user.id,
      })
    }

    logger.info('Reopened personal onboarding for nameless users', { count: affected.length })
  },
}
