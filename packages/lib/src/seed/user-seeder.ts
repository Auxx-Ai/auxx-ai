// packages/lib/src/seed/user-seeder.ts
import { type Database, database as defaultDb } from '@auxx/database'
import type { UserEntity as User } from '@auxx/database/types'
import { createScopedLogger } from '../logger'
import { UserAvatarService } from '../users/user-avatar-service'

const logger = createScopedLogger('user-seeder')

export interface UserSeedResult {
  avatarMigrated: boolean
  avatarAssetId?: string | null
  signatureCreated: boolean
  signatureId?: string | null
  errors: string[]
}
export interface UserSeedOptions {
  // Future options can be added here
  skipAvatarMigration?: boolean
  skipDefaultSignature?: boolean
}

export class UserSeeder {
  constructor(
    private organizationId: string,
    private user: Pick<User, 'id' | 'image' | 'avatarAssetId' | 'name' | 'email'>,
    private db: Database = defaultDb
  ) {}
  /**
   * Seeds user-specific data after user creation/update
   * Handles avatar migration and future user initialization tasks
   * @param options - Configuration options for seeding
   */
  async seedNewUser(options: UserSeedOptions = {}): Promise<UserSeedResult> {
    const result: UserSeedResult = {
      avatarMigrated: false,
      signatureCreated: false,
      errors: [],
    }
    logger.info('Starting user seeding', {
      userId: this.user.id,
      organizationId: this.organizationId,
      hasImage: !!this.user.image,
    })
    // Run avatar migration and signature setup in parallel
    const promises: Promise<void>[] = []
    // 1. Avatar Migration
    if (!options.skipAvatarMigration) {
      promises.push(
        this.migrateOAuthAvatar().then((avatarResult) => {
          result.avatarMigrated = avatarResult.migrated
          result.avatarAssetId = avatarResult.assetId
          if (avatarResult.error) {
            result.errors.push(avatarResult.error)
          }
        })
      )
    }
    // 2. Default Signature Creation
    if (!options.skipDefaultSignature) {
      promises.push(
        this.setupDefaultSignature().then((signatureResult) => {
          result.signatureCreated = signatureResult.created
          result.signatureId = signatureResult.signatureId
          if (signatureResult.error) {
            result.errors.push(signatureResult.error)
          }
        })
      )
    }
    // Wait for all operations to complete
    await Promise.all(promises)
    // 3. Future: Default notification settings
    // await this.setupDefaultNotifications()
    // 4. Future: Welcome flow triggers
    // await this.triggerWelcomeFlow()
    logger.info('User seeding completed', {
      userId: this.user.id,
      organizationId: this.organizationId,
      result,
    })
    return result
  }
  /**
   * Migrates OAuth profile image to MediaAsset
   */
  private async migrateOAuthAvatar(): Promise<{
    migrated: boolean
    assetId?: string | null
    error?: string
  }> {
    // Skip if no image URL or already has avatarAssetId
    if (!this.user.image || this.user.avatarAssetId) {
      logger.debug('Skipping avatar migration', {
        userId: this.user.id,
        reason: !this.user.image ? 'no-image' : 'existing-avatar',
      })
      return { migrated: false, assetId: this.user.avatarAssetId }
    }
    try {
      const assetId = await UserAvatarService.downloadAndCreateAvatarAsset(
        this.user.id,
        this.user.image,
        this.organizationId
      )
      if (assetId) {
        logger.info('Successfully migrated user avatar', {
          userId: this.user.id,
          organizationId: this.organizationId,
          assetId,
        })
        return { migrated: true, assetId }
      } else {
        return {
          migrated: false,
          error: 'Avatar service returned null',
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error('Failed to migrate user avatar', {
        userId: this.user.id,
        organizationId: this.organizationId,
        error: errorMsg,
      })
      return {
        migrated: false,
        error: `Avatar migration failed: ${errorMsg}`,
      }
    }
  }
  /**
   * Setup default signature for the user via UnifiedCrudHandler.
   * Creates a default signature EntityInstance with the user's name.
   */
  private async setupDefaultSignature(): Promise<{
    created: boolean
    signatureId?: string | null
    error?: string
  }> {
    try {
      const { UnifiedCrudHandler } = await import('../resources/crud')
      const handler = new UnifiedCrudHandler(this.organizationId, this.user.id, this.db)

      const displayName = this.user.name || this.user.email || 'User'
      const result = await handler.create('signature', {
        signature_name: `${displayName} - Default`,
        signature_body: `<p>Best regards,<br>${displayName}</p>`,
        signature_is_default: true,
        signature_visibility: 'private',
      })

      logger.info('Created default signature', {
        userId: this.user.id,
        organizationId: this.organizationId,
        signatureId: result.id,
      })

      return { created: true, signatureId: result.id }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error('Failed to create default signature', {
        userId: this.user.id,
        organizationId: this.organizationId,
        error: errorMsg,
      })
      return { created: false, signatureId: null, error: `Signature creation failed: ${errorMsg}` }
    }
  }
  // Future methods can be added here:
  /**
   * Setup default notification settings (placeholder for future implementation)
   */
  private async setupDefaultNotifications(): Promise<void> {
    // TODO: Implement when notification system is ready
  }
  /**
   * Trigger welcome flow for new users (placeholder for future implementation)
   */
  private async triggerWelcomeFlow(): Promise<void> {
    // TODO: Implement when welcome flow system is ready
  }
}
