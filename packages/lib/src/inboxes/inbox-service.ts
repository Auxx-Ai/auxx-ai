// packages/lib/src/inboxes/inbox-service.ts

import { type Database, database as defaultDb, schema } from '@auxx/database'
import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import {
  checkAccess,
  getUserAccessibleInstances,
  setInstanceAccess,
} from '../resource-access/resource-access-service'
import type { ResourceAccessContext } from '../resource-access/types'
import { UnifiedCrudHandler } from '../resources/crud'
import type {
  CreateInboxInput,
  Inbox,
  InboxAccessInput,
  InboxVisibility,
  InboxWithIntegrations,
  UpdateInboxInput,
} from './types'

const logger = createScopedLogger('inbox-service')

/**
 * Helper to extract instance ID from RecordId
 */
function getInstanceId(recordId: RecordId): string {
  return parseRecordId(recordId).entityInstanceId
}

/**
 * Service for managing inboxes.
 * Uses RecordId branded types throughout for type safety.
 * Delegates core CRUD to UnifiedCrudHandler, uses ResourceAccess helpers for permissions.
 */
export class InboxService {
  private crudHandler: UnifiedCrudHandler
  private db: Database
  private ctx: ResourceAccessContext

  constructor(
    db: Database,
    private organizationId: string,
    private userId?: string
  ) {
    this.db = db ?? defaultDb
    this.crudHandler = new UnifiedCrudHandler(organizationId, userId ?? '', this.db)
    this.ctx = { db: this.db, organizationId, userId: userId ?? '' }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CRUD OPERATIONS (delegated to UnifiedCrudHandler)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new inbox (returns Inbox which includes recordId)
   */
  async createInbox(input: CreateInboxInput): Promise<Inbox> {
    logger.info('Creating new inbox', { organizationId: this.organizationId, name: input.name })

    const values: Record<string, unknown> = {
      inbox_name: input.name,
      inbox_description: input.description ?? null,
      inbox_color: input.color ?? 'indigo',
      inbox_status: input.status ?? 'ACTIVE',
      inbox_visibility: input.visibility ?? 'org_members',
      inbox_settings: input.settings ?? {},
    }

    const result = await this.crudHandler.create('inbox', values)
    const recordId = toRecordId('inbox', result.instance.id)

    // Set default permissions: org_members visibility + creator as admin
    await this.setVisibilityAccess(recordId, input.visibility ?? 'org_members')
    if (this.userId) {
      await setInstanceAccess(this.ctx, recordId, ResourceGranteeType.user, [
        { granteeId: this.userId, permission: ResourcePermission.admin },
      ])
    }

    return this.resolveInbox(recordId)
  }

  /**
   * Get a single inbox by RecordId
   */
  async getInbox(recordId: RecordId): Promise<Inbox | null> {
    const instance = await this.crudHandler.getById(recordId)
    return instance ? this.resolveInbox(recordId) : null
  }

  /**
   * Get a single inbox by raw ID (convenience method)
   */
  async getInboxById(inboxId: string): Promise<Inbox | null> {
    return this.getInbox(toRecordId('inbox', inboxId))
  }

  /**
   * Update an inbox by RecordId
   */
  async updateInbox(recordId: RecordId, input: UpdateInboxInput): Promise<Inbox> {
    logger.info('Updating inbox', { recordId, input })

    const values: Record<string, unknown> = {}

    if (input.name !== undefined) values.inbox_name = input.name
    if (input.description !== undefined) values.inbox_description = input.description
    if (input.color !== undefined) values.inbox_color = input.color
    if (input.status !== undefined) values.inbox_status = input.status
    if (input.settings !== undefined) values.inbox_settings = input.settings
    if (input.visibility !== undefined) {
      values.inbox_visibility = input.visibility
      await this.setVisibilityAccess(recordId, input.visibility)
    }

    if (Object.keys(values).length > 0) {
      await this.crudHandler.update(recordId, values)
    }

    return this.resolveInbox(recordId)
  }

  /**
   * Update an inbox by raw ID (convenience method)
   */
  async updateInboxById(inboxId: string, input: UpdateInboxInput): Promise<Inbox> {
    return this.updateInbox(toRecordId('inbox', inboxId), input)
  }

  /**
   * Delete an inbox by RecordId
   */
  async deleteInbox(recordId: RecordId): Promise<void> {
    const instanceId = getInstanceId(recordId)
    logger.info('Deleting inbox', { recordId, instanceId })

    // Delete related records first
    await this.db.transaction(async (tx) => {
      // Delete inbox integrations
      await tx
        .delete(schema.InboxIntegration)
        .where(eq(schema.InboxIntegration.inboxId, instanceId))

      // Delete resource access records
      await tx
        .delete(schema.ResourceAccess)
        .where(
          and(
            eq(schema.ResourceAccess.organizationId, this.organizationId),
            eq(schema.ResourceAccess.entityInstanceId, instanceId)
          )
        )
    })

    // Delete the entity instance
    await this.crudHandler.delete(recordId)
  }

  /**
   * Delete an inbox by raw ID (convenience method)
   */
  async deleteInboxById(inboxId: string): Promise<void> {
    return this.deleteInbox(toRecordId('inbox', inboxId))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // QUERY OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get all inboxes for the organization
   */
  async getInboxes(): Promise<Inbox[]> {
    const { items } = await this.crudHandler.list('inbox')
    return Promise.all(items.map((i) => this.resolveInbox(toRecordId('inbox', i.id))))
  }

  /**
   * Get all inboxes accessible to a user
   */
  async getInboxesForUser(userId: string): Promise<Inbox[]> {
    const result = await getUserAccessibleInstances(this.ctx, userId, 'inbox')

    // If user has type-level access, return all inboxes
    if (result.hasTypeAccess) {
      return this.getInboxes()
    }

    return Promise.all(result.instances.map((i) => this.resolveInbox(i.recordId)))
  }

  /**
   * Check if user has access to an inbox
   */
  async hasUserAccess(recordId: RecordId, userId: string): Promise<boolean> {
    const result = await checkAccess(this.ctx, { recordId, userId })
    return result.hasAccess
  }

  /**
   * Check if user has access to an inbox by raw ID (convenience method)
   */
  async hasUserAccessById(inboxId: string, userId: string): Promise<boolean> {
    return this.hasUserAccess(toRecordId('inbox', inboxId), userId)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCESS CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Update inbox access (groups, members, visibility)
   */
  async updateInboxAccess(recordId: RecordId, accessData: InboxAccessInput): Promise<Inbox> {
    if (accessData.visibility !== undefined) {
      await this.crudHandler.setFieldValue(recordId, 'inbox_visibility', accessData.visibility)
      await this.setVisibilityAccess(recordId, accessData.visibility)
    }
    if (accessData.memberIds !== undefined) {
      await setInstanceAccess(
        this.ctx,
        recordId,
        ResourceGranteeType.user,
        accessData.memberIds.map((id) => ({ granteeId: id, permission: ResourcePermission.view }))
      )
    }
    if (accessData.groupIds !== undefined) {
      await setInstanceAccess(
        this.ctx,
        recordId,
        ResourceGranteeType.group,
        accessData.groupIds.map((id) => ({ granteeId: id, permission: ResourcePermission.view }))
      )
    }

    return this.resolveInbox(recordId)
  }

  /**
   * Set role-based access based on visibility setting
   */
  private async setVisibilityAccess(
    recordId: RecordId,
    visibility: InboxVisibility
  ): Promise<void> {
    const grants =
      visibility === 'org_members'
        ? [{ granteeId: 'org_member', permission: ResourcePermission.view }]
        : []
    await setInstanceAccess(this.ctx, recordId, ResourceGranteeType.role, grants)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTEGRATION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add an integration to an inbox
   */
  async addIntegration(
    recordId: RecordId,
    integrationId: string,
    isDefault: boolean = false,
    settings?: Record<string, unknown>
  ) {
    const instanceId = getInstanceId(recordId)
    logger.info('Adding integration to inbox', { instanceId, integrationId, isDefault })

    return this.db.transaction(async (tx) => {
      // Check if integration already assigned somewhere
      const existing = await tx.query.InboxIntegration.findFirst({
        where: eq(schema.InboxIntegration.integrationId, integrationId),
      })

      // Verify integration belongs to this organization
      const integration = await tx.query.Integration.findFirst({
        where: and(
          eq(schema.Integration.id, integrationId),
          eq(schema.Integration.organizationId, this.organizationId)
        ),
      })

      if (!integration) {
        throw new Error(`Integration ${integrationId} not found`)
      }

      // If this is the default integration, unset other defaults
      if (isDefault) {
        await tx
          .update(schema.InboxIntegration)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(schema.InboxIntegration.inboxId, instanceId),
              eq(schema.InboxIntegration.isDefault, true)
            )
          )
      }

      if (existing) {
        // Update existing assignment
        const [updated] = await tx
          .update(schema.InboxIntegration)
          .set({ isDefault, inboxId: instanceId, settings: settings ?? {}, updatedAt: new Date() })
          .where(eq(schema.InboxIntegration.id, existing.id))
          .returning()
        return updated
      }

      // Create new assignment
      const [created] = await tx
        .insert(schema.InboxIntegration)
        .values({
          inboxId: instanceId,
          integrationId,
          isDefault,
          settings: settings ?? {},
          updatedAt: new Date(),
        })
        .returning()

      return created
    })
  }

  /**
   * Add an integration to an inbox by raw ID (convenience method)
   */
  async addIntegrationById(
    inboxId: string,
    integrationId: string,
    isDefault: boolean = false,
    settings?: Record<string, unknown>
  ) {
    return this.addIntegration(toRecordId('inbox', inboxId), integrationId, isDefault, settings)
  }

  /**
   * Remove an integration from an inbox
   */
  async removeIntegration(recordId: RecordId, integrationId: string): Promise<boolean> {
    const instanceId = getInstanceId(recordId)
    logger.info('Removing integration from inbox', { instanceId, integrationId })

    await this.db
      .delete(schema.InboxIntegration)
      .where(
        and(
          eq(schema.InboxIntegration.inboxId, instanceId),
          eq(schema.InboxIntegration.integrationId, integrationId)
        )
      )
    return true
  }

  /**
   * Add integration to default inbox (creates inbox if needed)
   */
  async addIntegrationToDefaultInbox(integrationId: string) {
    // Find existing default inbox by name
    const existingInboxes = await this.getInboxes()
    let defaultInbox = existingInboxes.find((i) => i.name === 'Default Inbox')

    if (!defaultInbox) {
      defaultInbox = await this.createInbox({
        name: 'Default Inbox',
        description: 'Default inbox for all incoming emails',
        color: 'blue',
        status: 'ACTIVE',
      })
    }

    return this.addIntegration(defaultInbox.recordId, integrationId, true)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve EntityInstance + FieldValues to Inbox type
   */
  private async resolveInbox(recordId: RecordId): Promise<Inbox> {
    const instanceId = getInstanceId(recordId)
    const values = await this.crudHandler.getFieldValues(recordId)

    const instance = await this.db.query.EntityInstance.findFirst({
      where: eq(schema.EntityInstance.id, instanceId),
    })

    if (!instance) {
      throw new Error(`Inbox not found: ${recordId}`)
    }

    // Helper to get text value from field values map
    const getValue = (fieldId: string): unknown => {
      const entry = values.get(fieldId)
      return entry?.value ?? null
    }

    return {
      id: instance.id,
      recordId,
      name: instance.displayName ?? '',
      description: (getValue('inbox_description') as string) ?? null,
      color: (getValue('inbox_color') as string) ?? 'indigo',
      status: ((getValue('inbox_status') as string) ?? 'ACTIVE') as Inbox['status'],
      visibility: ((getValue('inbox_visibility') as string) ??
        'org_members') as Inbox['visibility'],
      settings: (getValue('inbox_settings') as Record<string, unknown>) ?? {},
      organizationId: instance.organizationId,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
      createdById: instance.createdById,
    }
  }

  /**
   * Get inbox with integrations
   */
  async getInboxWithIntegrations(recordId: RecordId): Promise<InboxWithIntegrations | null> {
    const inbox = await this.getInbox(recordId)
    if (!inbox) return null

    const instanceId = getInstanceId(recordId)
    const integrations = await this.db.query.InboxIntegration.findMany({
      where: eq(schema.InboxIntegration.inboxId, instanceId),
      with: {
        integration: {
          columns: { id: true, name: true, email: true, provider: true },
        },
      },
    })

    return {
      ...inbox,
      integrations: integrations.map((i) => ({
        id: i.id,
        integrationId: i.integrationId,
        isDefault: i.isDefault,
        settings: i.settings as Record<string, unknown>,
        integration: i.integration,
      })),
    }
  }

  /**
   * Get inbox with integrations by raw ID (convenience method)
   */
  async getInboxWithIntegrationsById(inboxId: string): Promise<InboxWithIntegrations | null> {
    return this.getInboxWithIntegrations(toRecordId('inbox', inboxId))
  }
}
