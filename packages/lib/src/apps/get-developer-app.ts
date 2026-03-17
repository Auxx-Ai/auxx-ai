// packages/lib/src/apps/get-developer-app.ts

import type { Database } from '@auxx/database'
import { getCachedAppBySlug } from '../cache/app-cache-helpers'

/**
 * Get app by slug with developer account access verification.
 * Uses the global app slug cache for app lookup, DB for developer account membership check.
 */
export async function getDeveloperApp(input: { slug: string; userId: string; db: Database }) {
  const { slug, userId, db } = input

  // Resolve app from cache
  const cachedApp = await getCachedAppBySlug(slug)

  if (!cachedApp) {
    return {
      ok: false as const,
      error: { code: 'APP_NOT_FOUND' as const, message: 'App not found', appSlug: slug },
    }
  }

  // Check developer account membership (org-scoped, must hit DB)
  const member = await db.query.DeveloperAccountMember.findFirst({
    where: (members, { and, eq }) =>
      and(eq(members.developerAccountId, cachedApp.developerAccountId), eq(members.userId, userId)),
  })

  if (!member) {
    return {
      ok: false as const,
      error: {
        code: 'DEVELOPER_ACCESS_DENIED' as const,
        message: 'You do not have access to this app',
        userId,
        appId: cachedApp.id,
      },
    }
  }

  // Fetch the full app with relations from DB (developer app page needs full data + relations)
  const app = await db.query.App.findFirst({
    where: (apps, { eq }) => eq(apps.id, cachedApp.id),
    with: {
      developerAccount: {
        with: {
          members: {
            where: (members, { eq }) => eq(members.userId, userId),
          },
        },
      },
    },
  })

  if (!app) {
    return {
      ok: false as const,
      error: { code: 'APP_NOT_FOUND' as const, message: 'App not found', appSlug: slug },
    }
  }

  return { ok: true as const, value: app }
}
