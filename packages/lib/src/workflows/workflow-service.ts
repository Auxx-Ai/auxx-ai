// packages/lib/src/workflows/workflow-service.ts

import { type Database, type Transaction, schema } from '@auxx/database'
import { and, eq, or, ilike, desc, count, inArray, type SQL } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { WorkflowEngine } from '@auxx/lib/workflow-engine'
import {
  WorkflowTriggerType,
  type WorkflowFilter,
  type WorkflowCreateInput,
  type WorkflowUpdateInput,
  type WorkflowTestInput,
  type TestResult,
  type WorkflowListResult,
  type WorkflowWithDetails,
} from './types'
import { ScheduledTriggerService } from './scheduled-trigger-service'
import { getQueue, Queues } from '../jobs/queues'

const logger = createScopedLogger('workflow-service')

export class WorkflowService {
  private scheduledTriggerService = new ScheduledTriggerService()

  constructor(private db: Database) {}

  /**
   * Get all workflow apps for the organization
   */
  async getAll(organizationId: string, filters: WorkflowFilter): Promise<WorkflowListResult> {
    const { enabled, triggerType, search, limit, offset } = filters

    logger.info('Fetching workflow apps', { organizationId, filters })

    try {
      // Build conditional filters
      const whereFilters: SQL[] = [eq(schema.WorkflowApp.organizationId, organizationId)]

      if (enabled !== undefined) {
        whereFilters.push(eq(schema.WorkflowApp.enabled, enabled))
      }

      if (search) {
        whereFilters.push(
          or(
            ilike(schema.WorkflowApp.name, `%${search}%`),
            ilike(schema.WorkflowApp.description, `%${search}%`)
          )!
        )
      }

      // Get workflow apps with published workflow details
      const workflowApps = await this.db.query.WorkflowApp.findMany({
        where: and(...whereFilters),
        with: {
          publishedWorkflow: {
            columns: {
              id: true,
              version: true,
              triggerType: true,
              graph: true,
              variables: true,
            },
          },
          createdBy: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: [desc(schema.WorkflowApp.enabled), desc(schema.WorkflowApp.updatedAt)],
        limit,
        offset,
      })

      // Filter out apps that don't match triggerType if specified
      const filteredApps = triggerType
        ? workflowApps.filter((app) => app.publishedWorkflow?.triggerType === triggerType)
        : workflowApps

      // Get latest workflow run for each app
      const workflowAppIds = filteredApps.map((app) => app.id)
      const latestRuns =
        workflowAppIds.length > 0
          ? await this.db.query.WorkflowRun.findMany({
              where: and(
                inArray(schema.WorkflowRun.workflowAppId, workflowAppIds),
                eq(schema.WorkflowRun.organizationId, organizationId)
              ),
              columns: {
                id: true,
                status: true,
                createdAt: true,
                workflowAppId: true,
              },
              orderBy: desc(schema.WorkflowRun.createdAt),
            })
          : []

      // Get counts separately since Drizzle extras can't handle aggregates
      const [totalCount, runCounts, workflowCounts] = await Promise.all([
        this.db
          .select({ count: count() })
          .from(schema.WorkflowApp)
          .where(and(...whereFilters))
          .then((r) => r[0]?.count || 0),
        workflowAppIds.length > 0
          ? this.db
              .select({
                workflowAppId: schema.WorkflowRun.workflowAppId,
                count: count(),
              })
              .from(schema.WorkflowRun)
              .where(
                and(
                  inArray(schema.WorkflowRun.workflowAppId, workflowAppIds),
                  eq(schema.WorkflowRun.organizationId, organizationId)
                )
              )
              .groupBy(schema.WorkflowRun.workflowAppId)
          : [],
        workflowAppIds.length > 0
          ? this.db
              .select({
                workflowAppId: schema.Workflow.workflowAppId,
                count: count(),
              })
              .from(schema.Workflow)
              .where(inArray(schema.Workflow.workflowAppId, workflowAppIds))
              .groupBy(schema.Workflow.workflowAppId)
          : [],
      ])

      // Create lookup maps for counts and runs
      const runCountMap = new Map(runCounts.map((r) => [r.workflowAppId, r.count]))
      const workflowCountMap = new Map(workflowCounts.map((w) => [w.workflowAppId, w.count]))
      const latestRunMap = new Map(latestRuns.map((r) => [r.workflowAppId, r]))

      // Transform to match expected structure
      const workflows = filteredApps.map((app) => ({
        id: app.id,
        name: app.name,
        description: app.description,
        enabled: app.enabled,
        version: app.publishedWorkflow?.version || 1,
        triggerType: app.publishedWorkflow?.triggerType,
        organizationId: app.organizationId,
        createdAt: app.createdAt,
        updatedAt: app.updatedAt,
        createdBy: app.createdBy,
        graph: app.publishedWorkflow?.graph || null,
        variables: app.publishedWorkflow?.variables || [],
        executions: latestRunMap.get(app.id) ? [latestRunMap.get(app.id)!] : [],
        _count: {
          executions: runCountMap.get(app.id) || 0,
          workflows: workflowCountMap.get(app.id) || 0,
        },
        isPublic: app.isPublic,
        isUniversal: app.isUniversal,
        workflowId: app.workflowId,
        icon: app.icon,
      }))

      return {
        workflows,
        total: totalCount,
        hasMore: offset + workflows.length < totalCount,
      }
    } catch (error) {
      logger.error('Failed to fetch workflow apps', { error, organizationId })
      throw new Error('Failed to fetch workflow apps')
    }
  }

  /**
   * Get a specific workflow app by ID
   */
  async getById(id: string, organizationId: string): Promise<WorkflowWithDetails> {
    logger.info('Fetching workflow app by ID', { workflowAppId: id, organizationId })

    try {
      const workflowApp = await this.db.query.WorkflowApp.findFirst({
        where: and(
          eq(schema.WorkflowApp.id, id),
          eq(schema.WorkflowApp.organizationId, organizationId)
        ),
        with: {
          draftWorkflow: true,
          publishedWorkflow: true,
          workflows: {
            columns: {
              id: true,
              version: true,
              name: true,
              createdAt: true,
              enabled: true,
            },
            orderBy: desc(schema.Workflow.version),
          },
          createdBy: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      })

      if (!workflowApp) {
        throw new Error('Workflow not found')
      }

      return workflowApp as WorkflowWithDetails
    } catch (error) {
      logger.error('Failed to fetch workflow app', { error, workflowAppId: id, organizationId })
      throw error
    }
  }

  /**
   * Create a new workflow app with initial workflow version
   */
  async create(organizationId: string, userId: string, input: WorkflowCreateInput): Promise<any> {
    const {
      name,
      description,
      enabled,
      icon,
      graph,
      triggerType,
      triggerConfig,
      envVars,
      variables,
    } = input
    const finalTriggerType = triggerType || WorkflowTriggerType.MESSAGE_RECEIVED

    logger.info('Creating workflow app', { organizationId, userId, name })

    try {
      // Create WorkflowApp with initial workflow version in a transaction
      const result = await this.db.transaction(async (tx: Transaction) => {
        // Create the WorkflowApp
        const [workflowApp] = await tx
          .insert(schema.WorkflowApp)
          .values({
            name,
            description,
            enabled,
            icon: icon as any,
            organizationId,
            createdById: userId,
            updatedAt: new Date(),
          })
          .returning()

        // Create initial draft workflow version
        const [draftWorkflow] = await tx
          .insert(schema.Workflow)
          .values({
            name: `${name} (Draft)`,
            description,
            triggerType: finalTriggerType,
            triggerConfig: triggerConfig as any,
            enabled: false, // Draft is always disabled
            organizationId,
            createdById: userId,
            version: 1,
            workflowAppId: workflowApp!.id,
            graph: graph as any,
            envVars: envVars as any,
            variables: variables as any,
            updatedAt: new Date(),
          })
          .returning()

        // Set the draft workflow for the app
        await tx
          .update(schema.WorkflowApp)
          .set({
            draftWorkflowId: draftWorkflow!.id,
            workflowId: null, // Initially, no published version exists
            updatedAt: new Date(),
          })
          .where(eq(schema.WorkflowApp.id, workflowApp!.id))

        // Return WorkflowApp with the draft workflow
        return await tx.query.WorkflowApp.findFirst({
          where: eq(schema.WorkflowApp.id, workflowApp!.id),
          with: {
            draftWorkflow: true,
            publishedWorkflow: true,
            createdBy: {
              columns: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        })
      })

      logger.info('Workflow app created successfully', {
        workflowAppId: result?.id,
        organizationId,
      })

      if (result) {
        // Transform to match expected structure
        // Use draft workflow for editing
        const workflowData = result.draftWorkflow || result.publishedWorkflow
        return {
          id: result.id,
          name: result.name,
          description: result.description,
          enabled: result.enabled,
          version: workflowData?.version || 1,
          triggerType: workflowData?.triggerType || finalTriggerType,
          organizationId: result.organizationId,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
          createdBy: result.createdBy,
          workflowId: result.draftWorkflowId, // Return draft workflow ID for editing
          isPublic: result.isPublic,
          isUniversal: result.isUniversal,
        }
      }

      return result
    } catch (error) {
      logger.error('Failed to create workflow app', { error, organizationId })
      throw error
    }
  }

  /**
   * Update an existing workflow app (updates active workflow)
   */
  async update(organizationId: string, input: WorkflowUpdateInput): Promise<any> {
    const { id, ...updateData } = input

    logger.info('Updating workflow app', { workflowAppId: id, organizationId })

    try {
      // Verify WorkflowApp exists and belongs to organization
      const existingWorkflowApp = await this.db.query.WorkflowApp.findFirst({
        where: and(
          eq(schema.WorkflowApp.id, id),
          eq(schema.WorkflowApp.organizationId, organizationId)
        ),
        with: {
          draftWorkflow: true,
          publishedWorkflow: true,
        },
      })

      if (!existingWorkflowApp) {
        throw new Error('Workflow not found')
      }

      // Separate access settings from workflow fields
      const {
        graph,
        envVars,
        variables,
        webEnabled,
        apiEnabled,
        accessMode,
        icon,
        config,
        rateLimit,
        ...basicUpdateData
      } = updateData

      const result = await this.db.transaction(async (tx: Transaction) => {
        // Update WorkflowApp fields (including share settings)
        const workflowAppUpdates: any = { updatedAt: new Date() }

        // Basic fields
        if (basicUpdateData.name) workflowAppUpdates.name = basicUpdateData.name
        if (basicUpdateData.description !== undefined)
          workflowAppUpdates.description = basicUpdateData.description
        if (basicUpdateData.enabled !== undefined)
          workflowAppUpdates.enabled = basicUpdateData.enabled

        // Access settings fields (stored on WorkflowApp)
        if (webEnabled !== undefined) {
          // Only allow enabling web access for manual trigger workflows
          if (webEnabled === true) {
            const workflowTriggerType = existingWorkflowApp.draftWorkflow?.triggerType
            if (workflowTriggerType !== 'manual-trigger') {
              throw new Error('Only workflows with a Manual trigger can have web access enabled')
            }
          }
          workflowAppUpdates.webEnabled = webEnabled
        }
        if (apiEnabled !== undefined) {
          // Only allow enabling API access for manual trigger workflows
          if (apiEnabled === true) {
            const workflowTriggerType = existingWorkflowApp.draftWorkflow?.triggerType
            if (workflowTriggerType !== 'manual-trigger') {
              throw new Error('Only workflows with a Manual trigger can have API access enabled')
            }
          }
          workflowAppUpdates.apiEnabled = apiEnabled
        }
        if (accessMode !== undefined) workflowAppUpdates.accessMode = accessMode
        if (icon !== undefined) workflowAppUpdates.icon = icon
        if (config !== undefined) workflowAppUpdates.config = config
        if (rateLimit !== undefined) workflowAppUpdates.rateLimit = rateLimit

        if (Object.keys(workflowAppUpdates).length > 1) {
          await tx
            .update(schema.WorkflowApp)
            .set(workflowAppUpdates)
            .where(eq(schema.WorkflowApp.id, id))
        }

        // Update draft workflow (always update draft, not published)
        if (existingWorkflowApp.draftWorkflow) {
          const workflowUpdates: any = {
            version: existingWorkflowApp.draftWorkflow.version + 1,
            updatedAt: new Date(),
          }

          if (basicUpdateData.name) workflowUpdates.name = `${basicUpdateData.name} (Draft)`
          if (basicUpdateData.description !== undefined)
            workflowUpdates.description = basicUpdateData.description
          if (basicUpdateData.triggerType) workflowUpdates.triggerType = basicUpdateData.triggerType
          if (basicUpdateData.triggerConfig !== undefined)
            workflowUpdates.triggerConfig = basicUpdateData.triggerConfig
          if (graph) workflowUpdates.graph = graph as any
          if (envVars) workflowUpdates.envVars = envVars as any
          if (variables) workflowUpdates.variables = variables as any

          await tx
            .update(schema.Workflow)
            .set(workflowUpdates)
            .where(eq(schema.Workflow.id, existingWorkflowApp.draftWorkflow.id))
        } else {
          // Create draft if it doesn't exist
          const [draftWorkflow] = await tx
            .insert(schema.Workflow)
            .values({
              name: `${basicUpdateData.name || existingWorkflowApp.name} (Draft)`,
              description: basicUpdateData.description || existingWorkflowApp.description,
              triggerType: basicUpdateData.triggerType || WorkflowTriggerType.MESSAGE_RECEIVED,
              triggerConfig: basicUpdateData.triggerConfig as any,
              enabled: false,
              organizationId,
              version: 1,
              workflowAppId: id,
              graph: graph as any,
              envVars: envVars as any,
              variables: variables as any,
              updatedAt: new Date(),
            })
            .returning()

          await tx
            .update(schema.WorkflowApp)
            .set({
              draftWorkflowId: draftWorkflow.id,
              updatedAt: new Date(),
            })
            .where(eq(schema.WorkflowApp.id, id))
        }

        // Return updated WorkflowApp
        return await tx.query.WorkflowApp.findFirst({
          where: eq(schema.WorkflowApp.id, id),
          with: {
            draftWorkflow: true,
            publishedWorkflow: true,
            createdBy: {
              columns: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        })
      })

      logger.info('Workflow app updated successfully', { workflowAppId: id, organizationId })

      // Handle enable/disable scheduling logic
      if (updateData.enabled !== undefined && result) {
        try {
          if (updateData.enabled && result.publishedWorkflow) {
            // Re-schedule triggers when enabling
            await this.scheduledTriggerService.scheduleWorkflowTriggers(result)
            logger.info('Re-scheduled triggers for enabled workflow', { workflowAppId: id })
          } else if (!updateData.enabled) {
            // Remove schedulers when disabling
            await this.scheduledTriggerService.unscheduleWorkflowTriggers(id)
            logger.info('Removed schedulers for disabled workflow', { workflowAppId: id })
          }
        } catch (schedulingError) {
          logger.error('Failed to update scheduled triggers for workflow', {
            workflowAppId: id,
            enabled: updateData.enabled,
            error:
              schedulingError instanceof Error ? schedulingError.message : String(schedulingError),
          })
          // Don't fail the update operation if scheduling fails
        }
      }

      if (result) {
        // Transform to match expected structure
        // Use draft workflow for editing
        const workflowData = result.draftWorkflow || result.publishedWorkflow
        return {
          id: result.id,
          name: result.name,
          description: result.description,
          enabled: result.enabled,
          version: workflowData?.version || 1,
          triggerType: workflowData?.triggerType,
          graph: workflowData?.graph,
          envVars: workflowData?.envVars,
          variables: workflowData?.variables || [],
          organizationId: result.organizationId,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
          createdBy: result.createdBy,
          workflowId: result.draftWorkflowId, // Return draft workflow ID for editing
          isPublic: result.isPublic,
          isUniversal: result.isUniversal,
          // Access settings
          shareToken: result.shareToken,
          webEnabled: result.webEnabled,
          apiEnabled: result.apiEnabled,
          accessMode: result.accessMode,
          icon: result.icon,
          config: result.config,
          rateLimit: result.rateLimit,
          totalRuns: result.totalRuns,
          lastRunAt: result.lastRunAt,
        }
      }

      return result
    } catch (error) {
      logger.error('Failed to update workflow app', { error, workflowAppId: id, organizationId })
      throw error
    }
  }

  /**
   * Cancel all scheduled/delayed jobs for a workflow being deleted.
   * Fire-and-forget: jobs are idempotent and will no-op if DB records don't exist.
   */
  private async cancelWorkflowJobs(
    workflowAppId: string,
    workflowRunIds: string[]
  ): Promise<void> {
    if (workflowRunIds.length === 0) return

    try {
      const workflowDelayQueue = getQueue(Queues.workflowDelayQueue)
      const cancelledJobs: string[] = []

      // Get delayed/waiting jobs from the queue
      const allJobs = await workflowDelayQueue.getJobs(['delayed', 'waiting'], 0, 500)

      for (const job of allJobs) {
        let shouldRemove = false

        // Resume workflow jobs (Wait node delays)
        if (job.name === 'resumeWorkflowJob' && workflowRunIds.includes(job.data.workflowRunId)) {
          shouldRemove = true
        }

        // Approval timeout jobs
        if (job.name === 'approvalTimeoutJob' && workflowRunIds.includes(job.data.workflowRunId)) {
          shouldRemove = true
        }

        // Resource trigger jobs
        if (job.name === 'executeResourceTrigger' && job.data.workflowAppId === workflowAppId) {
          shouldRemove = true
        }

        if (shouldRemove) {
          await job.remove()
          cancelledJobs.push(`${job.name}:${job.id}`)
        }
      }

      if (cancelledJobs.length > 0) {
        logger.info('Cancelled workflow jobs', {
          workflowAppId,
          cancelledCount: cancelledJobs.length,
          cancelledJobs,
        })
      }
    } catch (error) {
      logger.warn('Failed to cancel workflow jobs', { workflowAppId, error })
    }
  }

  /**
   * Cancel approval-related jobs by approval request IDs.
   * Fire-and-forget: jobs are idempotent and will no-op if DB records don't exist.
   */
  private async cancelApprovalJobs(approvalRequestIds: string[]): Promise<void> {
    if (approvalRequestIds.length === 0) return

    try {
      const workflowDelayQueue = getQueue(Queues.workflowDelayQueue)
      const cancelledJobs: string[] = []

      for (const approvalId of approvalRequestIds) {
        // Cancel timeout job
        const timeoutJobId = `approval-timeout-${approvalId}`
        const timeoutJob = await workflowDelayQueue.getJob(timeoutJobId)
        if (timeoutJob) {
          await timeoutJob.remove()
          cancelledJobs.push(timeoutJobId)
        }

        // Cancel reminder jobs (up to 10 reminders possible)
        for (let i = 1; i <= 10; i++) {
          const reminderJobId = `approval-reminder-${approvalId}-${i}`
          const reminderJob = await workflowDelayQueue.getJob(reminderJobId)
          if (reminderJob) {
            await reminderJob.remove()
            cancelledJobs.push(reminderJobId)
          }
        }
      }

      if (cancelledJobs.length > 0) {
        logger.info('Cancelled approval jobs', {
          approvalCount: approvalRequestIds.length,
          cancelledCount: cancelledJobs.length,
        })
      }
    } catch (error) {
      logger.warn('Failed to cancel approval jobs', { error })
    }
  }

  /**
   * Delete a workflow app (deletes all versions)
   */
  async delete(id: string, organizationId: string): Promise<{ success: boolean }> {
    logger.info('Deleting workflow app', { workflowAppId: id, organizationId })

    try {
      // 1. Verify WorkflowApp exists and belongs to organization
      const workflowApp = await this.db.query.WorkflowApp.findFirst({
        where: and(
          eq(schema.WorkflowApp.id, id),
          eq(schema.WorkflowApp.organizationId, organizationId)
        ),
      })

      if (!workflowApp) {
        throw new Error('Workflow not found')
      }

      // 2. Remove scheduled triggers (cron jobs)
      try {
        await this.scheduledTriggerService.unscheduleWorkflowTriggers(id)
        logger.info('Removed scheduled triggers for workflow deletion', { workflowAppId: id })
      } catch (schedulingError) {
        logger.error('Failed to remove scheduled triggers during workflow deletion', {
          workflowAppId: id,
          error:
            schedulingError instanceof Error ? schedulingError.message : String(schedulingError),
        })
        // Continue with deletion even if scheduler cleanup fails
      }

      // 3. Get all workflow run IDs for this app (needed for job cancellation and FK cleanup)
      const workflowRuns = await this.db.query.WorkflowRun.findMany({
        where: eq(schema.WorkflowRun.workflowAppId, id),
        columns: { id: true },
      })
      const workflowRunIds = workflowRuns.map((r) => r.id)

      // 4. Get all approval request IDs for these workflow runs
      const approvalRequests =
        workflowRunIds.length > 0
          ? await this.db.query.ApprovalRequest.findMany({
              where: inArray(schema.ApprovalRequest.workflowRunId, workflowRunIds),
              columns: { id: true },
            })
          : []
      const approvalRequestIds = approvalRequests.map((a) => a.id)

      // 5. Delete in correct order to avoid foreign key constraints
      await this.db.transaction(async (tx: Transaction) => {
        // 5a. Delete approval responses (FK to ApprovalRequest)
        if (approvalRequestIds.length > 0) {
          await tx
            .delete(schema.ApprovalResponse)
            .where(inArray(schema.ApprovalResponse.approvalRequestId, approvalRequestIds))
        }

        // 5b. Delete approval requests (FK to WorkflowRun with RESTRICT)
        if (workflowRunIds.length > 0) {
          await tx
            .delete(schema.ApprovalRequest)
            .where(inArray(schema.ApprovalRequest.workflowRunId, workflowRunIds))
        }

        // 5c. Delete notifications related to approval requests
        if (approvalRequestIds.length > 0) {
          await tx
            .delete(schema.Notification)
            .where(
              and(
                eq(schema.Notification.entityType, 'approval_request'),
                inArray(schema.Notification.entityId, approvalRequestIds)
              )
            )
        }

        // 5d. Delete all workflow runs (now safe - no FK blockers)
        await tx.delete(schema.WorkflowRun).where(eq(schema.WorkflowRun.workflowAppId, id))

        // 5e. Delete all workflow node executions
        await tx
          .delete(schema.WorkflowNodeExecution)
          .where(eq(schema.WorkflowNodeExecution.workflowAppId, id))

        // 5f. Delete all workflows (versions/drafts)
        await tx.delete(schema.Workflow).where(eq(schema.Workflow.workflowAppId, id))

        // 5g. Finally delete the WorkflowApp
        await tx.delete(schema.WorkflowApp).where(eq(schema.WorkflowApp.id, id))
      })

      logger.info('Workflow app deleted successfully', { workflowAppId: id, organizationId })

      // 6. Cancel BullMQ jobs (fire-and-forget, non-blocking)
      // Jobs are idempotent - they check DB first and no-op if records don't exist
      this.cancelWorkflowJobs(id, workflowRunIds).catch((error) => {
        logger.warn('Failed to cancel workflow jobs after deletion', { workflowAppId: id, error })
      })
      this.cancelApprovalJobs(approvalRequestIds).catch((error) => {
        logger.warn('Failed to cancel approval jobs after deletion', { workflowAppId: id, error })
      })

      return { success: true }
    } catch (error) {
      logger.error('Failed to delete workflow app', { error, workflowAppId: id, organizationId })
      throw error
    }
  }

  /**
   * Duplicate a workflow app with its draft workflow
   * @param sourceId - Source WorkflowApp ID
   * @param newName - Name for the duplicated workflow
   * @param organizationId - Organization ID
   * @param userId - User creating the duplicate
   */
  async duplicate(
    sourceId: string,
    newName: string,
    organizationId: string,
    userId: string
  ): Promise<any> {
    logger.info('Duplicating workflow app', { sourceId, newName, organizationId })

    try {
      // Fetch source workflow app with draft workflow
      const sourceApp = await this.db.query.WorkflowApp.findFirst({
        where: and(
          eq(schema.WorkflowApp.id, sourceId),
          eq(schema.WorkflowApp.organizationId, organizationId)
        ),
        with: {
          draftWorkflow: true,
          publishedWorkflow: true,
        },
      })

      if (!sourceApp) {
        throw new Error('Workflow not found')
      }

      // Use draft workflow, or fall back to published if no draft exists
      const sourceWorkflow = sourceApp.draftWorkflow || sourceApp.publishedWorkflow

      // Create new WorkflowApp with copied draft workflow in transaction
      const result = await this.db.transaction(async (tx: Transaction) => {
        // Create the new WorkflowApp
        const [newWorkflowApp] = await tx
          .insert(schema.WorkflowApp)
          .values({
            name: newName,
            description: sourceApp.description,
            enabled: false, // Start disabled
            organizationId,
            createdById: userId,
            isPublic: false,
            isUniversal: false,
            updatedAt: new Date(),
          })
          .returning()

        // Create draft workflow if source has one
        if (sourceWorkflow) {
          const [newDraftWorkflow] = await tx
            .insert(schema.Workflow)
            .values({
              name: `${newName} (Draft)`,
              description: sourceWorkflow.description,
              triggerType: sourceWorkflow.triggerType,
              triggerConfig: sourceWorkflow.triggerConfig as any,
              enabled: false,
              organizationId,
              createdById: userId,
              version: 1,
              workflowAppId: newWorkflowApp!.id,
              graph: sourceWorkflow.graph as any,
              envVars: sourceWorkflow.envVars as any,
              variables: sourceWorkflow.variables as any,
              updatedAt: new Date(),
            })
            .returning()

          // Set the draft workflow reference
          await tx
            .update(schema.WorkflowApp)
            .set({
              draftWorkflowId: newDraftWorkflow!.id,
              updatedAt: new Date(),
            })
            .where(eq(schema.WorkflowApp.id, newWorkflowApp!.id))
        }

        return newWorkflowApp
      })

      logger.info('Workflow app duplicated successfully', {
        sourceId,
        newId: result?.id,
        organizationId,
      })

      return result
    } catch (error) {
      logger.error('Failed to duplicate workflow app', { error, sourceId, organizationId })
      throw error
    }
  }

  /**
   * Test workflow execution
   */
  async test(
    workflowId: string,
    organizationId: string,
    input: WorkflowTestInput
  ): Promise<TestResult> {
    const { testData, options = {} } = input

    logger.info('Testing workflow execution', { workflowId, organizationId })

    try {
      // Get WorkflowApp with draft workflow for testing
      const workflowApp = await this.db.query.WorkflowApp.findFirst({
        where: and(
          eq(schema.WorkflowApp.id, workflowId),
          eq(schema.WorkflowApp.organizationId, organizationId)
        ),
        with: {
          draftWorkflow: true,
        },
      })

      if (!workflowApp || !workflowApp.draftWorkflow) {
        throw new Error('Workflow draft not found')
      }

      const workflow = workflowApp.draftWorkflow

      // Initialize workflow engine
      const workflowEngine = new WorkflowEngine()
      const nodeRegistry = workflowEngine.getNodeRegistry()
      await nodeRegistry.initializeWithDefaults()

      // Create mock trigger event
      const triggerEvent = {
        type: workflow.triggerType as any,
        data: testData,
        timestamp: new Date(),
        organizationId,
      }

      // Execute workflow
      const result = await workflowEngine.executeWorkflow(workflow as any, triggerEvent, {
        debug: options.debug ?? true,
        dryRun: options.dryRun ?? true,
        variables: testData.variables ?? {},
      })

      logger.info('Workflow test completed', { workflowId, status: result.status, organizationId })

      return { success: result.status === 'COMPLETED', result }
    } catch (error) {
      logger.error('Failed to test workflow', { error, workflowId, organizationId })
      throw error
    }
  }
}
