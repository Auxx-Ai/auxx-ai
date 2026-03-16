// packages/lib/src/cache/providers/workflow-apps-provider.ts

import { ArrayAccessor } from '../accessors'
import type { CacheProvider } from '../org-cache-provider'

/** Cached workflow app shape — only fields needed by trigger matching + execution hot paths */
export interface CachedWorkflowApp {
  id: string
  organizationId: string
  enabled: boolean
  workflowId: string | null

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

/** Narrow a DB WorkflowApp + publishedWorkflow to the serializable cache shape */
function dehydrateWorkflowApp(app: {
  id: string
  organizationId: string
  enabled: boolean
  workflowId: string | null
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
}): CachedWorkflowApp {
  return {
    id: app.id,
    organizationId: app.organizationId,
    enabled: app.enabled,
    workflowId: app.workflowId,
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
    })
  },
}
