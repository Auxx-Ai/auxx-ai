// packages/lib/src/signatures/signature-service.ts
import { type Database, schema } from '@auxx/database'
import { SignatureSharingType } from '@auxx/database/enums'
import type { SignatureEntity as Signature } from '@auxx/database/models'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, ne, or } from 'drizzle-orm'
import { PermissionService } from '../permissions/permission-service'

const logger = createScopedLogger('signature-service') // Add logger instance

export class SignatureService {
  private db: Database
  private organizationId: string
  private userId: string
  private permissionService: PermissionService

  constructor(db: Database, organizationId: string, userId: string) {
    this.db = db
    this.organizationId = organizationId
    this.userId = userId
    this.permissionService = new PermissionService(organizationId, userId, db)
  }

  /**
   * Get all signatures accessible to the current user
   */
  async getAllSignatures(): Promise<Signature[]> {
    // Get user's organization membership to check role
    const membership = await this.db.query.OrganizationMember.findFirst({
      where: (members, { eq, and }) =>
        and(eq(members.userId, this.userId), eq(members.organizationId, this.organizationId)),
    })

    return await this.db.query.Signature.findMany({
      where: (signatures, { eq, or, and }) =>
        and(
          eq(signatures.organizationId, this.organizationId),
          or(
            eq(signatures.createdById, this.userId), // Created by user
            eq(signatures.sharingType, SignatureSharingType.ORGANIZATION_WIDE), // Org-wide signatures
            eq(signatures.sharingType, SignatureSharingType.SPECIFIC_INTEGRATIONS) // Specific integrations (all org members can see)
          )
        ),
      with: { sharedIntegrations: true },
      orderBy: (signatures, { desc }) => [desc(signatures.updatedAt)],
    })
  }

  /**
   * Get signatures for a specific integration
   */
  async getSignaturesForIntegration(integrationId: string): Promise<Signature[]> {
    const integration = await this.db.query.Integration.findFirst({
      where: (integrations, { eq }) => eq(integrations.id, integrationId),
    })

    if (!integration || integration.organizationId !== this.organizationId) {
      throw new Error('Integration not found or not accessible')
    }

    // First get signatures that are organization-wide
    const orgWideSignatures = await this.db.query.Signature.findMany({
      where: (signatures, { eq, and }) =>
        and(
          eq(signatures.organizationId, this.organizationId),
          eq(signatures.sharingType, SignatureSharingType.ORGANIZATION_WIDE)
        ),
      orderBy: (signatures, { desc }) => [desc(signatures.updatedAt)],
    })

    // Then get signatures that are specifically shared with this integration
    const specificSignatures = await this.db.query.Signature.findMany({
      where: (signatures, { eq, and }) =>
        and(
          eq(signatures.organizationId, this.organizationId),
          eq(signatures.sharingType, SignatureSharingType.SPECIFIC_INTEGRATIONS)
        ),
      with: {
        sharedIntegrations: {
          where: (shares, { eq }) => eq(shares.integrationId, integrationId),
        },
      },
      orderBy: (signatures, { desc }) => [desc(signatures.updatedAt)],
    })

    // Filter specific signatures to only those that have the integration share
    const filteredSpecificSignatures = specificSignatures.filter(
      (sig) => sig.sharedIntegrations && sig.sharedIntegrations.length > 0
    )

    // Combine and dedupe results
    const allSignatures = [...orgWideSignatures, ...filteredSpecificSignatures]
    const uniqueSignatures = allSignatures.filter(
      (sig, index, self) => index === self.findIndex((s) => s.id === sig.id)
    )

    // Sort by updatedAt desc
    return uniqueSignatures.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  }

  /**
   * Get the default signature for the current user's context.
   * Priority: User's general default > Organization-wide default.
   * @param inboxId - Currently unused, placeholder for potential future inbox-specific defaults.
   */
  async getDefaultSignatureForContext(
    inboxId?: string // Made optional as it's unused for now
  ): Promise<Signature | null> {
    logger.info('Fetching default signature for context', {
      userId: this.userId,
      organizationId: this.organizationId,
      inboxId: inboxId ?? 'N/A',
    })

    // 1. Try User's General Default (Private or Org-Wide if they created it)
    const userDefault = await this.db.query.Signature.findFirst({
      where: (signatures, { eq, and }) =>
        and(
          eq(signatures.createdById, this.userId),
          eq(signatures.organizationId, this.organizationId),
          eq(signatures.isDefault, true)
          // User's default can be private or org-wide if they are admin
          // No need to filter sharingType here, just check creator and isDefault
        ),
      orderBy: (signatures, { desc }) => [desc(signatures.updatedAt)], // In case somehow multiple exist, take the latest
    })

    if (userDefault) {
      logger.debug('Found user default signature', { signatureId: userDefault.id })
      return userDefault
    }

    // 2. Try Organization-Wide Default (created by anyone)
    const orgWideDefault = await this.db.query.Signature.findFirst({
      where: (signatures, { eq, and, ne }) =>
        and(
          eq(signatures.organizationId, this.organizationId),
          eq(signatures.isDefault, true),
          eq(signatures.sharingType, SignatureSharingType.ORGANIZATION_WIDE),
          // Ensure we don't return the user's default again if it was org-wide
          ne(signatures.createdById, this.userId)
        ),
      orderBy: (signatures, { desc }) => [desc(signatures.updatedAt)], // Take the latest org-wide default if multiple exist
    })

    if (orgWideDefault) {
      logger.debug('Found organization-wide default signature', { signatureId: orgWideDefault.id })
      return orgWideDefault
    }

    logger.info('No default signature found for context')
    return null
  }

  /**
   * Get the legacy default signature for the current user (kept for compatibility if needed)
   * Original logic before getDefaultSignatureForContext
   */
  async getDefaultSignature(): Promise<Signature | null> {
    logger.warn('Using legacy getDefaultSignature. Consider using getDefaultSignatureForContext.')

    // First try to get user's own default
    const userSignature = await this.db.query.Signature.findFirst({
      where: (signatures, { eq, and }) =>
        and(
          eq(signatures.organizationId, this.organizationId),
          eq(signatures.isDefault, true),
          eq(signatures.createdById, this.userId)
        ),
      orderBy: (signatures, { desc }) => [desc(signatures.updatedAt)],
    })

    if (userSignature) {
      return userSignature
    }

    // Then try org-wide or specific integrations defaults
    const otherSignatures = await this.db.query.Signature.findMany({
      where: (signatures, { eq, and, or, ne }) =>
        and(
          eq(signatures.organizationId, this.organizationId),
          eq(signatures.isDefault, true),
          ne(signatures.createdById, this.userId),
          or(
            eq(signatures.sharingType, SignatureSharingType.ORGANIZATION_WIDE),
            eq(signatures.sharingType, SignatureSharingType.SPECIFIC_INTEGRATIONS)
          )
        ),
      orderBy: (signatures, { desc }) => [desc(signatures.updatedAt)],
      limit: 1,
    })

    return otherSignatures.length > 0 ? otherSignatures[0] : null
  }

  /**
   * Get a signature by ID
   */
  async getSignatureById(id: string): Promise<Signature | null> {
    const signature = await this.db.query.Signature.findFirst({
      where: (signatures, { eq }) => eq(signatures.id, id),
      with: {
        sharedIntegrations: {
          with: { integration: true },
        },
      },
    })

    if (!signature) return null

    // Check if user has access
    const canView = await this.permissionService.canViewSignature(id)
    if (!canView) return null

    return signature
  }

  /**
   * Create a new signature
   */
  async createSignature(data: {
    name: string
    body: string
    isDefault?: boolean
    sharingType: (typeof SignatureSharingType)[keyof typeof SignatureSharingType]
    sharedIntegrationIds?: string[]
  }): Promise<Signature> {
    // Check permissions for organization-wide signatures
    if (data.sharingType === SignatureSharingType.ORGANIZATION_WIDE) {
      const canCreateOrgWide = await this.permissionService.canCreateOrgWideSignature()

      if (!canCreateOrgWide) {
        throw new Error('Only administrators can create organization-wide signatures')
      }
    }

    // If setting as default, unset default flag on other signatures
    if (data.isDefault) {
      await this.unsetDefaultSignatures()
    }

    // Create the signature with initial data
    const [signature] = await this.db
      .insert(schema.Signature)
      .values({
        name: data.name,
        body: data.body,
        isDefault: data.isDefault ?? false,
        sharingType: data.sharingType,
        organizationId: this.organizationId,
        createdById: this.userId,
        updatedAt: new Date(),
      })
      .returning()

    // Handle integration sharing if specified
    if (
      data.sharingType === SignatureSharingType.SPECIFIC_INTEGRATIONS &&
      data.sharedIntegrationIds?.length
    ) {
      await this.shareWithIntegrations(signature.id, data.sharedIntegrationIds)
    }

    return signature
  }

  /**
   * Update an existing signature
   */
  async updateSignature(
    id: string,
    data: {
      name: string
      body: string
      isDefault?: boolean
      sharingType?: (typeof SignatureSharingType)[keyof typeof SignatureSharingType]
      sharedIntegrationIds?: string[]
    }
  ): Promise<Signature> {
    // Check if user can edit
    const canEdit = await this.permissionService.canEditSignature(id)
    if (!canEdit) {
      throw new Error("You don't have permission to edit this signature")
    }

    // Verify the signature exists
    const signature = await this.db.query.Signature.findFirst({
      where: (signatures, { eq }) => eq(signatures.id, id),
      with: { sharedIntegrations: true },
    })

    if (!signature) {
      throw new Error('Signature not found')
    }

    // Check permissions for organization-wide signatures
    if (data.sharingType === SignatureSharingType.ORGANIZATION_WIDE) {
      const canCreateOrgWide = await this.permissionService.canCreateOrgWideSignature()

      if (!canCreateOrgWide) {
        throw new Error('Only administrators can set signatures as organization-wide')
      }
    }

    // If setting as default, unset default flag on other signatures
    if (data.isDefault) {
      await this.unsetDefaultSignatures(id)
    }

    // Update the basic signature data
    const [updatedSignature] = await this.db
      .update(schema.Signature)
      .set({
        name: data.name,
        body: data.body,
        isDefault: data.isDefault ?? signature.isDefault,
        sharingType: data.sharingType ?? signature.sharingType,
        updatedAt: new Date(),
      })
      .where(eq(schema.Signature.id, id))
      .returning()

    // Update shared integrations if specified and sharing type is SPECIFIC_INTEGRATIONS
    if (
      data.sharingType === SignatureSharingType.SPECIFIC_INTEGRATIONS &&
      data.sharedIntegrationIds
    ) {
      // Remove all existing integration shares
      await this.db
        .delete(schema.SignatureIntegrationShare)
        .where(eq(schema.SignatureIntegrationShare.signatureId, id))

      // Add new integration shares
      if (data.sharedIntegrationIds.length > 0) {
        await this.shareWithIntegrations(id, data.sharedIntegrationIds)
      }
    }

    return updatedSignature
  }

  /**
   * Delete a signature
   */
  async deleteSignature(id: string): Promise<Signature> {
    // Check if user can delete
    const canDelete = await this.permissionService.canDeleteSignature(id)
    if (!canDelete) {
      throw new Error("You don't have permission to delete this signature")
    }

    // Verify the signature exists
    const signature = await this.db.query.Signature.findFirst({
      where: (signatures, { eq }) => eq(signatures.id, id),
    })

    if (!signature) {
      throw new Error('Signature not found')
    }

    // Delete the signature (cascade will handle related records)
    const [deletedSignature] = await this.db
      .delete(schema.Signature)
      .where(eq(schema.Signature.id, id))
      .returning()

    return deletedSignature
  }

  /**
   * Set a signature as default
   */
  async setDefaultSignature(id: string): Promise<Signature> {
    // Check if user can access the signature
    const canView = await this.permissionService.canViewSignature(id)
    if (!canView) {
      throw new Error("You don't have permission to use this signature")
    }

    // Unset default flag on other signatures
    await this.unsetDefaultSignatures()

    // Set this signature as default
    const [updatedSignature] = await this.db
      .update(schema.Signature)
      .set({
        isDefault: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.Signature.id, id))
      .returning()

    return updatedSignature
  }

  /**
   * Get the default signature for the current user
   */
  /*async getDefaultSignature(): Promise<Signature | null> {
    const signatures = await this.db.signature.findMany({
      where: {
        organizationId: this.organizationId,
        isDefault: true,
        OR: [
          { createdById: this.userId }, // User's own
          { sharingType: SignatureSharingType.ORGANIZATION_WIDE }, // Org-wide
          { sharingType: SignatureSharingType.SPECIFIC_INTEGRATIONS }, // Available to all users but specific integrations
        ],
      },
      orderBy: [
        { createdById: { equals: this.userId ? 'asc' : 'desc' } }, // User's own first
        { updatedAt: 'desc' }, // Then most recently updated
      ],
      take: 1,
    })

    return signatures.length > 0 ? signatures[0] : null
  }*/

  /**
   * Share signature with specific integrations
   */
  async shareWithIntegrations(signatureId: string, integrationIds: string[]): Promise<void> {
    // Check if user can share
    const canEdit = await this.permissionService.canEditSignature(signatureId)
    if (!canEdit) {
      throw new Error("You don't have permission to share this signature")
    }

    // Verify all integrations exist and belong to the organization
    const orgIntegrations = await this.db.query.Integration.findMany({
      where: (integrations, { eq, and, inArray }) =>
        and(
          eq(integrations.organizationId, this.organizationId),
          inArray(integrations.id, integrationIds)
        ),
      columns: { id: true },
    })

    const validIntegrationIds = orgIntegrations.map((i) => i.id)

    if (validIntegrationIds.length !== integrationIds.length) {
      throw new Error('Some integrations are not part of the organization')
    }

    // Create share records using upsert
    const shareData = validIntegrationIds.map((integrationId) => ({
      signatureId,
      integrationId,
      createdAt: new Date(),
    }))

    // Use individual upsert operations since Drizzle doesn't support batch upserts in transactions
    for (const data of shareData) {
      await this.db
        .insert(schema.SignatureIntegrationShare)
        .values(data)
        .onConflictDoUpdate({
          target: [
            schema.SignatureIntegrationShare.signatureId,
            schema.SignatureIntegrationShare.integrationId,
          ],
          set: { createdAt: data.createdAt },
        })
    }
  }

  /**
   * Unset default flag on all signatures except the specified one
   */
  private async unsetDefaultSignatures(exceptId?: string): Promise<void> {
    let whereClause = and(
      eq(schema.Signature.organizationId, this.organizationId),
      eq(schema.Signature.isDefault, true),
      or(
        eq(schema.Signature.createdById, this.userId), // User's own
        eq(schema.Signature.sharingType, SignatureSharingType.ORGANIZATION_WIDE) // Org-wide
      )
    )

    if (exceptId) {
      whereClause = and(whereClause, ne(schema.Signature.id, exceptId))
    }

    await this.db
      .update(schema.Signature)
      .set({
        isDefault: false,
        updatedAt: new Date(),
      })
      .where(whereClause)
  }
}
