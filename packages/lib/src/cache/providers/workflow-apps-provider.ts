// packages/lib/src/cache/providers/workflow-apps-provider.ts

import type { Database } from '@auxx/database'
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

  /**
   * System-workflow marker (Sequences plan §3.4/§21.4). `null` for normal
   * user-authored workflows; set (e.g. `'sequence'`) for hidden workflows a
   * feature owns. `list()` below filters these out — every org-facing
   * surface must stay blind to system-owned apps.
   */
  ownerType: string | null
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
  // Webhook-endpoint trigger fields (for byWebhookEndpoint matching)
  triggerWebhookEndpointId: string | null
  triggerTopic: string | null

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
  ownerType: string | null
  publishedWorkflow: {
    id: string
    version: number
    triggerType: string | null
    entityDefinitionId: string | null
    triggerAppId: string | null
    triggerTriggerId: string | null
    triggerInstallationId: string | null
    triggerConnectionId: string | null
    triggerWebhookEndpointId: string | null
    triggerTopic: string | null
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
    ownerType: app.ownerType,
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
          triggerWebhookEndpointId: app.publishedWorkflow.triggerWebhookEndpointId,
          triggerTopic: app.publishedWorkflow.triggerTopic,
          graph: app.publishedWorkflow.graph,
          envVars: app.publishedWorkflow.envVars,
          variables: app.publishedWorkflow.variables,
          createdById: app.publishedWorkflow.createdById,
        }
      : null,
  }
}

/** Computes all workflow apps with published workflows for an organization */
// `satisfies` rather than an annotation: `CacheProvider.createAccessor` is
// optional and returns `any`, so annotating would erase both the fact that this
// provider HAS an accessor and the accessor's real shape (which the test and
// `WorkflowAppsAccessor` both depend on).
export const workflowAppsProvider = {
  async compute(orgId: string, db: Database) {
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

      /** Find enabled app by ID — excludes system-owned apps (Sequences plan §3.4). */
      async byAppId(workflowAppId: string): Promise<CachedWorkflowApp | null> {
        const data = await dataFn()
        return data.find((app) => app.id === workflowAppId && app.enabled && !app.ownerType) ?? null
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

      /** Find enabled apps matching a webhook-endpoint trigger `(endpointId, topic)` */
      async byWebhookEndpoint(params: {
        endpointId: string
        topic: string
      }): Promise<CachedWorkflowApp[]> {
        const data = await dataFn()
        return data.filter(
          (app) =>
            app.enabled &&
            app.publishedWorkflow?.triggerType === 'webhook-endpoint' &&
            app.publishedWorkflow?.triggerWebhookEndpointId === params.endpointId &&
            app.publishedWorkflow?.triggerTopic === params.topic
        )
      },

      /**
       * List workflow apps with filtering, sorting, and pagination for the list view.
       * Always excludes system-owned apps (Sequences plan §3.4) — the list surface is
       * only for org-authored workflows.
       *
       * `excludeIds` is the per-member access exclusion (plan 30): the ids the
       * caller may not view, computed from their `CapabilitySet` and applied
       * HERE, alongside every other predicate and **before** `total`/`hasMore`
       * and the slice. Filtering the returned page instead would make `total`
       * describe the unfiltered set and could hand back an empty page with
       * `hasMore: true`.
       *
       * `includeIds` is its inverse (plan 25 §2): the ONLY ids the caller may
       * view, used when they compose `workflows: None` yet hold explicit
       * instance grants. `CapabilitySet.instanceListScope` produces one or the
       * other, never both; an empty array on either is treated as "not set" so
       * an accidental empty allow-list can never silently blank the list.
       */
      async list(filters?: {
        search?: string
        triggerType?: string
        enabled?: boolean
        limit?: number
        offset?: number
        excludeIds?: readonly string[]
        includeIds?: readonly string[]
      }): Promise<{ workflows: CachedWorkflowApp[]; total: number; hasMore: boolean }> {
        let data = (await dataFn()).filter((app) => !app.ownerType)

        if (filters?.includeIds?.length) {
          const included = new Set(filters.includeIds)
          data = data.filter((app) => included.has(app.id))
        }
        if (filters?.excludeIds?.length) {
          const excluded = new Set(filters.excludeIds)
          data = data.filter((app) => !excluded.has(app.id))
        }
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
} satisfies CacheProvider<CachedWorkflowApp[]>
