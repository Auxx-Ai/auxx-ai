// packages/lib/src/cache/providers/workflow-apps-provider.ts

import { ArrayAccessor } from '../accessors'
import type { CacheProvider } from '../org-cache-provider'

/** Cached workflow app shape — execution hot paths + display fields for list view */
export interface CachedWorkflowApp {
  id: string
  organizationId: string
  enabled: boolean
  workflowId: string | null

  // Display fields
  name: string
  description: string | null
  icon: any | null
  updatedAt: string // ISO string
  createdAt: string // ISO string
  isPublic: boolean
  isUniversal: boolean

  // Draft trigger type (for unpublished workflows)
  draftTriggerType: string | null

  publishedWorkflow: CachedPublishedWorkflow | null
}

/** Cached published workflow — execution-critical fields only */
export interface CachedPublishedWorkflow {
  id: string
  version: number
  triggerType: string | null
  entityDefinitionId: string | null

  // App trigger fields (for dispatchAppTrigger matching)
  triggerAppId: string | null
  triggerTriggerId: string | null
  triggerInstallationId: string | null
  triggerConnectionId: string | null

  // Execution data
  graph: any
  envVars: any | null
  variables: any | null
  createdById: string | null
}

/** Narrow a DB WorkflowApp + publishedWorkflow + draftWorkflow to the serializable cache shape */
function dehydrateWorkflowApp(app: {
  id: string
  organizationId: string
  enabled: boolean
  workflowId: string | null
  name: string
  description: string | null
  icon: unknown
  updatedAt: Date
  createdAt: Date
  isPublic: boolean
  isUniversal: boolean
  publishedWorkflow: {
    id: string
    version: number
    triggerType: string | null
    entityDefinitionId: string | null
    triggerAppId: string | null
    triggerTriggerId: string | null
    triggerInstallationId: string | null
    triggerConnectionId: string | null
    graph: unknown
    envVars: unknown
    variables: unknown
    createdById: string | null
  } | null
  draftWorkflow: {
    triggerType: string | null
  } | null
}): CachedWorkflowApp {
  return {
    id: app.id,
    organizationId: app.organizationId,
    enabled: app.enabled,
    workflowId: app.workflowId,
    name: app.name,
    description: app.description,
    icon: app.icon,
    updatedAt: app.updatedAt.toISOString(),
    createdAt: app.createdAt.toISOString(),
    isPublic: app.isPublic,
    isUniversal: app.isUniversal,
    draftTriggerType: app.draftWorkflow?.triggerType ?? null,
    publishedWorkflow: app.publishedWorkflow
      ? {
          id: app.publishedWorkflow.id,
          version: app.publishedWorkflow.version,
          triggerType: app.publishedWorkflow.triggerType,
          entityDefinitionId: app.publishedWorkflow.entityDefinitionId,
          triggerAppId: app.publishedWorkflow.triggerAppId,
          triggerTriggerId: app.publishedWorkflow.triggerTriggerId,
          triggerInstallationId: app.publishedWorkflow.triggerInstallationId,
          triggerConnectionId: app.publishedWorkflow.triggerConnectionId,
          graph: app.publishedWorkflow.graph,
          envVars: app.publishedWorkflow.envVars,
          variables: app.publishedWorkflow.variables,
          createdById: app.publishedWorkflow.createdById,
        }
      : null,
  }
}

/** Computes all workflow apps with published workflows for an organization */
export const workflowAppsProvider: CacheProvider<CachedWorkflowApp[]> = {
  async compute(orgId, db) {
    const apps = await db.query.WorkflowApp.findMany({
      where: (t, { eq }) => eq(t.organizationId, orgId),
      with: {
        publishedWorkflow: true,
        draftWorkflow: {
          columns: { triggerType: true },
        },
      },
    })
    return apps.map(dehydrateWorkflowApp)
  },

  createAccessor(dataFn: () => Promise<CachedWorkflowApp[]>) {
    const accessor = new ArrayAccessor(dataFn)

    return Object.assign(accessor, {
      /** Find enabled apps matching trigger criteria */
      async byTrigger(
        triggerType: string,
        entityDefinitionId?: string
      ): Promise<CachedWorkflowApp[]> {
        const data = await dataFn()
        return data.filter(
          (app) =>
            app.enabled &&
            app.publishedWorkflow?.triggerType === triggerType &&
            (!entityDefinitionId || app.publishedWorkflow.entityDefinitionId === entityDefinitionId)
        )
      },

      /** Find enabled app by ID */
      async byAppId(workflowAppId: string): Promise<CachedWorkflowApp | null> {
        const data = await dataFn()
        return data.find((app) => app.id === workflowAppId && app.enabled) ?? null
      },

      /** Find enabled apps matching app trigger fields */
      async byAppTrigger(params: {
        appId: string
        triggerId: string
        installationId: string
        connectionId?: string
      }): Promise<CachedWorkflowApp[]> {
        const data = await dataFn()
        return data.filter(
          (app) =>
            app.enabled &&
            app.publishedWorkflow?.triggerAppId === params.appId &&
            app.publishedWorkflow?.triggerTriggerId === params.triggerId &&
            app.publishedWorkflow?.triggerInstallationId === params.installationId &&
            (!params.connectionId ||
              app.publishedWorkflow?.triggerConnectionId === params.connectionId)
        )
      },

      /** List workflow apps with filtering, sorting, and pagination for the list view */
      async list(filters?: {
        search?: string
        triggerType?: string
        enabled?: boolean
        limit?: number
        offset?: number
      }): Promise<{ workflows: CachedWorkflowApp[]; total: number; hasMore: boolean }> {
        let data = await dataFn()

        if (filters?.enabled !== undefined) {
          data = data.filter((app) => app.enabled === filters.enabled)
        }
        if (filters?.triggerType) {
          data = data.filter(
            (app) =>
              (app.publishedWorkflow?.triggerType || app.draftTriggerType) === filters.triggerType
          )
        }
        if (filters?.search) {
          const q = filters.search.toLowerCase()
          data = data.filter(
            (app) =>
              app.name.toLowerCase().includes(q) || app.description?.toLowerCase().includes(q)
          )
        }

        // Sort: enabled first, then by updatedAt desc
        data.sort((a, b) => {
          if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        })

        const total = data.length
        const offset = filters?.offset ?? 0
        const limit = filters?.limit ?? 50
        const sliced = data.slice(offset, offset + limit)

        return {
          workflows: sliced,
          total,
          hasMore: offset + sliced.length < total,
        }
      },
    })
  },
}
