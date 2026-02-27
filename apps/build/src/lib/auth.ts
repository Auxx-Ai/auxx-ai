// apps/build/src/lib/auth.ts
// Authentication utilities for developer portal

import { WEBAPP_URL } from '@auxx/config/urls'
import { configService } from '@auxx/credentials'
import { DeveloperAccountMember, database } from '@auxx/database'
import { getRedisClient } from '@auxx/redis'
import { and, eq } from 'drizzle-orm'
import { jwtVerify, SignJWT } from 'jose'
import { cookies } from 'next/headers'

const SESSION_COOKIE_NAME = 'auxx-build.session'
const SESSION_DURATION = 60 * 60 // 1 hour in seconds

/** Session type */
export interface Session {
  userId: string
  email: string
}

/** Get the session signing secret — fails fast if not configured */
function getSessionSecret(): Uint8Array {
  const secret = configService.get<string>('BUILD_SESSION_SECRET')
  if (!secret) throw new Error('BUILD_SESSION_SECRET not configured')
  return new TextEncoder().encode(secret)
}

/** Create a signed local session JWT */
export async function createLocalSession(user: { userId: string; email: string }): Promise<string> {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION}s`)
    .sign(getSessionSecret())
}

/** Verify a local session cookie, return user info or null */
export async function verifyLocalSession(
  token: string
): Promise<{ userId: string; email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret())

    if (!payload.sub || !payload.email) return null
    return { userId: payload.sub, email: payload.email as string }
  } catch {
    return null
  }
}

/** Consume a login token jti (single-use). Returns true if consumed, false if already used. */
export async function consumeLoginTokenJti(jti: string): Promise<boolean> {
  const redis = await getRedisClient()
  if (!redis) return false
  // SET NX EX: only set if not exists, expire after 10 minutes
  const result = await redis.set(`login-token:${jti}`, 'consumed', 'EX', 600, 'NX')
  return result === 'OK'
}

/** Get local session from cookie */
export async function getLocalSession(): Promise<Session | null> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)
  if (!sessionCookie?.value) return null
  return verifyLocalSession(sessionCookie.value)
}

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
