// apps/build/src/lib/auth.ts
// Authentication utilities for developer portal

import { cookies } from 'next/headers'
import { database, DeveloperAccountMember } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { WEBAPP_URL, DEV_PORTAL_URL } from '@auxx/config/client'

/** Session type */
export interface Session {
  userId: string
  userEmail: string
  userName: string | null
  userFirstName: string | null
  userLastName: string | null
  userImage: string | null
}

/**
 * Get current session by validating with apps/web
 */
export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('better-auth.session_token')

  if (!sessionCookie) {
    return null
  }

  try {
    // Validate session with apps/web
    const response = await fetch(`${WEBAPP_URL}/api/auth/session`, {
      headers: {
        Cookie: `better-auth.session_token=${sessionCookie.value}`,
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    return data.session
  } catch (error) {
    console.error('Failed to validate session:', error)
    return null
  }
}

/**
 * Get login URL with return path
 */
export function getLoginUrl(returnPath?: string): string {
  const callbackUrl = `${DEV_PORTAL_URL}${returnPath || '/'}`
  return `${WEBAPP_URL}/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
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
