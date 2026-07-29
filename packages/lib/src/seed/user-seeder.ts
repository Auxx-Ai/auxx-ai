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
      // `signature_is_default` / `signature_visibility` were removed from
      // `SIGNATURE_FIELDS` by plan 36 — visibility is `ResourceAccess` rows now,
      // and "default" is a per-user `UserSetting`.
      const result = await handler.create('signature', {
        signature_name: `${displayName} - Default`,
        signature_body: `<p>Best regards,<br>${displayName}</p>`,
      })
      const signatureId = result.instance.id

      await this.grantSignatureOwnership(signatureId)

      logger.info('Created default signature', {
        userId: this.user.id,
        organizationId: this.organizationId,
        signatureId,
      })

      return { created: true, signatureId }
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
  /**
   * Write the owner `admin` `ResourceAccess` row for a freshly seeded signature.
   *
   * NOT optional bookkeeping. Plan 36 made `signature` an
   * `INSTANCE_ACCESS_RESOURCES` entry with `baselineAtCreate: true`, so an
   * instance with NO `ResourceAccess` row is reachable by nobody but the org
   * OWNER — this seeder would otherwise hand every newly provisioned member a
   * default signature they cannot see, edit or delete. Migration 056 backfilled
   * the rows that existed when the slice landed; every signature born after it
   * has to write its own.
   *
   * This is the exact row `api.signature.create` writes, including the
   * `emitResourceAccessInstanceChanged` invalidation — without that the user's
   * composed capabilities blob still predates the row and their own signature
   * stays invisible until the TTL expires.
   *
   * Deliberately no `role:org_member` row: private is the posture (plan 36
   * §0.2); sharing goes through `resourceAccess.grantInstance`.
   */
  private async grantSignatureOwnership(signatureId: string): Promise<void> {
    const { schema } = await import('@auxx/database')
    const { ResourceGranteeType, ResourcePermission } = await import('@auxx/database/enums')
    const { emitResourceAccessInstanceChanged } = await import('../resource-access')

    await this.db
      .insert(schema.ResourceAccess)
      .values({
        organizationId: this.organizationId,
        entityDefinitionId: 'signature',
        entityInstanceId: signatureId,
        granteeType: ResourceGranteeType.user,
        granteeId: this.user.id,
        permission: ResourcePermission.admin,
        grantedById: this.user.id,
      })
      .onConflictDoNothing()

    await emitResourceAccessInstanceChanged(this.organizationId, [
      { granteeType: ResourceGranteeType.user, granteeId: this.user.id },
    ])
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
