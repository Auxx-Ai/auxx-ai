// packages/lib/src/seed/entity-seeder/index.ts

import { type Database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { SystemUserService } from '../../users/system-user-service'
import { createEntityDefinitions } from './create-entity-defs'
import { createAllFields } from './create-fields'
import { linkRelationships } from './link-relationships'
import { linkNameFields } from './link-name-fields'
import { linkDisplayFields } from './link-display-fields'
import { createDefaultViews } from './create-default-views'

const logger = createScopedLogger('entity-seeder')

/**
 * EntitySeeder - Multi-Pass Implementation
 *
 * A simpler seeder that:
 * - Does NOT use createCustomField service (direct inserts)
 * - Does NOT require transactions
 * - Uses lookup maps for efficient linking between passes
 * - Handles `user` as a special entity type
 * - Applies proper default options per field type
 *
 * 6-Pass Architecture:
 * 1. Create EntityDefinitions
 * 2. Create ALL CustomFields (including relationships with inverseResourceFieldId=null)
 * 3. Link Relationship Fields (update inverseResourceFieldId)
 * 4. Link NAME Fields (update name.firstNameFieldId, name.lastNameFieldId)
 * 5. Link Display Fields to EntityDefinitions
 * 6. Create Default TableViews
 */
export class EntitySeeder {
  constructor(
    private db: Database,
    private organizationId: string
  ) {}

  /**
   * Seed all system entities for the organization
   */
  async seedSystemEntities(): Promise<void> {
    logger.info('Starting EntitySeeder', { organizationId: this.organizationId })

    // Check if already seeded (idempotency)
    const existing = await this.db.query.EntityDefinition.findFirst({
      where: eq(schema.EntityDefinition.organizationId, this.organizationId),
    })
    if (existing) {
      logger.info('Already seeded, skipping', { organizationId: this.organizationId })
      return
    }

    // Pass 1: Create EntityDefinitions
    logger.info('Pass 1: Creating EntityDefinitions')
    const entityDefMap = await createEntityDefinitions(this.db, this.organizationId)
    logger.info(`Pass 1 complete: ${entityDefMap.size} EntityDefinitions created`)

    // Pass 2: Create ALL CustomFields (including relationships with null inverseResourceFieldId)
    logger.info('Pass 2: Creating all CustomFields')
    const fieldMap = await createAllFields(this.db, this.organizationId, entityDefMap)
    logger.info(`Pass 2 complete: ${fieldMap.size} CustomFields created`)

    // Pass 3: Link relationship fields (update inverseResourceFieldId)
    logger.info('Pass 3: Linking relationship fields')
    await linkRelationships(this.db, entityDefMap, fieldMap)
    logger.info('Pass 3 complete: relationships linked')

    // Pass 4: Link NAME fields (update name.firstNameFieldId, name.lastNameFieldId)
    logger.info('Pass 4: Linking NAME fields')
    await linkNameFields(this.db, fieldMap)
    logger.info('Pass 4 complete: NAME fields linked')

    // Pass 5: Link display fields
    logger.info('Pass 5: Linking display fields')
    await linkDisplayFields(this.db, entityDefMap, fieldMap)
    logger.info('Pass 5 complete')

    // Pass 6: Create default views (uses system user)
    logger.info('Pass 6: Creating default views')
    const systemUserId = await SystemUserService.getSystemUserForActions(this.organizationId)
    await createDefaultViews(this.db, this.organizationId, systemUserId, entityDefMap, fieldMap)
    logger.info('Pass 6 complete')

    logger.info('EntitySeeder complete', { organizationId: this.organizationId })
  }
}

// Re-export types
export type { EntityDefMap, FieldMap, EntityDefRecord, FieldRecord } from './types'
