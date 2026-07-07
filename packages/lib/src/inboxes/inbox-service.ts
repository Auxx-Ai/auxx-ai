// packages/lib/src/inboxes/inbox-service.ts

import { type Database, database as defaultDb, schema } from '@auxx/database'
import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { getUserCache, onCacheEvent } from '../cache'
import type { Lens } from '../permissions/visibility/lens'
import { hasPermission, setInstanceAccess } from '../resource-access/resource-access-service'
import type { ResourceAccessContext } from '../resource-access/types'
import { listAll, UnifiedCrudHandler } from '../resources/crud'
import type { CreateInboxInput, Inbox, InboxWithIntegrations, UpdateInboxInput } from './types'

const logger = createScopedLogger('inbox-service')

/**
 * Helper to extract instance ID from RecordId
 */
function getInstanceId(recordId: RecordId): string {
  return parseRecordId(recordId).entityInstanceId
}

/**
 * Default-lens value for inboxes that predate the `inbox_default_lens` field
 * (data migration 033 backfills it with exactly this mapping). `org_members`
 * meant everyone-full; `private`/`custom` meant explicit grantees only.
 */
function legacyDefaultLens(visibility: unknown): Lens {
  return visibility === 'private' || visibility === 'custom' ? 'none' : 'full'
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
      // Legacy field, kept in sync until Phase 6 removes it. The floor is
      // defaultLens; there are no org_member ResourceAccess rows anymore.
      // Callers still passing only `visibility` get the equivalent floor.
      inbox_visibility: input.visibility ?? 'org_members',
      inbox_default_lens: input.defaultLens ?? legacyDefaultLens(input.visibility),
      inbox_settings: input.settings ?? {},
    }

    const result = await this.crudHandler.create('inbox', values)
    const recordId = toRecordId('inbox', result.instance.id)

    // Creator becomes the inbox Manager (admin grant — may manage access).
    if (this.userId) {
      await setInstanceAccess(this.ctx, recordId, ResourceGranteeType.user, [
        { granteeId: this.userId, permission: ResourcePermission.admin },
      ])
    }

    // Inbox floors affect every member's visibility context.
    await onCacheEvent('inbox.created', { orgId: this.organizationId, broadcastUserKeys: true })

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
    if (input.visibility !== undefined) values.inbox_visibility = input.visibility
    if (input.defaultLens !== undefined) values.inbox_default_lens = input.defaultLens

    if (Object.keys(values).length > 0) {
      await this.crudHandler.update(recordId, values)
      await onCacheEvent('inbox.updated', { orgId: this.organizationId, broadcastUserKeys: true })
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

    await onCacheEvent('inbox.deleted', { orgId: this.organizationId, broadcastUserKeys: true })
    await onCacheEvent('channel.inbox-link.changed', { orgId: this.organizationId })
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
    const result = await listAll(
      { db: this.db, organizationId: this.organizationId, userId: this.userId ?? '' },
      { entityDefinitionId: 'inbox' }
    )
    return result.items.map((item) => this.transformToInbox(item))
  }

  /**
   * Get all inboxes visible to a user (effective lens above `none`) — a filter
   * over the cached `userMailVisibility` context, no per-inbox ACL queries.
   */
  async getInboxesForUser(userId: string): Promise<Inbox[]> {
    const vis = await getUserCache().get(userId, 'userMailVisibility', this.organizationId)
    const inboxes = await this.getInboxes()
    if (vis.isAdmin) return inboxes
    return inboxes.filter((inbox) => (vis.inboxLens[inbox.id] ?? 'none') !== 'none')
  }

  /**
   * Check if user has access to an inbox (effective lens above `none`).
   * Cache read — replaces the former live ResourceAccess check.
   */
  async hasUserAccess(recordId: RecordId, userId: string): Promise<boolean> {
    const vis = await getUserCache().get(userId, 'userMailVisibility', this.organizationId)
    if (vis.isAdmin) return true
    return (vis.inboxLens[getInstanceId(recordId)] ?? 'none') !== 'none'
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCESS CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Whether a user may manage this inbox's access (floor edits, grants):
   * org admin or an inbox `admin` grant (Manager delegation, decision #3).
   */
  async canManageInboxAccess(recordId: RecordId, userId: string): Promise<boolean> {
    const vis = await getUserCache().get(userId, 'userMailVisibility', this.organizationId)
    if (vis.isAdmin) return true
    return hasPermission({ ...this.ctx, userId }, recordId, ResourcePermission.admin)
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

    const result = await this.db.transaction(async (tx) => {
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

    await onCacheEvent('channel.inbox-link.changed', { orgId: this.organizationId })
    return result
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

    await onCacheEvent('channel.inbox-link.changed', { orgId: this.organizationId })
    return true
  }

  /**
   * Get or create the canonical shared inbox for the organization.
   */
  async getOrCreateSharedInbox(): Promise<Inbox> {
    const existingInboxes = await this.getInboxes()
    let sharedInbox =
      existingInboxes.find((i) => i.name === 'Shared Inbox') ??
      existingInboxes.find((i) => i.name === 'Default Inbox')

    if (!sharedInbox) {
      sharedInbox = await this.createInbox({
        name: 'Shared Inbox',
        description: 'Default inbox for all incoming emails',
        color: 'blue',
        status: 'ACTIVE',
      })
      return sharedInbox
    }

    if (sharedInbox.name === 'Default Inbox') {
      sharedInbox = await this.updateInbox(sharedInbox.recordId, {
        name: 'Shared Inbox',
        description: 'Default shared inbox for all incoming emails',
      })
    }

    return sharedInbox
  }

  /**
   * Add an integration to the canonical shared inbox.
   */
  async addIntegrationToSharedInbox(
    integrationId: string,
    isDefault: boolean = true,
    settings?: Record<string, unknown>
  ) {
    const sharedInbox = await this.getOrCreateSharedInbox()
    return this.addIntegration(sharedInbox.recordId, integrationId, isDefault, settings)
  }

  /**
   * Add integration to the shared inbox.
   * Kept for backward compatibility with older call sites.
   */
  async addIntegrationToDefaultInbox(
    integrationId: string,
    isDefault: boolean = true,
    settings?: Record<string, unknown>
  ) {
    return this.addIntegrationToSharedInbox(integrationId, isDefault, settings)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Transform a listAll result item to Inbox type (no extra queries)
   */
  private transformToInbox(item: {
    id: string
    recordId: RecordId
    fieldValues: Record<string, unknown>
    displayName?: string | null
    organizationId: string
    createdAt: Date
    updatedAt: Date
    createdById: string | null
  }): Inbox {
    return {
      id: item.id,
      recordId: item.recordId,
      name: item.displayName ?? '',
      description: (item.fieldValues.inbox_description as string) ?? null,
      color: (item.fieldValues.inbox_color as string) ?? 'indigo',
      status: ((item.fieldValues.inbox_status as string) ?? 'ACTIVE') as Inbox['status'],
      visibility: ((item.fieldValues.inbox_visibility as string) ??
        'org_members') as Inbox['visibility'],
      defaultLens:
        (item.fieldValues.inbox_default_lens as string as Lens) ??
        legacyDefaultLens(item.fieldValues.inbox_visibility),
      settings: (item.fieldValues.inbox_settings as Record<string, unknown>) ?? {},
      organizationId: item.organizationId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      createdById: item.createdById,
    }
  }

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
      defaultLens:
        (getValue('inbox_default_lens') as string as Lens) ??
        legacyDefaultLens(getValue('inbox_visibility')),
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
