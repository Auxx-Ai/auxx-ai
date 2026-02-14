// packages/credentials/src/service/credential-service.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import crypto from 'crypto'
import { and, desc, eq } from 'drizzle-orm'
import { CredentialValidator } from './credential-validator'
// Define NodeData type locally for now
export type NodeData = {
  [key: string]: string | number | boolean | null | undefined | NodeData | NodeData[]
}

const logger = createScopedLogger('workflow-credential-service')

// Get encryption key from environment (in production, this should be a proper secret)
const ENCRYPTION_KEY =
  process.env.WORKFLOW_CREDENTIAL_ENCRYPTION_KEY || 'fallback-dev-key-32-chars-long!!'
const ALGORITHM = 'aes-256-gcm'

interface CredentialListItem {
  id: string
  name: string
  type: string
  createdBy: { name: string | null } | null
  createdAt: Date | string
}

export class CredentialService {
  /**
   * Encrypt credential data
   */
  public static encrypt(data: NodeData): string {
    try {
      const iv = crypto.randomBytes(16)
      const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY.substring(0, 32), iv)
      cipher.setAutoPadding(true)

      let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex')
      encrypted += cipher.final('hex')

      const authTag = (cipher as any).getAuthTag?.() || Buffer.alloc(0)

      // Combine iv + authTag + encrypted data
      const combined = Buffer.concat([iv, authTag, Buffer.from(encrypted, 'hex')])

      return combined.toString('base64')
    } catch (error) {
      logger.error('Failed to encrypt credential data', {
        error: error instanceof Error ? error.message : String(error),
      })
      throw new Error('Failed to encrypt credential data')
    }
  }

  /**
   * Decrypt credential data
   */
  public static decrypt(encryptedData: string): NodeData {
    try {
      const combined = Buffer.from(encryptedData, 'base64')

      const iv = combined.subarray(0, 16)
      const authTag = combined.subarray(16, 32)
      const encrypted = combined.subarray(32)

      const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY.substring(0, 32), iv)

      if (authTag.length > 0) {
        ;(decipher as any).setAuthTag?.(authTag)
      }

      let decrypted = decipher.update(encrypted, undefined, 'utf8')
      decrypted += decipher.final('utf8')

      return JSON.parse(decrypted) as NodeData
    } catch (error) {
      logger.error('Failed to decrypt credential data', {
        error: error instanceof Error ? error.message : String(error),
      })
      throw new Error('Failed to decrypt credential data')
    }
  }

  /**
   * Create reusable credential for organization
   */
  static async saveCredential(
    organizationId: string,
    createdById: string,
    credentialType: string,
    name: string,
    data: NodeData
  ): Promise<string> {
    try {
      logger.info('Creating workflow credential', {
        organizationId,
        createdById,
        type: credentialType,
        name,
      })

      // Validate credential data
      const properties = CredentialValidator.getCredentialProperties(credentialType)
      if (properties.length > 0) {
        const validationResult = CredentialValidator.validate(data, properties, false)
        if (!validationResult.isValid) {
          const errorMessages = validationResult.errors
            .map((e) => `${e.field}: ${e.message}`)
            .join(', ')
          throw new Error(`Validation failed: ${errorMessages}`)
        }
      }

      const encrypted = CredentialService.encrypt(data)

      const [credential] = await db
        .insert(schema.WorkflowCredentials)
        .values({
          organizationId,
          createdById,
          type: credentialType,
          name,
          encryptedData: encrypted,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: schema.WorkflowCredentials.id })

      logger.info('Created workflow credential successfully', {
        credentialId: credential!.id,
        organizationId,
        type: credentialType,
      })

      return credential!.id
    } catch (error) {
      logger.error('Failed to save credential', {
        organizationId,
        credentialType,
        error: error instanceof Error ? error.message : String(error),
      })
      throw new Error('Failed to save credential')
    }
  }

  /**
   * Load credential for any workflow node (organization members can access)
   */
  static async loadCredential(credentialId: string, organizationId: string): Promise<NodeData> {
    try {
      const [credential] = await db
        .select()
        .from(schema.WorkflowCredentials)
        .where(
          and(
            eq(schema.WorkflowCredentials.id, credentialId),
            eq(schema.WorkflowCredentials.organizationId, organizationId)
          )
        )
        .limit(1)

      if (!credential) {
        logger.warn('Credential not found or access denied', {
          credentialId,
          organizationId,
        })
        throw new Error('Credential not found or access denied')
      }

      const decryptedData = CredentialService.decrypt(credential.encryptedData)

      logger.debug('Loaded credential successfully', {
        credentialId,
        organizationId,
        type: credential.type,
      })

      return decryptedData
    } catch (error) {
      logger.error('Failed to load credential', {
        credentialId,
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * List organization's credentials by type for dropdown selection
   */
  static async listCredentials(
    organizationId: string,
    credentialType?: string
  ): Promise<CredentialListItem[]> {
    try {
      const credentials = await db
        .select({
          id: schema.WorkflowCredentials.id,
          name: schema.WorkflowCredentials.name,
          type: schema.WorkflowCredentials.type,
          createdAt: schema.WorkflowCredentials.createdAt,
          createdBy: {
            name: schema.User.name,
          },
        })
        .from(schema.WorkflowCredentials)
        .leftJoin(schema.User, eq(schema.WorkflowCredentials.createdById, schema.User.id))
        .where(
          and(
            eq(schema.WorkflowCredentials.organizationId, organizationId),
            credentialType ? eq(schema.WorkflowCredentials.type, credentialType) : undefined
          )
        )
        .orderBy(desc(schema.WorkflowCredentials.createdAt))

      logger.debug('Listed credentials', {
        organizationId,
        credentialType,
        count: credentials.length,
      })

      return credentials
    } catch (error) {
      logger.error('Failed to list credentials', {
        organizationId,
        credentialType,
        error: error instanceof Error ? error.message : String(error),
      })
      throw new Error('Failed to list credentials')
    }
  }

  /**
   * Update credential (with permission check)
   */
  static async updateCredential(
    credentialId: string,
    organizationId: string,
    userId: string,
    updates: { name?: string; data?: NodeData }
  ): Promise<void> {
    try {
      const updateData: any = {}

      if (updates.name) {
        updateData.name = updates.name
      }

      if (updates.data) {
        // Get existing credential to determine type for validation and to merge sensitive fields
        const [existingCredential] = await db
          .select({
            type: schema.WorkflowCredentials.type,
            encryptedData: schema.WorkflowCredentials.encryptedData,
          })
          .from(schema.WorkflowCredentials)
          .where(
            and(
              eq(schema.WorkflowCredentials.id, credentialId),
              eq(schema.WorkflowCredentials.organizationId, organizationId)
            )
          )
          .limit(1)

        if (!existingCredential) {
          throw new Error('Credential not found')
        }

        // Decrypt existing data to preserve sensitive fields
        const existingData = CredentialService.decrypt(existingCredential.encryptedData)

        // Merge update data with existing data, preserving existing sensitive values when new values are empty
        const mergedData = CredentialService.mergeCredentialData(
          existingData,
          updates.data,
          existingCredential.type
        )

        // Validate the merged credential data
        const properties = CredentialValidator.getCredentialProperties(existingCredential.type)
        if (properties.length > 0) {
          const validationResult = CredentialValidator.validate(mergedData, properties, true)
          if (!validationResult.isValid) {
            const errorMessages = validationResult.errors
              .map((e) => `${e.field}: ${e.message}`)
              .join(', ')
            throw new Error(`Validation failed: ${errorMessages}`)
          }
        }

        updateData.encryptedData = CredentialService.encrypt(mergedData)
      }

      const result = await db
        .update(schema.WorkflowCredentials)
        .set(updateData)
        .where(
          and(
            eq(schema.WorkflowCredentials.id, credentialId),
            eq(schema.WorkflowCredentials.organizationId, organizationId)
            // Note: Not restricting to createdById for now - all org members can edit
          )
        )

      // Check if any rows were affected (Drizzle doesn't return count like drizzle)
      // We could do a count query first, but for now we'll trust the operation succeeded

      logger.info('Updated credential successfully', {
        credentialId,
        organizationId,
        userId,
        updatedFields: Object.keys(updates),
      })
    } catch (error) {
      logger.error('Failed to update credential', {
        credentialId,
        organizationId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Delete credential (with permission check)
   */
  static async deleteCredential(
    credentialId: string,
    organizationId: string,
    userId: string
  ): Promise<void> {
    try {
      // Check if credential is in use first
      const inUse = await CredentialService.isCredentialInUse(credentialId, organizationId)
      if (inUse) {
        throw new Error('Cannot delete credential: it is currently being used in workflows')
      }

      await db.delete(schema.WorkflowCredentials).where(
        and(
          eq(schema.WorkflowCredentials.id, credentialId),
          eq(schema.WorkflowCredentials.organizationId, organizationId)
          // Note: Not restricting to createdById for now - all org members can delete
        )
      )

      // Note: Drizzle doesn't return count like Prisma, but we'll assume the delete succeeded

      logger.info('Deleted credential successfully', {
        credentialId,
        organizationId,
        userId,
      })
    } catch (error) {
      logger.error('Failed to delete credential', {
        credentialId,
        organizationId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Merge credential data, preserving existing sensitive values when new values are empty
   */
  private static mergeCredentialData(
    existingData: NodeData,
    updateData: NodeData,
    credentialType: string
  ): NodeData {
    const mergedData = { ...existingData }

    // Get credential properties to identify sensitive fields
    const properties = CredentialValidator.getCredentialProperties(credentialType)

    for (const [key, value] of Object.entries(updateData)) {
      // Find the property definition for this field
      const property = properties.find((p) => p.name === key)

      if (property && CredentialService.isSensitiveFieldName(key)) {
        // For sensitive fields, only update if the new value is not empty
        if (value !== undefined && value !== null && value !== '') {
          mergedData[key] = value
        }
        // If empty, keep the existing value (don't overwrite)
      } else {
        // For non-sensitive fields, always update (including empty values)
        mergedData[key] = value
      }
    }

    return mergedData
  }

  /**
   * Check if credential is being used in any workflows
   * TODO: Implement when workflow node data structure is finalized
   */
  private static async isCredentialInUse(
    credentialId: string,
    organizationId: string
  ): Promise<boolean> {
    try {
      // For now, we'll check workflows that contain the credentialId in their graph JSON
      // This is a simple text search - could be optimized with proper JSON queries
      const workflows = await db
        .select({
          id: schema.Workflow.id,
          graph: schema.Workflow.graph,
        })
        .from(schema.Workflow)
        .leftJoin(schema.WorkflowApp, eq(schema.Workflow.workflowAppId, schema.WorkflowApp.id))
        .where(eq(schema.WorkflowApp.organizationId, organizationId))

      for (const workflow of workflows) {
        if (workflow.graph) {
          const graphString = JSON.stringify(workflow.graph)
          if (graphString.includes(credentialId)) {
            logger.debug('Found credential in use', {
              credentialId,
              workflowId: workflow.id,
            })
            return true
          }
        }
      }

      return false
    } catch (error) {
      logger.error('Failed to check credential usage', {
        credentialId,
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      })
      // Return true to be safe - don't allow deletion if we can't check
      return true
    }
  }

  /**
   * Get credential by ID with basic info (no decrypted data)
   */
  static async getCredentialInfo(
    credentialId: string,
    organizationId: string
  ): Promise<{ id: string; name: string; type: string } | null> {
    try {
      const [credential] = await db
        .select({
          id: schema.WorkflowCredentials.id,
          name: schema.WorkflowCredentials.name,
          type: schema.WorkflowCredentials.type,
        })
        .from(schema.WorkflowCredentials)
        .where(
          and(
            eq(schema.WorkflowCredentials.id, credentialId),
            eq(schema.WorkflowCredentials.organizationId, organizationId)
          )
        )
        .limit(1)

      return credential || null
    } catch (error) {
      logger.error('Failed to get credential info', {
        credentialId,
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /**
   * Get non-sensitive credential data for editing
   * Returns credential info plus decrypted non-sensitive fields only
   */
  static async getNonSensitiveCredentialData(
    credentialId: string,
    organizationId: string
  ): Promise<{ info: any; nonSensitiveData: NodeData } | null> {
    try {
      // Get credential from database
      const [credential] = await db
        .select({
          id: schema.WorkflowCredentials.id,
          name: schema.WorkflowCredentials.name,
          type: schema.WorkflowCredentials.type,
          encryptedData: schema.WorkflowCredentials.encryptedData,
          createdAt: schema.WorkflowCredentials.createdAt,
          updatedAt: schema.WorkflowCredentials.updatedAt,
          createdBy: {
            name: schema.User.name,
          },
        })
        .from(schema.WorkflowCredentials)
        .leftJoin(schema.User, eq(schema.WorkflowCredentials.createdById, schema.User.id))
        .where(
          and(
            eq(schema.WorkflowCredentials.id, credentialId),
            eq(schema.WorkflowCredentials.organizationId, organizationId)
          )
        )
        .limit(1)

      if (!credential) {
        return null
      }

      // Decrypt the credential data
      const decryptedData = CredentialService.decrypt(credential.encryptedData)

      // Filter out sensitive fields based on field classification
      const nonSensitiveData = CredentialService.filterNonSensitiveFields(decryptedData)

      const info = {
        id: credential.id,
        name: credential.name,
        type: credential.type,
        createdBy: credential.createdBy,
        createdAt: credential.createdAt,
        updatedAt: credential.updatedAt,
      }

      return {
        info,
        nonSensitiveData,
      }
    } catch (error) {
      logger.error('Failed to get non-sensitive credential data', {
        credentialId,
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /**
   * Filter credential data to exclude sensitive fields
   * This implements our security policy of never exposing sensitive data
   */
  private static filterNonSensitiveFields(data: NodeData): NodeData {
    const filteredData: NodeData = {}

    for (const [key, value] of Object.entries(data)) {
      // Skip sensitive fields based on key name patterns
      if (CredentialService.isSensitiveFieldName(key)) {
        continue
      }

      // Include non-sensitive fields
      filteredData[key] = value
    }

    return filteredData
  }

  /**
   * Determine if a field name indicates sensitive data
   */
  private static isSensitiveFieldName(fieldName: string): boolean {
    const lowerFieldName = fieldName.toLowerCase()
    const sensitivePatterns = [
      'password',
      'passwd',
      'pwd',
      'key',
      'secret',
      'token',
      'auth',
      'credential',
      'privatekey',
      'passphrase',
    ]

    return sensitivePatterns.some((pattern) => lowerFieldName.includes(pattern))
  }
}
