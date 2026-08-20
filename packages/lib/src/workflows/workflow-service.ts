// packages/lib/src/workflows/workflow-service.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils/generateId'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { onCacheEvent } from '../cache/invalidate'
import { canonicalizeEntityDefinitionId, getCachedResources } from '../cache/org-cache-helpers'
import { getCachedWorkflowAppsList } from '../cache/workflow-app-queries'
import { ConflictError, NotFoundError } from '../errors'
import { getQueue, Queues } from '../jobs/queues'
import type { TriggerDerivationNode } from '../workflow-engine/catalog/derive-trigger'
import { deriveTriggerLinkColumns } from '../workflow-engine/catalog/derive-trigger-server'
import {
  dehydrateGraph,
  type GraphDocument,
  hydrateGraph,
} from '../workflow-engine/catalog/graph-hydration'
import { DEHYDRATION_OPTIONS, HYDRATION_OPTIONS } from '../workflow-engine/catalog/hydration-policy'
import { WorkflowEngine } from '../workflow-engine/core/workflow-engine'
import { nextUntitledWorkflowName, pickDefaultWorkflowIcon } from './default-workflow-identity'
import { hashGraphSemantics, hashWorkflowGraph } from './graph-hash'
import { assertMailTriggerNotPersonal } from './mail-trigger-guard'
import { PollingTriggerService } from './polling-trigger-service'
import { ScheduledTriggerService } from './scheduled-trigger-service'
import {
  type TestResult,
  type WorkflowCreateInput,
  type WorkflowFilter,
  type WorkflowListResult,
  type WorkflowTestInput,
  WorkflowTriggerType,
  type WorkflowUpdateInput,
  type WorkflowWithDetails,
} from './types'

const logger = createScopedLogger('workflow-service')

/**
 * Flatten a workflow app + its editable (draft, falling back to published) version
 * into the shape the web UI consumes. Draft is preferred so the builder edits the
 * in-progress version.
 *
 * ORDER IS LOAD-BEARING (plan 23 §3.2): the CAS token is minted from the RAW
 * stored graph and re-checked against the raw column inside the save
 * transaction (`update`, below). Hydrate before the mint and the token stops
 * describing the column — every save 409s, forever. So the hash comes off
 * `storedGraph` and the response carries `hydrateGraph(storedGraph)`.
 */
export function toWorkflowAppResponse(workflowApp: WorkflowWithDetails) {
  const workflowData = workflowApp.draftWorkflow || workflowApp.publishedWorkflow
  const storedGraph = workflowData?.graph
  // Minted FIRST, from the raw column. Never move this below the hydration.
  const graphHash = storedGraph ? hashWorkflowGraph(storedGraph) : null
  return {
    id: workflowApp.id,
    name: workflowApp.name,
    description: workflowApp.description,
    enabled: workflowApp.enabled,
    triggerType: workflowData?.triggerType,
    entityDefinitionId: workflowData?.entityDefinitionId,
    version: workflowData?.version || 1,
    graph: storedGraph
      ? hydrateGraph(storedGraph as GraphDocument, HYDRATION_OPTIONS)
      : storedGraph,
    // Seed for the editor's optimistic-concurrency token (see WorkflowUpdateInput.expectedGraphHash)
    graphHash,
    variables: workflowData?.variables || [],
    envVars: workflowData?.envVars,
    organizationId: workflowApp.organizationId,
    createdById: workflowApp.createdById,
    createdAt: workflowApp.createdAt,
    updatedAt: workflowApp.updatedAt,
    createdBy: workflowApp.createdBy,
    // WorkflowApp-specific fields
    isPublic: workflowApp.isPublic,
    isUniversal: workflowApp.isUniversal,
    workflowId: workflowApp.draftWorkflowId, // draft workflow ID for editing
    workflows: workflowApp.workflows, // all versions
    workflowAppId: workflowApp.id,
    // Access settings
    shareToken: workflowApp.shareToken,
    webEnabled: workflowApp.webEnabled,
    apiEnabled: workflowApp.apiEnabled,
    accessMode: workflowApp.accessMode,
    icon: workflowApp.icon,
    config: workflowApp.config,
    rateLimit: workflowApp.rateLimit,
    totalRuns: workflowApp.totalRuns,
    lastRunAt: workflowApp.lastRunAt,
    hasPublishedVersion: !!workflowApp.workflowId,
  }
}

export class WorkflowService {
  private scheduledTriggerService = new ScheduledTriggerService()
  private pollingTriggerService = new PollingTriggerService()

  constructor(private db: Database) {}

  /**
   * Get all workflow apps for the organization (reads from org cache — zero DB queries)
   */
  async getAll(organizationId: string, filters: WorkflowFilter): Promise<WorkflowListResult> {
    logger.info('Fetching workflow apps from cache', { organizationId, filters })

    try {
      const cached = await getCachedWorkflowAppsList(organizationId, {
        search: filters.search,
        triggerType: filters.triggerType,
        enabled: filters.enabled,
        limit: filters.limit,
        offset: filters.offset,
        excludeIds: filters.excludeIds,
        includeIds: filters.includeIds,
      })

      const workflows = cached.workflows.map((app) => ({
        id: app.id,
        name: app.name,
        description: app.description,
        enabled: app.enabled,
        version: app.publishedWorkflow?.version || 1,
        triggerType: app.publishedWorkflow?.triggerType || app.draftTriggerType,
        organizationId: app.organizationId,
        createdAt: new Date(app.createdAt),
        updatedAt: new Date(app.updatedAt),
        createdBy: null,
        graph: null,
        variables: [],
        executions: [],
        _count: {
          executions: 0,
          workflows: 0,
        },
        isPublic: app.isPublic,
        isUniversal: app.isUniversal,
        workflowId: app.workflowId,
        icon: app.icon,
      }))

      return {
        workflows,
        total: cached.total,
        hasMore: cached.hasMore,
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
   * Fill in the name and icon a create-from-scratch caller left off.
   *
   * The name is read straight from the DB rather than the `workflowApps` org
   * cache: the cache's local window means a second create moments later could
   * still see the pre-insert list and mint the same number. A duplicate name is
   * only cosmetic (nothing is unique-constrained), but one narrow org-scoped
   * query on a user-initiated action is cheaper than explaining the collision.
   * System-owned apps (`ownerType IS NOT NULL`) are excluded — they are hidden
   * from every org-facing surface, so they must not push the counter along.
   */
  private async resolveWorkflowIdentity(
    organizationId: string,
    name: string | undefined,
    icon: { iconId: string; color: string } | undefined
  ): Promise<{ name: string; icon: { iconId: string; color: string } | undefined }> {
    if (name && icon) return { name, icon }

    const rows = await this.db
      .select({ name: schema.WorkflowApp.name })
      .from(schema.WorkflowApp)
      .where(
        and(
          eq(schema.WorkflowApp.organizationId, organizationId),
          isNull(schema.WorkflowApp.ownerType)
        )
      )

    return {
      name: name ?? nextUntitledWorkflowName(rows.map((row) => row.name)),
      icon: icon ?? pickDefaultWorkflowIcon(rows.length),
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
      entityDefinitionId,
      envVars,
      variables,
    } = input
    const finalTriggerType = triggerType || WorkflowTriggerType.MESSAGE_RECEIVED
    // Create-from-scratch posts neither name nor icon: the user goes straight to
    // the canvas and renames from the header later. Resolving both here rather
    // than at the router keeps every door (web, sidebar, empty state) identical.
    const { name: finalName, icon: finalIcon } = await this.resolveWorkflowIdentity(
      organizationId,
      name,
      icon
    )
    // This column is written by a dozen callers (builder save, template install,
    // seed, duplicate, the REST door) and read with strict equality by every
    // dispatcher. Canonicalize on the way in so the row only ever holds one
    // keyspace — see `canonicalizeEntityDefinitionId` for the tier-A gate.
    const finalEntityDefinitionId = entityDefinitionId
      ? await canonicalizeEntityDefinitionId(organizationId, entityDefinitionId)
      : entityDefinitionId

    logger.info('Creating workflow app', { organizationId, userId, name: finalName })

    // §8.2: personal channels are not automatable — reject at save time.
    await assertMailTriggerNotPersonal(this.db, organizationId, graph)

    try {
      // Create WorkflowApp with initial workflow version in a transaction
      const result = await this.db.transaction(async (tx: Transaction) => {
        // Create the WorkflowApp
        const [workflowApp] = await tx
          .insert(schema.WorkflowApp)
          .values({
            name: finalName,
            description,
            enabled,
            icon: finalIcon as any,
            organizationId,
            createdById: userId,
            updatedAt: new Date(),
          })
          .returning()

        // Create initial draft workflow version
        const [draftWorkflow] = await tx
          .insert(schema.Workflow)
          .values({
            name: `${finalName} (Draft)`,
            description,
            triggerType: finalTriggerType,
            entityDefinitionId: finalEntityDefinitionId,
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

      await onCacheEvent('workflow.created', { orgId: organizationId })

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
          entityDefinitionId: workflowData?.entityDefinitionId,
          organizationId: result.organizationId,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
          createdBy: result.createdBy,
          workflowId: result.draftWorkflowId, // Return draft workflow ID for editing
          workflowAppId: result.id, // Include workflowAppId for frontend use
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
   * Create a manual-trigger workflow pre-wired to a resource.
   *
   * Seeds the graph with a single resource-trigger node (operation: 'manual')
   * bound to the given entity definition, so the new workflow already targets
   * the right resource. Throws {@link NotFoundError} if the resource is unknown.
   */
  async createForResource(
    organizationId: string,
    userId: string,
    entityDefinitionId: string
  ): Promise<any> {
    const resources = await getCachedResources(organizationId)
    const resource = resources.find((r) => r.entityDefinitionId === entityDefinitionId)
    if (!resource) {
      throw new NotFoundError('Resource not found')
    }

    // Seed a single manual resource-trigger node bound to this resource.
    // Shape mirrors the builder's resource-trigger default data; the builder
    // re-enriches connection metadata on load.
    const nodeId = generateId()
    const label = resource.label
    const graph = {
      nodes: [
        {
          id: nodeId,
          type: 'standard',
          position: { x: 0, y: 0 },
          data: {
            id: nodeId,
            type: 'resource-trigger',
            selected: false,
            resourceType: resource.id,
            entityDefinitionId,
            operation: 'manual',
            title: `${label} Manual`,
            desc: `Triggered manually on a ${label.toLowerCase()}`,
            description: `Triggered manually on a ${label.toLowerCase()}`,
            icon: 'Play',
            variables: [],
            isValid: true,
            errors: [],
            disabled: false,
            outputVariables: [],
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    return this.create(organizationId, userId, {
      name: `${label} Trigger`,
      enabled: false,
      icon: { iconId: resource.icon, color: resource.color },
      triggerType: WorkflowTriggerType.MANUAL,
      entityDefinitionId,
      graph,
    })
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

      // §8.2: personal channels are not automatable — reject at save time.
      if (updateData.graph) {
        await assertMailTriggerNotPersonal(this.db, organizationId, updateData.graph)
      }

      // Separate access settings from workflow fields
      const {
        graph,
        envVars,
        variables,
        expectedGraphHash,
        preserveTurnSnapshot,
        webEnabled,
        apiEnabled,
        accessMode,
        icon,
        config,
        rateLimit,
        ...basicUpdateData
      } = updateData

      // Same canonicalization as `create` — one keyspace in the column.
      // `null` is the explicit clear (the builder posts it when the graph has
      // no resource trigger); `undefined` still means "leave alone".
      if (basicUpdateData.entityDefinitionId) {
        basicUpdateData.entityDefinitionId = await canonicalizeEntityDefinitionId(
          organizationId,
          basicUpdateData.entityDefinitionId
        )
      }

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
          // Only allow enabling web access for form trigger workflows
          if (webEnabled === true) {
            const workflowTriggerType = existingWorkflowApp.draftWorkflow?.triggerType
            if (workflowTriggerType !== 'form') {
              throw new Error('Only workflows with a Form trigger can have web access enabled')
            }
          }
          workflowAppUpdates.webEnabled = webEnabled
        }
        if (apiEnabled !== undefined) {
          // Only allow enabling API access for form trigger workflows
          if (apiEnabled === true) {
            const workflowTriggerType = existingWorkflowApp.draftWorkflow?.triggerType
            if (workflowTriggerType !== 'form') {
              throw new Error('Only workflows with a Form trigger can have API access enabled')
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
          let draftVersion = existingWorkflowApp.draftWorkflow.version

          // Compare-and-swap draft write: lock the draft row so a concurrent
          // save can't slip between read and write, then verify the stored
          // graph still hashes to what this caller loaded. Without this, two
          // editor tabs silently clobber each other — the stale tab's autosave
          // overwrites the other tab's changes. Callers that don't send
          // `expectedGraphHash` (template install, system paths) keep the
          // unconditional write.
          if (expectedGraphHash !== undefined) {
            const [lockedDraft] = await tx
              .select({ graph: schema.Workflow.graph, version: schema.Workflow.version })
              .from(schema.Workflow)
              .where(eq(schema.Workflow.id, existingWorkflowApp.draftWorkflow.id))
              .for('update')
              .limit(1)
            if (!lockedDraft) {
              throw new NotFoundError(`Draft for workflow "${existingWorkflowApp.name}" not found`)
            }
            const currentHash = hashWorkflowGraph(lockedDraft.graph)
            if (currentHash !== expectedGraphHash) {
              throw new ConflictError(
                `The draft of workflow "${existingWorkflowApp.name}" changed while you were editing. Reload the workflow to get the latest version — saving now would overwrite those changes.`
              )
            }
            draftVersion = lockedDraft.version
          }

          const workflowUpdates: any = {
            version: draftVersion + 1,
            updatedAt: new Date(),
          }

          if (basicUpdateData.name) workflowUpdates.name = `${basicUpdateData.name} (Draft)`
          if (basicUpdateData.description !== undefined)
            workflowUpdates.description = basicUpdateData.description
          if (basicUpdateData.triggerType) workflowUpdates.triggerType = basicUpdateData.triggerType
          if (basicUpdateData.entityDefinitionId !== undefined)
            workflowUpdates.entityDefinitionId = basicUpdateData.entityDefinitionId

          // App/webhook trigger-link columns (app trigger fields incl. the
          // save-time installation resolution, webhook-endpoint columns,
          // explicit clear on trigger switch) are derived by the catalog's
          // server-side composition — one implementation shared with future
          // server-side graph mutations. `{}` means leave the columns alone.
          Object.assign(
            workflowUpdates,
            await deriveTriggerLinkColumns(
              organizationId,
              basicUpdateData.triggerType,
              graph?.nodes as TriggerDerivationNode[] | undefined
            )
          )

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
              entityDefinitionId: basicUpdateData.entityDefinitionId,
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

          if (!draftWorkflow) {
            throw new Error(`Failed to create draft workflow for workflow app ${id}`)
          }

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

      // A non-Kopilot graph write invalidates the per-turn Undo snapshot (KB
      // parity: KBService clears on every manual save unless the agent path
      // bypasses). Only the graph-edit persist seam sets `preserveTurnSnapshot`.
      //
      // Gated on a SEMANTIC change, not on "a graph was posted". The editor
      // autosaves on load, and that save carries a fresh viewport plus
      // `selected: true` over byte-identical node content — so clearing on any
      // graph-bearing write destroyed the pending Undo offer about eight
      // seconds after it appeared, without the user touching anything
      // (plan 20 F5, reproduced in the browser 2026-08-19).
      //
      // Safe to relax only because `revertWorkflowTurn` now refuses when the
      // live draft no longer matches what the turn left behind: THAT is what
      // stops a stale Undo clobbering hand edits, and this clear no longer has
      // to be the blunt instrument standing in for it.
      //
      // Best-effort + lazy — the snapshot module pulls @auxx/redis, which must
      // not become an import-time dependency of every WorkflowService caller.
      if (graph !== undefined && !preserveTurnSnapshot) {
        const previousGraph = existingWorkflowApp.draftWorkflow?.graph
        // Both sides are DEHYDRATED first (plan 23 §3.2): the stored row may
        // still be in the pre-canonicalization fat shape while the posted graph
        // comes off a hydrated canvas, and the semantic projection does not
        // ignore everything hydration adds (`extent`, `data.id`, the read-time
        // defaults layer). Comparing the two shapes directly would call every
        // autosave an authored change and destroy the pending Undo offer.
        const authoredChange =
          previousGraph == null ||
          hashGraphSemantics(
            dehydrateGraph(previousGraph as GraphDocument, DEHYDRATION_OPTIONS)
          ) !==
            hashGraphSemantics(
              dehydrateGraph(graph as unknown as GraphDocument, DEHYDRATION_OPTIONS)
            )
        if (authoredChange) {
          try {
            const { clearWorkflowTurnSnapshot } = await import('./graph-edit/turn-snapshot')
            await clearWorkflowTurnSnapshot(id)
          } catch {
            // A leftover snapshot expires via TTL; never fail the save over it.
          }
        }
      }

      await onCacheEvent('workflow.updated', { orgId: organizationId })

      // Handle enable/disable scheduling logic
      if (updateData.enabled !== undefined && result) {
        try {
          if (updateData.enabled && result.publishedWorkflow) {
            // Re-schedule triggers when enabling
            await this.scheduledTriggerService.scheduleWorkflowTriggers(result)
            await this.pollingTriggerService.schedulePollingTrigger(result)
            logger.info('Re-scheduled triggers for enabled workflow', { workflowAppId: id })
          } else if (!updateData.enabled) {
            // Remove schedulers when disabling
            await this.scheduledTriggerService.unscheduleWorkflowTriggers(id)
            await this.pollingTriggerService.unschedulePollingTrigger(id)
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

        // Webhook-endpoint triggers need no provider-side reconciliation — the user owns
        // the endpoint URL (no registration). Enable/disable just flips the cache.

        await onCacheEvent('workflow.enabled', { orgId: organizationId })
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
          entityDefinitionId: workflowData?.entityDefinitionId,
          graph: workflowData?.graph,
          // New optimistic-concurrency token — the client chains its next
          // save's `expectedGraphHash` from this.
          graphHash: workflowData?.graph ? hashWorkflowGraph(workflowData.graph) : null,
          envVars: workflowData?.envVars,
          variables: workflowData?.variables || [],
          organizationId: result.organizationId,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
          createdBy: result.createdBy,
          workflowId: result.draftWorkflowId, // Return draft workflow ID for editing
          workflowAppId: result.id, // Include workflowAppId for frontend use
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
  private async cancelWorkflowJobs(workflowAppId: string, workflowRunIds: string[]): Promise<void> {
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

      // 2. Remove scheduled triggers and polling triggers (cron jobs)
      try {
        await this.scheduledTriggerService.unscheduleWorkflowTriggers(id)
        await this.pollingTriggerService.unschedulePollingTrigger(id)
        logger.info('Removed triggers for workflow deletion', { workflowAppId: id })
      } catch (schedulingError) {
        logger.error('Failed to remove triggers during workflow deletion', {
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
                eq(schema.Notification.targetType, 'APPROVAL'),
                inArray(
                  sql<string>`${schema.Notification.targetIds}->>'approvalRequestId'`,
                  approvalRequestIds
                )
              )
            )
        }

        // 5d. Delete all workflow runs (now safe - no FK blockers)
        await tx.delete(schema.WorkflowRun).where(eq(schema.WorkflowRun.workflowAppId, id))

        // 5e. Delete all workflow node executions
        await tx
          .delete(schema.WorkflowNodeExecution)
          .where(eq(schema.WorkflowNodeExecution.workflowAppId, id))

        // 5f. Clear WorkflowApp FK references to Workflow before deleting workflows
        await tx
          .update(schema.WorkflowApp)
          .set({ workflowId: null, draftWorkflowId: null })
          .where(eq(schema.WorkflowApp.id, id))

        // 5g. Delete all workflows (versions/drafts)
        await tx.delete(schema.Workflow).where(eq(schema.Workflow.workflowAppId, id))

        // 5h. Finally delete the WorkflowApp
        await tx.delete(schema.WorkflowApp).where(eq(schema.WorkflowApp.id, id))
      })

      logger.info('Workflow app deleted successfully', { workflowAppId: id, organizationId })

      await onCacheEvent('workflow.deleted', { orgId: organizationId })

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
              entityDefinitionId: sourceWorkflow.entityDefinitionId,
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

      await onCacheEvent('workflow.created', { orgId: organizationId })

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
