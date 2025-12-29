// apps/api/src/lib/jwt-validator.ts

import { BETTER_AUTH_USERINFO_URL } from '../config'
import { createScopedLogger } from '@auxx/logger'
import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'

const logger = createScopedLogger('jwt-validator')

/**
 * In-memory LRU cache for OAuth token validation
 * Reduces database queries by caching validated tokens
 */
class TokenCache {
  private cache = new Map<string, { data: ValidatedToken; expiresAt: number }>()
  private maxSize = 1000 // Maximum number of tokens to cache
  private ttl = 5 * 60 * 1000 // 5 minutes TTL

  get(token: string): ValidatedToken | null {
    const entry = this.cache.get(token)
    if (!entry) return null

    // Check if cache entry is expired
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(token)
      return null
    }

    return entry.data
  }

  set(token: string, data: ValidatedToken): void {
    // Implement simple LRU: if cache is full, remove oldest entry
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }

    this.cache.set(token, {
      data,
      expiresAt: Date.now() + this.ttl,
    })
  }

  clear(): void {
    this.cache.clear()
  }
}

const tokenCache = new TokenCache()

export interface ValidatedToken {
  userId: string
  email: string
  scopes: string[]
  expiresAt: number
}

export type ValidationError =
  | { code: 'MISSING_TOKEN' }
  | { code: 'INVALID_TOKEN' }
  | { code: 'TOKEN_EXPIRED' }
  | { code: 'VALIDATION_FAILED'; message: string }

/**
 * Validate access token from better-auth OIDC/OAuth flow
 * OAuth access tokens are validated using the UserInfo endpoint
 * This is the standard OAuth2 way to validate access tokens
 *
 * Caching Strategy:
 * - Tokens are cached in-memory for 5 minutes after first validation
 * - Cache is checked before making DB/API calls
 * - On cache miss: validates via UserInfo endpoint + DB query for scopes
 * - On cache hit: returns immediately without DB/API calls
 * - LRU eviction when cache exceeds 1000 entries
 * - This reduces DB load from 1 query/request to 1 query/5min per token
 */
export async function validateBetterAuthToken(
  token: string
): Promise<{ success: true; data: ValidatedToken } | { success: false; error: ValidationError }> {
  try {
    // Check cache first
    const cached = tokenCache.get(token)
    if (cached) {
      logger.debug('Token validation cache hit', {
        userId: cached.userId,
        tokPreview: token.substring(0, 10) + '...',
      })
      return { success: true, data: cached }
    }

    logger.info('Validating token (cache miss)', {
      tokPreview: token.substring(0, 30) + '...',
      tokLength: token.length,
      isJWT: token.split('.').length === 3,
    })

    // Call better-auth UserInfo endpoint to validate OAuth access token
    // This is the standard way to validate OAuth2 access tokens
    logger.info('Calling better-auth UserInfo endpoint', {
      url: BETTER_AUTH_USERINFO_URL,
    })

    const response = await fetch(BETTER_AUTH_USERINFO_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    const responseText = await response.text()
    logger.info('UserInfo endpoint response', {
      status: response.status,
      statusText: response.statusText,
      bodyPreview: responseText.substring(0, 200),
    })

    if (!response.ok) {
      if (response.status === 401) {
        logger.error('Token validation failed - 401 Unauthorized', {
          responseBody: responseText,
        })
        return { success: false, error: { code: 'INVALID_TOKEN' } }
      }
      logger.error('UserInfo validation failed', {
        status: response.status,
        body: responseText,
      })
      return {
        success: false,
        error: { code: 'VALIDATION_FAILED', message: 'Token validation failed' },
      }
    }

    const userInfo: any = JSON.parse(responseText)

    logger.info('User info retrieved', {
      hasSub: !!userInfo.sub,
      hasEmail: !!userInfo.email,
    })

    // Extract user information from UserInfo response
    // OIDC UserInfo returns: sub (user ID), email, name, etc.
    if (!userInfo.sub || !userInfo.email) {
      logger.error('Invalid UserInfo response - missing sub or email')
      return { success: false, error: { code: 'INVALID_TOKEN' } }
    }

    // Query the oauthAccessToken table to get scopes and expiration
    // The UserInfo endpoint doesn't return scopes, so we need to look them up
    logger.info('Querying oauthAccessToken for scopes', {
      token: token.substring(0, 10) + '...',
    })

    const oauthTokens = await database
      .select()
      .from(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.accessToken, token))
      .limit(1)

    const oauthToken = oauthTokens[0]

    if (!oauthToken) {
      logger.error('OAuth token not found in database')
      return { success: false, error: { code: 'INVALID_TOKEN' } }
    }

    // Check if token is expired
    const expiresAt = new Date(oauthToken.accessTokenExpiresAt).getTime()
    if (expiresAt < Date.now()) {
      logger.warn('Token expired', {
        expiresAt: oauthToken.accessTokenExpiresAt,
        now: new Date(),
      })
      return { success: false, error: { code: 'TOKEN_EXPIRED' } }
    }

    // Parse scopes from space-separated string
    const scopes: string[] = oauthToken.scopes ? oauthToken.scopes.split(' ') : []

    logger.info('Token validated successfully', {
      userId: userInfo.sub,
      email: userInfo.email,
      scopes,
    })

    const validatedData: ValidatedToken = {
      userId: userInfo.sub,
      email: userInfo.email,
      scopes,
      expiresAt,
    }

    // Cache the validated token to avoid DB queries on subsequent requests
    tokenCache.set(token, validatedData)

    return {
      success: true,
      data: validatedData,
    }
  } catch (error) {
    logger.error('Token validation error', {
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    }
  }
}

/**
 * Extract Bearer token from Authorization header
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null

  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null

  return parts[1] || null
}
