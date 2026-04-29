// apps/build/src/lib/auth.ts
// Authentication utilities for developer portal

import { WEBAPP_URL } from '@auxx/config/urls'
import { createLocalSessionHelpers } from '@auxx/credentials/local-session'
import { DeveloperAccountMember, database } from '@auxx/database'
import { getRedisClient } from '@auxx/redis'
import { and, eq } from 'drizzle-orm'
import { cookies } from 'next/headers'

const helpers = createLocalSessionHelpers({
  cookieName: 'auxx-build.session',
  secretEnv: 'BUILD_SESSION_SECRET',
  ttlSeconds: 60 * 60, // 1 hour
  getCookieStore: () => cookies(),
  getRedis: () => getRedisClient(),
})

export type Session = { userId: string; email: string }

export const createLocalSession = helpers.createSession
export const verifyLocalSession = helpers.verifySession
export const getLocalSession = helpers.getSession
export const consumeLoginTokenJti = helpers.consumeLoginTokenJti

/**
 * Get login URL with return path
 */
export function getLoginUrl(returnPath?: string): string {
  return `${WEBAPP_URL}/login?callbackApp=build&returnTo=${encodeURIComponent(returnPath || '/')}`
}

/**
 * Verify user is a member of a developer account
 */
export async function verifyMembership(developerAccountId: string, userId: string): Promise<void> {
  const [member] = await database
    .select()
    .from(DeveloperAccountMember)
    .where(
      and(
        eq(DeveloperAccountMember.developerAccountId, developerAccountId),
        eq(DeveloperAccountMember.userId, userId)
      )
    )
    .limit(1)

  if (!member) {
    throw new Error('Not a member of this developer account')
  }
}

/**
 * Verify user has admin access to a developer account
 */
export async function verifyAdminMembership(
  developerAccountId: string,
  userId: string
): Promise<void> {
  const [member] = await database
    .select()
    .from(DeveloperAccountMember)
    .where(
      and(
        eq(DeveloperAccountMember.developerAccountId, developerAccountId),
        eq(DeveloperAccountMember.userId, userId),
        eq(DeveloperAccountMember.accessLevel, 'admin')
      )
    )
    .limit(1)

  if (!member) {
    throw new Error('Admin access required')
  }
}
