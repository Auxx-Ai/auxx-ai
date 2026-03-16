// packages/lib/src/workflows/workflow-version-service.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { onCacheEvent } from '../cache/invalidate'
import { PollingTriggerService } from './polling-trigger-service'
import { ScheduledTriggerService } from './scheduled-trigger-service'
import { WorkflowTriggerType, type WorkflowVersion } from './types'

const logger = createScopedLogger('workflow-version-service')

export class WorkflowVersionService {
  private scheduledTriggerService = new ScheduledTriggerService()
  private pollingTriggerService = new PollingTriggerService()

  constructor(private db: Database) {}

  /**
   * Publish a new version of a workflow
   */
  async publish(
    workflowId: string,
    organizationId: string,
    versionTitle?: string
  ): Promise<WorkflowVersion> {
    logger.info('Publishing new workflow version', { workflowId, organizationId, versionTitle })

    try {
      // Get the current workflow app
      const workflowApp = await this.db.query.WorkflowApp.findFirst({
        where: (workflowApps, { eq, and }) =>
          and(eq(workflowApps.id, workflowId), eq(workflowApps.organizationId, organizationId)),
        with: {
          draftWorkflow: true,
          workflows: {
            orderBy: (workflows, { desc }) => [desc(workflows.version)],
            limit: 1,
          },
        },
      })

      if (!workflowApp) {
        throw new Error('Workflow not found')
      }

      if (!workflowApp.draftWorkflow) {
        throw new Error('No draft workflow to publish')
      }

      // Get the next version number
      const latestVersion = workflowApp.workflows[0]?.version || 0
      const nextVersion = latestVersion + 1

      // Use transaction to ensure atomicity
      const newVersion = await this.db.transaction(async (tx) => {
        // First, disable all existing enabled versions for this workflowApp
        await tx
          .update(schema.Workflow)
          .set({ enabled: false, updatedAt: new Date() })
          .where(
            and(
              eq(schema.Workflow.workflowAppId, workflowApp.id),
              eq(schema.Workflow.enabled, true)
            )
          )

        // Create new published version from draft
        const [createdVersion] = await tx
          .insert(schema.Workflow)
          .values({
            workflowAppId: workflowApp.id,
            name: versionTitle || `Version ${nextVersion}`,
            description: workflowApp.draftWorkflow?.description,
            version: nextVersion,
            triggerType:
              workflowApp.draftWorkflow?.triggerType || WorkflowTriggerType.MESSAGE_RECEIVED,
            triggerAppId: workflowApp.draftWorkflow?.triggerAppId || undefined,
            triggerTriggerId: workflowApp.draftWorkflow?.triggerTriggerId || undefined,
            triggerInstallationId: workflowApp.draftWorkflow?.triggerInstallationId || undefined,
            triggerConnectionId: workflowApp.draftWorkflow?.triggerConnectionId || undefined,
            entityDefinitionId: workflowApp.draftWorkflow?.entityDefinitionId || undefined,
            graph: workflowApp.draftWorkflow?.graph || undefined,
            envVars: workflowApp.draftWorkflow?.envVars || undefined,
            variables: workflowApp.draftWorkflow?.variables || undefined,
            organizationId,
            enabled: true, // Published version is enabled
            updatedAt: new Date(),
          })
          .returning()

        if (!createdVersion) {
          throw new Error('Failed to create workflow version')
        }

        // Update WorkflowApp to point to the new published version
        // Keep draft workflow unchanged so users can continue editing
        await tx
          .update(schema.WorkflowApp)
          .set({ workflowId: createdVersion.id, updatedAt: new Date(), enabled: true })
          .where(eq(schema.WorkflowApp.id, workflowApp.id))

        return createdVersion
      })

      logger.info('New workflow version published', {
        workflowAppId: workflowId,
        versionId: newVersion.id,
        version: nextVersion,
        organizationId,
      })

      // Schedule triggers for the published workflow (only if enabled)
      try {
        const workflowAppWithPublished = await this.db.query.WorkflowApp.findFirst({
          where: (workflowApps, { eq }) => eq(workflowApps.id, workflowId),
          with: {
            publishedWorkflow: true,
            organization: {
              columns: { name: true },
            },
          },
        })

        if (workflowAppWithPublished?.publishedWorkflow) {
          if (workflowAppWithPublished.enabled) {
            await this.scheduledTriggerService.scheduleWorkflowTriggers(workflowAppWithPublished)
            await this.pollingTriggerService.schedulePollingTrigger(workflowAppWithPublished)
            logger.info('Scheduled triggers set up for published enabled workflow', {
              workflowAppId: workflowId,
              versionId: newVersion.id,
              enabled: workflowAppWithPublished.enabled,
            })
          } else {
            logger.info('Skipping scheduler setup for published disabled workflow', {
              workflowAppId: workflowId,
              versionId: newVersion.id,
              enabled: workflowAppWithPublished.enabled,
            })
          }
        }
      } catch (schedulingError) {
        logger.error('Failed to set up scheduled triggers for published workflow', {
          workflowAppId: workflowId,
          versionId: newVersion.id,
          error:
            schedulingError instanceof Error ? schedulingError.message : String(schedulingError),
        })
        // Don't fail the publish operation if scheduling fails
      }

      await onCacheEvent('workflow.published', { orgId: organizationId })

      return {
        id: newVersion.id,
        name: newVersion.name,
        version: newVersion.version,
        createdAt: newVersion.createdAt,
        enabled: newVersion.enabled,
        title: newVersion.name, // Map name to title for UI compatibility
        isPublished: newVersion.enabled, // Map enabled to isPublished for UI compatibility
        isDraft: !newVersion.enabled,
      }
    } catch (error) {
      logger.error('Failed to publish workflow version', { error, workflowId, organizationId })
      throw error
    }
  }

  /**
   * Get all versions of a workflow
   */
  async getVersions(workflowId: string, organizationId: string): Promise<WorkflowVersion[]> {
    logger.info('Getting workflow versions', { workflowId, organizationId })

    try {
      const workflowApp = await this.db.query.WorkflowApp.findFirst({
        where: (workflowApps, { eq, and }) =>
          and(eq(workflowApps.id, workflowId), eq(workflowApps.organizationId, organizationId)),
        columns: {
          id: true,
          workflowId: true,
          draftWorkflowId: true,
        },
        with: {
          workflows: {
            orderBy: (workflows, { desc }) => [desc(workflows.version)],
            columns: { id: true, name: true, version: true, createdAt: true, enabled: true },
          },
        },
      })

      if (!workflowApp) {
        throw new Error('Workflow not found')
      }

      return workflowApp.workflows.map((version: any) => ({
        id: version.id,
        name: version.name,
        version: version.version,
        createdAt: version.createdAt,
        enabled: version.enabled,
        title: version.name, // Map name to title for UI compatibility
        isPublished: version.id === workflowApp.workflowId, // Only the currently active version
        isDraft: version.id === workflowApp.draftWorkflowId, // Only the actual draft
      }))
    } catch (error) {
      logger.error('Failed to get workflow versions', { error, workflowId, organizationId })
      throw error
    }
  }

  /**
   * Get a specific workflow version
   */
  async getVersionById(
    workflowId: string,
    versionId: string,
    organizationId: string
  ): Promise<any> {
    logger.info('Getting workflow version', { workflowId, versionId, organizationId })

    try {
      const version = await this.db.query.Workflow.findFirst({
        where: (workflows, { eq, and }) =>
          and(
            eq(workflows.id, versionId),
            eq(workflows.workflowAppId, workflowId),
            eq(workflows.organizationId, organizationId)
          ),
      })

      if (!version) {
        throw new Error('Workflow version not found')
      }

      return {
        id: version.id,
        name: version.name,
        description: version.description,
        version: version.version,
        triggerType: version.triggerType,
        graph: version.graph,
        envVars: version.envVars,
        variables: version.variables || [],
        title: version.name, // Map name to title for UI compatibility
        createdAt: version.createdAt,
        isPublished: version.enabled, // Map enabled to isPublished for UI compatibility
        isDraft: !version.enabled,
      }
    } catch (error) {
      logger.error('Failed to get workflow version', {
        error,
        workflowId,
        versionId,
        organizationId,
      })
      throw error
    }
  }

  /**
   * Delete a specific workflow version
   */
  async deleteVersion(
    workflowId: string,
    versionId: string,
    organizationId: string
  ): Promise<{ success: boolean }> {
    logger.info('Deleting workflow version', { workflowId, versionId, organizationId })

    try {
      // Check if version exists and belongs to organization
      const version = await this.db.query.Workflow.findFirst({
        where: (workflows, { eq, and }) =>
          and(
            eq(workflows.id, versionId),
            eq(workflows.workflowAppId, workflowId),
            eq(workflows.organizationId, organizationId)
          ),
      })

      if (!version) {
        throw new Error('Workflow version not found')
      }

      // Check if this is the active version (prevent deletion)
      const workflowApp = await this.db.query.WorkflowApp.findFirst({
        where: (workflowApps, { eq, and }) =>
          and(eq(workflowApps.id, workflowId), eq(workflowApps.organizationId, organizationId)),
      })

      if (workflowApp?.workflowId === versionId) {
        throw new Error('Cannot delete the active workflow version')
      }

      // Delete the version
      await this.db.delete(schema.Workflow).where(eq(schema.Workflow.id, versionId))

      logger.info('Workflow version deleted', { workflowId, versionId, organizationId })

      return { success: true }
    } catch (error) {
      logger.error('Failed to delete workflow version', {
        error,
        workflowId,
        versionId,
        organizationId,
      })
      throw error
    }
  }

  /**
   * Rename a specific workflow version
   */
  async renameVersion(
    workflowId: string,
    versionId: string,
    title: string,
    organizationId: string
  ): Promise<WorkflowVersion> {
    logger.info('Renaming workflow version', { workflowId, versionId, title, organizationId })

    try {
      // Check if version exists and belongs to organization
      const version = await this.db.query.Workflow.findFirst({
        where: (workflows, { eq, and }) =>
          and(
            eq(workflows.id, versionId),
            eq(workflows.workflowAppId, workflowId),
            eq(workflows.organizationId, organizationId)
          ),
      })

      if (!version) {
        throw new Error('Workflow version not found')
      }

      // Update the version name
      const [updatedVersion] = await this.db
        .update(schema.Workflow)
        .set({ name: title, updatedAt: new Date() })
        .where(eq(schema.Workflow.id, versionId))
        .returning()

      if (!updatedVersion) {
        throw new Error('Failed to update workflow version')
      }

      logger.info('Workflow version renamed', { workflowId, versionId, title, organizationId })

      return {
        id: updatedVersion.id,
        name: updatedVersion.name,
        version: updatedVersion.version,
        createdAt: updatedVersion.createdAt,
        enabled: updatedVersion.enabled,
        title: updatedVersion.name, // Map name to title for UI compatibility
        isPublished: updatedVersion.enabled, // Map enabled to isPublished for UI compatibility
        isDraft: !updatedVersion.enabled,
      }
    } catch (error) {
      logger.error('Failed to rename workflow version', {
        error,
        workflowId,
        versionId,
        title,
        organizationId,
      })
      throw error
    }
  }
}
