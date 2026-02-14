// packages/lib/src/permissions/permission-service.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { OrganizationRole, SignatureSharingType } from '@auxx/database/enums'
import { TRPCError } from '@trpc/server'
import { and, eq, inArray, placeholder } from 'drizzle-orm'
import { createScopedLogger } from '../logger'
import { SystemUserService } from '../users/system-user-service'

const logger = createScopedLogger('permission-service')

type PermissionType = 'aiModel' | 'group'

// Prepared statements for hot paths - created once and reused across instances
const createPreparedStatements = (db: Database) => ({
  isAdminStatement: db.query.OrganizationMember.findFirst({
    where: and(
      eq(schema.OrganizationMember.userId, placeholder('userId')),
      eq(schema.OrganizationMember.organizationId, placeholder('organizationId')),
      inArray(schema.OrganizationMember.role, [OrganizationRole.OWNER, OrganizationRole.ADMIN])
    ),
    columns: {
      id: true,
    },
  }).prepare('isAdminStatement'),

  checkOrganizationMembershipStatement: db.query.OrganizationMember.findFirst({
    where: and(
      eq(schema.OrganizationMember.userId, placeholder('userId')),
      eq(schema.OrganizationMember.organizationId, placeholder('organizationId'))
    ),
    columns: {
      id: true,
    },
  }).prepare('checkOrganizationMembershipStatement'),

  getTicketStatement: db.query.Ticket.findFirst({
    where: eq(schema.Ticket.id, placeholder('ticketId')),
    columns: {
      organizationId: true,
    },
  }).prepare('getTicketStatement'),

  getThreadStatement: db.query.Thread.findFirst({
    where: eq(schema.Thread.id, placeholder('threadId')),
    columns: {
      integrationId: true,
      integrationType: true,
    },
  }).prepare('getThreadStatement'),

  getIntegrationByIdStatement: db.query.Integration.findFirst({
    where: and(
      eq(schema.Integration.id, placeholder('integrationId')),
      eq(schema.Integration.organizationId, placeholder('organizationId'))
    ),
    columns: {
      id: true,
    },
  }).prepare('getIntegrationByIdStatement'),

  getContactStatement: db.query.Contact.findFirst({
    where: eq(schema.Contact.id, placeholder('contactId')),
    columns: {
      organizationId: true,
    },
  }).prepare('getContactStatement'),

  getCommentStatement: db.query.Comment.findFirst({
    where: eq(schema.Comment.id, placeholder('commentId')),
    columns: {
      createdById: true,
      organizationId: true,
    },
  }).prepare('getCommentStatement'),

  getSignatureStatement: db.query.Signature.findFirst({
    where: eq(schema.Signature.id, placeholder('signatureId')),
  }).prepare('getSignatureStatement'),

  getMediaAssetStatement: db.query.MediaAsset.findFirst({
    where: eq(schema.MediaAsset.id, placeholder('fileId')),
    columns: {
      organizationId: true,
    },
  }).prepare('getMediaAssetStatement'),

  getCommentByIdStatement: db.query.Comment.findFirst({
    where: eq(schema.Comment.id, placeholder('commentId')),
    columns: {
      createdById: true,
      organizationId: true,
    },
  }).prepare('getCommentByIdStatement'),

  getCommentOrgOnlyStatement: db.query.Comment.findFirst({
    where: eq(schema.Comment.id, placeholder('commentId')),
    columns: {
      organizationId: true,
    },
  }).prepare('getCommentOrgOnlyStatement'),

  getOrganizationMemberByRoleStatement: db.query.OrganizationMember.findFirst({
    where: and(
      eq(schema.OrganizationMember.userId, placeholder('userId')),
      eq(schema.OrganizationMember.organizationId, placeholder('organizationId')),
      inArray(schema.OrganizationMember.role, [OrganizationRole.OWNER, OrganizationRole.ADMIN])
    ),
    columns: {
      id: true,
    },
  }).prepare('getOrganizationMemberByRoleStatement'),

  getSignatureByIdStatement: db.query.Signature.findFirst({
    where: eq(schema.Signature.id, placeholder('signatureId')),
  }).prepare('getSignatureByIdStatement'),

  getSignatureBasicStatement: db.query.Signature.findFirst({
    where: eq(schema.Signature.id, placeholder('signatureId')),
    columns: {
      id: true,
      createdById: true,
      organizationId: true,
      sharingType: true,
    },
  }).prepare('getSignatureBasicStatement'),

  getIntegrationBasicStatement: db.query.Integration.findFirst({
    where: eq(schema.Integration.id, placeholder('integrationId')),
    columns: {
      id: true,
      organizationId: true,
    },
  }).prepare('getIntegrationBasicStatement'),

  getEntityInstanceStatement: db.query.EntityInstance.findFirst({
    where: eq(schema.EntityInstance.id, placeholder('instanceId')),
    columns: {
      organizationId: true,
      entityDefinitionId: true,
    },
  }).prepare('getEntityInstanceStatement'),

  getEntityDefinitionStatement: db.query.EntityDefinition.findFirst({
    where: eq(schema.EntityDefinition.id, placeholder('definitionId')),
    columns: {
      organizationId: true,
    },
  }).prepare('getEntityDefinitionStatement'),
})

// Cache prepared statements per database instance
const preparedStatementsCache = new WeakMap<Database, ReturnType<typeof createPreparedStatements>>()

export class PermissionService {
  private organizationId: string
  private userId: string
  private db: Database
  private statements: ReturnType<typeof createPreparedStatements>

  constructor(organizationId: string, userId: string, db: Database) {
    this.organizationId = organizationId
    this.userId = userId
    this.db = db

    // Get or create prepared statements for this database instance
    if (!preparedStatementsCache.has(db)) {
      preparedStatementsCache.set(db, createPreparedStatements(db))
    }
    this.statements = preparedStatementsCache.get(db)!
  }

  /**
   * Check if the current user is a system user
   * System users have elevated permissions for AI-generated actions
   */
  private async isSystemUser(): Promise<boolean> {
    return await SystemUserService.isSystemUser(this.userId)
  }
  // todo: implement this
  async checkPermission(permission: PermissionType): Promise<boolean> {
    // Check if user is a member of the organization
    return await this.isAdmin()
  }

  async isAdmin(): Promise<boolean> {
    const membership = await this.statements.isAdminStatement.execute({
      userId: this.userId,
      organizationId: this.organizationId,
    })
    return !!membership
  }
  /**
   * Check if user can access an entity (ticket, thread, contact, etc.)
   */
  async canAccessEntity(entityId: string, entityType: string): Promise<boolean> {
    try {
      // System users have access to all entities in their organization
      if (await this.isSystemUser()) {
        return true
      }

      switch (entityType) {
        case 'Ticket':
          return await this.canAccessTicket(entityId)
        case 'Thread':
          return await this.canAccessThread(entityId)
        case 'Contact':
          return await this.canAccessContact(entityId)
        default:
          logger.error('Unknown entity type', { entityType, entityId })
          return false
      }
    } catch (error) {
      logger.error('Error checking entity access', { error, entityId, entityType })
      return false
    }
  }

  /**
   * Check if user can access a ticket
   */
  private async canAccessTicket(ticketId: string): Promise<boolean> {
    // Check if user is a member of the organization that owns the ticket
    const ticket = await this.statements.getTicketStatement.execute({
      ticketId,
    })

    if (!ticket) return false

    // Check if the ticket belongs to the user's current organization
    if (ticket.organizationId !== this.organizationId) {
      // Also check if user has access to other organizations
      const hasMembership = await this.statements.checkOrganizationMembershipStatement.execute({
        userId: this.userId,
        organizationId: ticket.organizationId,
      })

      return !!hasMembership
    }

    return true
  }

  /**
   * Check if user can access a thread
   */
  private async canAccessThread(threadId: string): Promise<boolean> {
    // Find the thread
    const thread = await this.statements.getThreadStatement.execute({
      threadId,
    })
    if (!thread) return false

    // Check if user has access to the integration
    const integration = await this.statements.getIntegrationByIdStatement.execute({
      integrationId: thread.integrationId,
      organizationId: this.organizationId,
    })
    logger.debug('Thread found', { integration, organizationId: this.organizationId })

    return !!integration
  }

  /**
   * Check if user can access a contact
   */
  private async canAccessContact(contactId: string): Promise<boolean> {
    // Check if contact belongs to the user's organization
    const contact = await this.statements.getContactStatement.execute({
      contactId,
    })

    if (!contact) return false

    // Check if the contact belongs to the user's current organization
    if (contact.organizationId !== this.organizationId) {
      // Also check if user has access to other organizations
      const hasMembership = await this.statements.checkOrganizationMembershipStatement.execute({
        userId: this.userId,
        organizationId: contact.organizationId,
      })

      return !!hasMembership
    }

    return true
  }

  /**
   * Check if user can modify a comment
   */
  async canModifyComment(commentId: string): Promise<boolean> {
    // System users can modify any comment in their organization
    if (await this.isSystemUser()) {
      const comment = await this.statements.getCommentOrgOnlyStatement.execute({
        commentId,
      })
      return comment?.organizationId === this.organizationId
    }

    const comment = await this.statements.getCommentByIdStatement.execute({
      commentId,
    })

    if (!comment) return false

    // Check if user is the comment creator or has admin privileges
    if (comment.createdById === this.userId) return true

    // Check if user is an admin in the organization
    if (comment.organizationId === this.organizationId) {
      const membership = await this.statements.getOrganizationMemberByRoleStatement.execute({
        userId: this.userId,
        organizationId: this.organizationId,
      })

      return !!membership
    }

    return false
  }

  /**
   * Check if user can pin/unpin comments
   */
  async canPinComments(organizationId: string): Promise<boolean> {
    // System users can pin comments in their organization
    if (await this.isSystemUser()) {
      return organizationId === this.organizationId
    }

    // Check if user is an admin in the organization
    const membership = await this.statements.getOrganizationMemberByRoleStatement.execute({
      userId: this.userId,
      organizationId: organizationId,
    })

    return !!membership
  }

  /**
   * Check if file belongs to the right organization
   */
  async canAccessFile(fileId: string): Promise<boolean> {
    // System users can access any file in their organization, but verify org
    const asset = await this.statements.getMediaAssetStatement.execute({
      fileId,
    })

    if (!asset) return false

    if (await this.isSystemUser()) {
      return asset.organizationId === this.organizationId
    }

    return asset.organizationId === this.organizationId
  }

  /**
   * Verify access permission or throw error
   */
  async verifyAccess(condition: Promise<boolean>, errorMessage: string): Promise<void> {
    const hasAccess = await condition

    if (!hasAccess) {
      throw new TRPCError({ code: 'FORBIDDEN', message: errorMessage })
    }
  }

  /**
   * Check if user can access an EntityInstance (custom entity record)
   * @param instanceId - The EntityInstance ID
   * @param entityDefinitionId - The EntityDefinition ID (stored in entityType field)
   */
  async canAccessEntityInstance(instanceId: string, entityDefinitionId: string): Promise<boolean> {
    try {
      // System users have access to all instances in their organization
      if (await this.isSystemUser()) {
        return true
      }

      // Get the instance
      const instance = await this.statements.getEntityInstanceStatement.execute({
        instanceId,
      })

      if (!instance) return false

      // Verify entityDefinitionId matches
      if (instance.entityDefinitionId !== entityDefinitionId) {
        logger.warn('EntityInstance definition mismatch', {
          instanceId,
          expected: entityDefinitionId,
          actual: instance.entityDefinitionId,
        })
        return false
      }

      // Verify organization match
      if (instance.organizationId !== this.organizationId) {
        // Check if user has membership in that organization
        const hasMembership = await this.statements.checkOrganizationMembershipStatement.execute({
          userId: this.userId,
          organizationId: instance.organizationId,
        })
        return !!hasMembership
      }

      return true
    } catch (error) {
      logger.error('Error checking entity instance access', { error, instanceId })
      return false
    }
  }

  /**
   * Check if user can access an EntityDefinition
   */
  async canAccessEntityDefinition(definitionId: string): Promise<boolean> {
    try {
      if (await this.isSystemUser()) {
        return true
      }

      const definition = await this.statements.getEntityDefinitionStatement.execute({
        definitionId,
      })

      if (!definition) return false

      return definition.organizationId === this.organizationId
    } catch (error) {
      logger.error('Error checking entity definition access', { error, definitionId })
      return false
    }
  }
  async canViewSignature(signatureId: string): Promise<boolean> {
    const signature = await this.statements.getSignatureByIdStatement.execute({
      signatureId,
    })

    if (!signature) return false

    // Creator can always view
    if (signature.createdById === this.userId) return true

    // Check if user is in the organization
    const membership = await this.statements.checkOrganizationMembershipStatement.execute({
      userId: this.userId,
      organizationId: signature.organizationId,
    })

    if (!membership) return false

    // If organization-wide or specific integrations, any organization member can view
    return [
      SignatureSharingType.ORGANIZATION_WIDE,
      SignatureSharingType.SPECIFIC_INTEGRATIONS,
    ].includes(signature.sharingType)
  }

  /**
   * Check if a user can edit a signature
   */
  async canEditSignature(signatureId: string): Promise<boolean> {
    const signature = await this.statements.getSignatureBasicStatement.execute({
      signatureId,
    })

    if (!signature) return false

    // Creator can always edit
    if (signature.createdById === this.userId) return true

    // Admins can edit organization-wide signatures
    if (signature.sharingType === SignatureSharingType.ORGANIZATION_WIDE) {
      return await this.isAdmin()
    }

    // Only creator can edit other signatures
    return false
  }

  /**
   * Check if a user can delete a signature
   */
  async canDeleteSignature(signatureId: string): Promise<boolean> {
    // Same logic as edit - only creator or admin (for org-wide) can delete
    return this.canEditSignature(signatureId)
  }

  /**
   * Check if a user can create an organization-wide signature
   */
  async canCreateOrgWideSignature(): Promise<boolean> {
    // Only organization admins can create org-wide signatures
    return await this.isAdmin()
  }

  /**
   * Check if an integration can use a signature
   */
  async canIntegrationUseSignature(integrationId: string, signatureId: string): Promise<boolean> {
    const signature = await this.statements.getSignatureByIdStatement.execute({
      signatureId,
    })

    if (!signature) return false

    // Check if organization-wide (all integrations can use)
    if (signature.sharingType === SignatureSharingType.ORGANIZATION_WIDE) {
      const integration = await this.statements.getIntegrationBasicStatement.execute({
        integrationId,
      })
      return integration?.organizationId === signature.organizationId
    }

    // Check if shared with this specific integration
    if (signature.sharingType === SignatureSharingType.SPECIFIC_INTEGRATIONS) {
      // Query signature integration shares separately since we can't use relations
      const shares = await this.db.query.SignatureIntegrationShare.findMany({
        where: eq(schema.SignatureIntegrationShare.signatureId, signatureId),
      })
      return shares.some((share) => share.integrationId === integrationId)
    }

    // For private signatures, check if it belongs to the user who owns the integration
    const integration = await this.statements.getIntegrationBasicStatement.execute({
      integrationId,
    })

    // For now, we'll assume organization members can use private signatures with org integrations
    return integration?.organizationId === signature.organizationId
  }
}
