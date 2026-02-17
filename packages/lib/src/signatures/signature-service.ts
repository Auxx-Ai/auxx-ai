// packages/lib/src/signatures/signature-service.ts

// TODO: Rewrite SignatureService to use EntityInstance queries.
// The Signature table has been dropped. Signatures now live as EntityInstances
// with entityType='signature'. All CRUD operations need to go through
// EntityInstance + FieldValue tables via UnifiedCrudHandler or direct queries.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('signature-service')

/** Placeholder type until signature fields are defined on EntityInstance */
export interface SignatureData {
  id: string
  name: string
  body: string
  isDefault: boolean
  sharingType: string
  organizationId: string
  createdById: string
  updatedAt: Date
}

export class SignatureService {
  private db: Database
  private organizationId: string
  private userId: string

  constructor(db: Database, organizationId: string, userId: string) {
    this.db = db
    this.organizationId = organizationId
    this.userId = userId
  }

  /**
   * Get all signatures accessible to the current user
   * TODO: Rewrite using EntityInstance queries for entityType='signature'
   */
  async getAllSignatures(): Promise<SignatureData[]> {
    logger.warn('SignatureService.getAllSignatures is stubbed - Signature table was dropped')
    return []
  }

  /**
   * Get signatures for a specific integration
   * TODO: Rewrite using EntityInstance queries
   */
  async getSignaturesForIntegration(_integrationId: string): Promise<SignatureData[]> {
    logger.warn(
      'SignatureService.getSignaturesForIntegration is stubbed - Signature table was dropped'
    )
    return []
  }

  /**
   * Get the default signature for the current user's context
   * TODO: Rewrite using EntityInstance queries
   */
  async getDefaultSignatureForContext(_inboxId?: string): Promise<SignatureData | null> {
    logger.warn(
      'SignatureService.getDefaultSignatureForContext is stubbed - Signature table was dropped'
    )
    return null
  }

  /**
   * Get the legacy default signature for the current user
   * TODO: Rewrite using EntityInstance queries
   */
  async getDefaultSignature(): Promise<SignatureData | null> {
    logger.warn('SignatureService.getDefaultSignature is stubbed - Signature table was dropped')
    return null
  }

  /**
   * Get a signature by ID
   * TODO: Rewrite using EntityInstance queries
   */
  async getSignatureById(_id: string): Promise<SignatureData | null> {
    logger.warn('SignatureService.getSignatureById is stubbed - Signature table was dropped')
    return null
  }

  /**
   * Create a new signature
   * TODO: Rewrite using EntityInstance + FieldValue
   */
  async createSignature(data: {
    name: string
    body: string
    isDefault?: boolean
    sharingType: string
    sharedIntegrationIds?: string[]
  }): Promise<SignatureData> {
    logger.warn('SignatureService.createSignature is stubbed - Signature table was dropped')
    // Return a stub object so callers don't crash
    return {
      id: 'stub-signature-id',
      name: data.name,
      body: data.body,
      isDefault: data.isDefault ?? false,
      sharingType: data.sharingType,
      organizationId: this.organizationId,
      createdById: this.userId,
      updatedAt: new Date(),
    }
  }

  /**
   * Update an existing signature
   * TODO: Rewrite using EntityInstance + FieldValue
   */
  async updateSignature(
    _id: string,
    data: {
      name: string
      body: string
      isDefault?: boolean
      sharingType?: string
      sharedIntegrationIds?: string[]
    }
  ): Promise<SignatureData> {
    logger.warn('SignatureService.updateSignature is stubbed - Signature table was dropped')
    return {
      id: _id,
      name: data.name,
      body: data.body,
      isDefault: data.isDefault ?? false,
      sharingType: data.sharingType ?? 'PRIVATE',
      organizationId: this.organizationId,
      createdById: this.userId,
      updatedAt: new Date(),
    }
  }

  /**
   * Delete a signature
   * TODO: Rewrite using EntityInstance delete
   */
  async deleteSignature(_id: string): Promise<SignatureData> {
    logger.warn('SignatureService.deleteSignature is stubbed - Signature table was dropped')
    return {
      id: _id,
      name: '',
      body: '',
      isDefault: false,
      sharingType: 'PRIVATE',
      organizationId: this.organizationId,
      createdById: this.userId,
      updatedAt: new Date(),
    }
  }

  /**
   * Set a signature as default
   * TODO: Rewrite using EntityInstance + FieldValue
   */
  async setDefaultSignature(_id: string): Promise<SignatureData> {
    logger.warn('SignatureService.setDefaultSignature is stubbed - Signature table was dropped')
    return {
      id: _id,
      name: '',
      body: '',
      isDefault: true,
      sharingType: 'PRIVATE',
      organizationId: this.organizationId,
      createdById: this.userId,
      updatedAt: new Date(),
    }
  }

  /**
   * Share signature with specific integrations
   * TODO: Rewrite using SignatureIntegrationShare with EntityInstance
   */
  async shareWithIntegrations(_signatureId: string, _integrationIds: string[]): Promise<void> {
    logger.warn('SignatureService.shareWithIntegrations is stubbed - Signature table was dropped')
  }
}
