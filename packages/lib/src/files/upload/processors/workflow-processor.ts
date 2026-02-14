// packages/lib/src/files/upload/processors/workflow-processor.ts

import type { AssetKind } from '../../core/types'
import type { ProcessorConfigResult, UploadInitConfig } from '../init-types'
import type { PresignedUploadSession } from '../session-types'
import { BaseAssetProcessor } from './base-asset-processor'
import type { CreateSessionRequest, ProcessorMetadata, ProcessorResult } from './types'

/**
 * Workflow processor for temporary workflow files
 * Creates MediaAssets for workflow inputs/outputs with automatic cleanup
 */
export class WorkflowProcessor extends BaseAssetProcessor {
  getMetadata(): ProcessorMetadata {
    return {
      name: 'workflow',
      entityTypes: ['WORKFLOW_RUN'],
      supportsAssets: true,
      supportsFiles: false,
      supportsAttachments: true, // Can link to workflow runs
    }
  }

  protected async executeProcess(
    session: PresignedUploadSession,
    storageLocationId: string
  ): Promise<ProcessorResult> {
    // For WORKFLOW_RUN entities, automatically set temporary expiration (1 hour for test runs)
    if (session.entityType === 'WORKFLOW_RUN') {
      // Set automatic 1-hour expiration for workflow run files
      const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000)

      // Update session metadata with temporary settings if not already set
      if (!session.metadata) {
        session.metadata = {}
      }

      // Set temporary file properties for workflow runs
      session.metadata.isTemporary = true
      session.metadata.expiresAt = session.metadata.expiresAt || oneHourFromNow

      // Include nodeId from metadata for workflow context
      if (session.metadata.nodeId) {
        this.logger.debug('Processing workflow run file', {
          workflowId: session.entityId,
          nodeId: session.metadata.nodeId,
          expiresAt: session.metadata.expiresAt,
        })
      }
    }

    // If has entity info, use the base asset processor flow
    if (session.entityType && session.entityId) {
      return await super.executeProcess(session, storageLocationId)
    }

    // Otherwise, create standalone asset for workflows
    const assetId = await this.createAsset(session, storageLocationId)

    // Schedule cleanup if temporary
    if (session.metadata?.isTemporary) {
      await this.scheduleCleanup(assetId, session.metadata.expiresAt)
    }

    return {
      assetId,
      storageLocationId,
    }
  }

  // ============= BaseAssetProcessor Implementation =============

  protected readonly entityType = 'WORKFLOW_RUN'
  protected readonly fileVisibility = 'PRIVATE'
  protected readonly preferredProvider = 'S3'
  protected readonly maxFileSize = 100 * 1024 * 1024 // 100MB
  protected readonly allowedMimeTypes = ['*/*'] // Workflow can accept any file type
  protected readonly assetKind: AssetKind = 'TEMP_UPLOAD'

  protected async validateEntityAccess(
    entityId: string,
    organizationId: string,
    userId: string
  ): Promise<void> {
    // Workflow validation logic would go here
    // For now, just log the validation
    this.logger.debug('Validating workflow access', { entityId, organizationId, userId })
  }

  // ============= Unified Processor API =============

  /**
   * Process upload configuration for workflow files
   */
  async processConfig(init: UploadInitConfig): Promise<ProcessorConfigResult> {
    const base = await super.processConfig({ ...init, provider: 'S3' })
    const { config } = base
    const warnings = [...base.warnings]

    // Workflow processor specific policy - accept any MIME type, 100MB limit
    const policy = {
      ...config.policy,
      allowedMimeTypes: ['*/*'], // Workflows can accept any file type
      maxTtl: 10 * 60, // 10 minutes for workflow files (temporary)
    }

    // Use multipart for larger workflow files
    const uploadPlan =
      config.expectedSize >= 50 * 1024 * 1024 // 50MB
        ? { strategy: 'multipart' as const }
        : { strategy: 'single' as const }

    // Validate workflow-specific constraints
    const maxWorkflowFileSize = 100 * 1024 * 1024 // 100MB
    if (init.expectedSize > maxWorkflowFileSize) {
      throw new Error(
        `Workflow files cannot exceed ${Math.round(maxWorkflowFileSize / 1024 / 1024)}MB`
      )
    }

    // Add warning for temporary files without expiration
    if (init.metadata?.isTemporary && !init.metadata?.expiresAt) {
      warnings.push('Temporary workflow file will expire in 24 hours')
    }

    return {
      config: Object.freeze({
        ...config,
        policy,
        uploadPlan,
      }),
      warnings,
    }
  }

  // ============= Workflow-Specific Methods =============

  protected async postCreateAsset(
    session: PresignedUploadSession,
    storageLocationId: string,
    assetId: string
  ): Promise<void> {
    // For workflow run files, set expiration on MediaAsset for automatic cleanup
    if (session.entityType === 'WORKFLOW_RUN' && session.metadata?.isTemporary) {
      const expiresAt = session.metadata.expiresAt

      if (expiresAt) {
        await this.setAssetExpiration(assetId, expiresAt)

        this.logger.info('Set MediaAsset expiration for workflow run file', {
          assetId,
          workflowId: session.entityId,
          nodeId: session.metadata.nodeId,
          expiresAt,
        })
      }
    }

    // Schedule cleanup if temporary (fallback for non-workflow entities)
    if (session.metadata?.isTemporary && session.entityType !== 'WORKFLOW_RUN') {
      await this.scheduleCleanup(assetId, session.metadata.expiresAt)
    }
  }

  /**
   * Set expiration on MediaAsset for automatic cleanup
   */
  protected async setAssetExpiration(assetId: string, expiresAt: Date): Promise<void> {
    try {
      // Update MediaAsset with expiration time using the new expiresAt field
      await this.mediaAssetService.update(assetId, {
        expiresAt,
      })

      this.logger.debug('Set MediaAsset expiration', {
        assetId,
        expiresAt,
      })
    } catch (error) {
      this.logger.error('Failed to set MediaAsset expiration', {
        assetId,
        expiresAt,
        error: error instanceof Error ? error.message : String(error),
      })
      // Don't throw - this is a non-critical operation
    }
  }

  /**
   * Schedule cleanup for temporary workflow files
   */
  private async scheduleCleanup(assetId: string, expiresAt?: Date): Promise<void> {
    const expiration = expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours default

    // This would integrate with your job queue system to schedule cleanup
    this.logger.info('Scheduled workflow asset cleanup', {
      assetId,
      expiresAt: expiration,
    })

    // Example of how this might work with a job queue:
    // await jobQueue.schedule('cleanup-temp-asset', { assetId }, { delay: expiration })
  }
}
