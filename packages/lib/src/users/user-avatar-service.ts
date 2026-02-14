// packages/lib/src/users/user-avatar-service.ts

import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { S3Adapter } from '../files/adapters/s3-adapter'
import type { UploadInitConfig } from '../files/upload/init-types'
import { UserProfileProcessor } from '../files/upload/processors/entity-processors'
import { SessionManager } from '../files/upload/session-manager'
import { createScopedLogger } from '../logger'

const logger = createScopedLogger('user-avatar-service')

export class UserAvatarService {
  /**
   * Download user profile image from OAuth URL and create MediaAsset using UserProfileProcessor
   * This method reuses the existing upload infrastructure for consistency
   */
  static async downloadAndCreateAvatarAsset(
    userId: string,
    imageUrl: string,
    organizationId: string
  ): Promise<string | null> {
    try {
      logger.info('Starting avatar download from OAuth provider', { userId, imageUrl })

      // 1. Download image from URL
      const response = await fetch(imageUrl)
      if (!response.ok) {
        logger.error('Failed to download image', { imageUrl, status: response.status })
        return null
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      const contentType = response.headers.get('content-type') || 'image/jpeg'
      const size = buffer.length

      // Check size limit (5MB for avatars)
      if (size > 5 * 1024 * 1024) {
        logger.warn('Image too large for avatar', { userId, size })
        return null
      }

      // 2. Use UserProfileProcessor to create config
      const processor = new UserProfileProcessor(organizationId, userId)

      const init: UploadInitConfig = {
        organizationId,
        userId,
        fileName: `avatar-${userId}.${contentType.split('/')[1] || 'jpg'}`,
        mimeType: contentType,
        expectedSize: size,
        entityType: 'USER_PROFILE',
        entityId: userId, // entityId is the userId for user profiles
        provider: 'S3',
        metadata: {
          source: 'oauth-import',
          originalUrl: imageUrl,
        },
      }

      const { config } = await processor.processConfig(init)

      // 3. Create upload session
      const uploadSession = await SessionManager.createSessionFromConfig(config)

      // 4. Upload to S3 directly (bypass presigned URL since we have the content)
      const s3Adapter = new S3Adapter()
      // await s3Adapter.init()

      const uploadResult = await s3Adapter.putObject({
        key: config.storageKey,
        content: buffer,
        mimeType: contentType,
        size,
        metadata: {
          sessionId: uploadSession.id,
          userId,
          source: 'oauth-profile-import',
        },
      })

      // 5. Create storage location record
      const [storageLocation] = await db
        .insert(schema.StorageLocation)
        .values({
          provider: 'S3',
          key: config.storageKey,
          size: size,
          mimeType: contentType,
          organizationId,
          metadata: {
            originalUrl: imageUrl,
            importedAt: new Date().toISOString(),
            sessionId: uploadSession.id,
          },
        })
        .returning()

      // 6. Use processor to complete the process (creates MediaAsset and updates user)
      const result = await processor.process(uploadSession, {
        storageKey: config.storageKey,
        size,
        mimeType: contentType,
      })

      // Clean up session
      await SessionManager.deleteSession(uploadSession.id)

      logger.info('Successfully created avatar asset from OAuth image', {
        userId,
        assetId: result.assetId,
        originalUrl: imageUrl,
      })

      return result.assetId
    } catch (error) {
      logger.error('Failed to create avatar asset from URL', {
        userId,
        imageUrl,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /**
   * Check and migrate avatar for a user if needed
   * Used during user creation or as a background job
   */
  static async checkAndMigrateAvatar(userId: string): Promise<boolean> {
    try {
      const [user] = await db
        .select({
          id: schema.User.id,
          image: schema.User.image,
          avatarAssetId: schema.User.avatarAssetId,
          defaultOrganizationId: schema.User.defaultOrganizationId,
        })
        .from(schema.User)
        .where(eq(schema.User.id, userId))
        .limit(1)

      if (!user) {
        logger.warn('User not found for avatar migration', { userId })
        return false
      }

      // Skip if no image URL or already has avatarAssetId
      if (!user.image || user.avatarAssetId) {
        return false
      }

      // Skip if no organization (shouldn't happen in normal flow)
      if (!user.defaultOrganizationId) {
        logger.warn('User has no default organization, skipping avatar migration', { userId })
        return false
      }

      const assetId = await UserAvatarService.downloadAndCreateAvatarAsset(
        userId,
        user.image,
        user.defaultOrganizationId
      )

      return !!assetId
    } catch (error) {
      logger.error('Error checking/migrating avatar', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }
}
