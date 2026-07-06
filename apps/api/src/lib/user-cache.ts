// apps/api/src/lib/user-cache.ts

import { database, schema, type UserEntity } from '@auxx/database'
import { eq } from 'drizzle-orm'

/**
 * In-memory LRU for User rows resolved during request auth, mirroring the
 * token cache in jwt-validator: token validation is served from a 5-minute
 * LRU, but every request still paid an uncached `User` SELECT. Sharing the
 * same TTL means user changes (ban, delete, profile edits) propagate no
 * slower than the token-cache staleness already allows.
 */
class UserRowCache {
  private cache = new Map<string, { user: UserEntity; expiresAt: number }>()
  private maxSize = 1000
  private ttl = 5 * 60 * 1000 // 5 minutes, matching TokenCache

  get(userId: string): UserEntity | null {
    const entry = this.cache.get(userId)
    if (!entry) return null

    if (entry.expiresAt < Date.now()) {
      this.cache.delete(userId)
      return null
    }

    return entry.user
  }

  set(userId: string, user: UserEntity): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }

    this.cache.set(userId, { user, expiresAt: Date.now() + this.ttl })
  }
}

const userRowCache = new UserRowCache()

/**
 * Fetch a User row with a 5-minute in-memory cache. For the request-auth hot
 * path only — use a direct query where write-after-read freshness matters.
 */
export async function getCachedUserRow(userId: string): Promise<UserEntity | null> {
  const cached = userRowCache.get(userId)
  if (cached) return cached

  const users = await database.select().from(schema.User).where(eq(schema.User.id, userId)).limit(1)

  const user = users[0]
  if (user) userRowCache.set(userId, user)

  return user ?? null
}
