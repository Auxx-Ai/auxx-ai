// packages/lib/src/files/upload/session-manager.ts

import { getRedisClient } from '@auxx/redis'
import { createScopedLogger } from '@auxx/logger'
import { nanoid } from 'nanoid'
import type { PresignedUploadSession, UploadCompletionData } from './session-types'
import type { UploadPreparedConfig } from './init-types'

const logger = createScopedLogger('session-manager')

/**
 * Enhanced SessionManager for presigned upload implementation
 * Manages upload sessions with Redis persistence
 */
export class SessionManager {
  private static readonly SESSION_PREFIX = 'upload:session:'
  private static readonly DEFAULT_TTL = 10 * 60 // 10 minutes

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
      entityType: config.entityType,            // ✅ canonical only
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
      metadata: config.metadata || {},     // ✅ unified metadata
      policy: config.policy,              // persisted snapshot
      uploadPlan: config.uploadPlan,
      bucket: config.bucket,
      visibility: config.visibility,
      // ❌ Remove: processorType, processingMetadata
    }

    // Store in Redis with configured TTL
    const redis = await getRedisClient(true)
    await redis.setex(`${this.SESSION_PREFIX}${sessionId}`, config.ttlSec, JSON.stringify(session))

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
    const redis = await getRedisClient(true)
    const data = await redis.get(`${this.SESSION_PREFIX}${sessionId}`)
    if (!data) return null

    const session = JSON.parse(data) as PresignedUploadSession

    // Convert date strings back to Date objects
    session.createdAt = new Date(session.createdAt)
    session.expiresAt = new Date(session.expiresAt)

    return session
  }

  /**
   * Update session with partial data, preserving TTL
   */
  static async updateSession(
    sessionId: string,
    updates: Partial<PresignedUploadSession>
  ): Promise<void> {
    const session = await this.getSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)

    const updatedSession = { ...session, ...updates }

    // Preserve TTL: recompute remaining time from expiresAt
    const remainingTtl = Math.max(
      0, 
      Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)
    )

    const redis = await getRedisClient(true)
    await redis.setex(
      `${this.SESSION_PREFIX}${sessionId}`,
      remainingTtl, // ✅ Use remaining TTL, not default
      JSON.stringify(updatedSession)
    )
  }

  /**
   * Delete session
   */
  static async deleteSession(sessionId: string): Promise<void> {
    const redis = await getRedisClient(true)
    await redis.del(`${this.SESSION_PREFIX}${sessionId}`)
  }

  /**
   * Mark upload as completed and prepare for processing
   */
  static async completeUpload(sessionId: string, completion: UploadCompletionData): Promise<void> {
    await this.updateSession(sessionId, {
      status: 'processing',
      storageLocationId: completion.storageKey, // Temporary, will be replaced with real location ID
    })
  }

  /**
   * Extend session TTL during active upload
   */
  static async touchSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId)
    if (!session) return

    // Extend TTL while actively uploading
    const redis = await getRedisClient(true)
    await redis.setex(
      `${this.SESSION_PREFIX}${sessionId}`,
      this.DEFAULT_TTL,
      JSON.stringify(session)
    )
  }

  // NOTE: Storage key generation is now handled by processors via deriveStorageKey()
  // Keys come from UploadPreparedConfig.storageKey, not generated here
}
