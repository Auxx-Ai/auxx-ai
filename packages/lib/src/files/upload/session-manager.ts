// packages/lib/src/files/upload/session-manager.ts

import { createScopedLogger } from '@auxx/logger'
import { getRedisClient, type RedisClient } from '@auxx/redis'
import { nanoid } from 'nanoid'
import type { UploadPreparedConfig } from './init-types'
import type { PresignedUploadSession, UploadCompletionData } from './session-types'

const logger = createScopedLogger('session-manager')

/**
 * Enhanced SessionManager for presigned upload implementation
 * Manages upload sessions with Redis persistence
 */
export class SessionManager {
  private static readonly SESSION_PREFIX = 'upload:session:'
  private static readonly DEFAULT_TTL = 10 * 60 // 10 minutes
  /**
   * Floor applied when rewriting a session's key. Redis rejects a SETEX of 0, and a
   * one-second key would evaporate mid-completion, so an update on a session whose
   * `expiresAt` has already passed buys enough time to finish the flow in progress.
   */
  private static readonly MIN_UPDATE_TTL = 60 // 1 minute

  /**
   * Resolve the Redis client. Upload sessions have no in-memory fallback, so an unavailable
   * Redis is a hard failure rather than a silently skipped write.
   */
  private static async getRedis(): Promise<RedisClient> {
    const client = await getRedisClient(true)
    if (!client) {
      throw new Error('Redis is required for upload sessions but is unavailable')
    }
    return client
  }

  /**
   * Create new presigned upload session from processor config
   * This is the new unified API that replaces createSession()
   */
  static async createSessionFromConfig(
    config: UploadPreparedConfig
  ): Promise<PresignedUploadSession> {
    const sessionId = nanoid()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + config.ttlSec * 1000)

    const session: PresignedUploadSession = {
      version: 2,
      id: sessionId,
      organizationId: config.organizationId,
      userId: config.userId,
      entityType: config.entityType, // ✅ canonical only
      entityId: config.entityId,
      fileName: config.fileName,
      mimeType: config.mimeType,
      expectedSize: config.expectedSize,
      provider: config.provider,
      storageKey: config.storageKey,
      credentialId: config.credentialId,
      isMultipart: config.uploadPlan.strategy === 'multipart',
      uploadMethod: 'PUT', // Will be set by storage provider
      status: 'created',
      createdAt: now,
      expiresAt,
      ttlSec: config.ttlSec,
      metadata: config.metadata || {}, // ✅ unified metadata
      policy: config.policy, // persisted snapshot
      uploadPlan: config.uploadPlan,
      bucket: config.bucket,
      visibility: config.visibility,
      // ❌ Remove: processorType, processingMetadata
    }

    // Store in Redis with configured TTL
    const redis = await SessionManager.getRedis()
    await redis.setex(
      `${SessionManager.SESSION_PREFIX}${sessionId}`,
      config.ttlSec,
      JSON.stringify(session)
    )

    logger.info('Created presigned upload session from config', {
      sessionId,
      organizationId: session.organizationId,
      entityType: session.entityType,
      fileName: session.fileName,
      size: session.expectedSize,
      provider: session.provider,
      strategy: config.uploadPlan.strategy,
    })

    return session
  }

  /**
   * Get existing session by ID
   */
  static async getSession(sessionId: string): Promise<PresignedUploadSession | null> {
    const redis = await SessionManager.getRedis()
    const data = await redis.get(`${SessionManager.SESSION_PREFIX}${sessionId}`)
    if (!data) return null

    const session = JSON.parse(data) as PresignedUploadSession

    // Convert date strings back to Date objects
    session.createdAt = new Date(session.createdAt)
    session.expiresAt = new Date(session.expiresAt)

    return session
  }

  /**
   * Update session with partial data, preserving TTL.
   *
   * The key is only rewritten for a session Redis still holds, so a floored TTL can
   * never resurrect an evicted session — it only keeps a live one alive long enough
   * for the caller (typically the completion route) to finish.
   */
  static async updateSession(
    sessionId: string,
    updates: Partial<PresignedUploadSession>
  ): Promise<void> {
    const session = await SessionManager.getSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)

    const updatedSession = { ...session, ...updates }

    // Preserve TTL: recompute remaining time from expiresAt, never below the floor.
    // SETEX rejects a non-positive expiry, which would fail an upload whose bytes are
    // already stored.
    const remainingTtl = Math.max(
      SessionManager.MIN_UPDATE_TTL,
      Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)
    )

    const redis = await SessionManager.getRedis()
    await redis.setex(
      `${SessionManager.SESSION_PREFIX}${sessionId}`,
      remainingTtl, // ✅ Use remaining TTL, not default
      JSON.stringify(updatedSession)
    )
  }

  /**
   * Delete session
   */
  static async deleteSession(sessionId: string): Promise<void> {
    const redis = await SessionManager.getRedis()
    await redis.del(`${SessionManager.SESSION_PREFIX}${sessionId}`)
  }

  /**
   * Mark upload as completed and prepare for processing
   *
   * @deprecated No production caller. Only `__tests__/unified-upload-integration.test.ts`
   * still exercises it, and the `storageLocationId` it writes is a storage key, not a
   * `StorageLocation` id. Delete both together.
   */
  static async completeUpload(sessionId: string, completion: UploadCompletionData): Promise<void> {
    await SessionManager.updateSession(sessionId, {
      status: 'processing',
      storageLocationId: completion.storageKey, // Temporary, will be replaced with real location ID
    })
  }

  /**
   * Extend session TTL during active upload.
   *
   * Extends by the session's own `ttlSec` — the lifetime its processor asked for —
   * so touching a long-lived session cannot shorten it to the 10-minute default.
   * The refreshed `expiresAt` is written back with the key: the stored value and the
   * Redis TTL must never disagree, or `updateSession` recomputes a remaining TTL from
   * an `expiresAt` that has silently drifted into the past.
   */
  static async touchSession(sessionId: string): Promise<void> {
    const session = await SessionManager.getSession(sessionId)
    if (!session) return

    const extendSec = session.ttlSec > 0 ? session.ttlSec : SessionManager.DEFAULT_TTL
    const refreshed: PresignedUploadSession = {
      ...session,
      expiresAt: new Date(Date.now() + extendSec * 1000),
    }

    const redis = await SessionManager.getRedis()
    await redis.setex(
      `${SessionManager.SESSION_PREFIX}${sessionId}`,
      extendSec,
      JSON.stringify(refreshed)
    )
  }

  // NOTE: Storage key generation is now handled by processors via deriveStorageKey()
  // Keys come from UploadPreparedConfig.storageKey, not generated here
}
