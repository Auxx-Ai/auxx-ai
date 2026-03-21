// packages/lib/src/cache/workflow-app-queries.ts

import type { CachedWorkflowApp } from './providers/workflow-apps-provider'
import { getOrgCache } from './singletons'

/**
 * Get a single enabled workflow app by ID from cache.
 * Returns null if not found or not enabled.
 */
export async function getCachedWorkflowApp(
  workflowAppId: string,
  organizationId: string
): Promise<CachedWorkflowApp | null> {
  return getOrgCache().from(organizationId, 'workflowApps').byAppId(workflowAppId)
}

/**
 * Get all enabled workflow apps matching trigger criteria from cache.
 */
export async function getCachedWorkflowAppsByTrigger(params: {
  organizationId: string
  triggerType: string
  entityDefinitionId?: string
}): Promise<CachedWorkflowApp[]> {
  return getOrgCache()
    .from(params.organizationId, 'workflowApps')
    .byTrigger(params.triggerType, params.entityDefinitionId)
}

/**
 * Get all enabled workflow apps matching app trigger fields from cache.
 */
export async function getCachedWorkflowAppsByAppTrigger(params: {
  organizationId: string
  appId: string
  triggerId: string
  installationId: string
  connectionId?: string
}): Promise<CachedWorkflowApp[]> {
  return getOrgCache().from(params.organizationId, 'workflowApps').byAppTrigger({
    appId: params.appId,
    triggerId: params.triggerId,
    installationId: params.installationId,
    connectionId: params.connectionId,
  })
}

/**
 * Get workflow apps list with filtering and pagination from cache.
 * Used by the workflow list view — pure cache read, zero DB queries.
 */
export async function getCachedWorkflowAppsList(
  organizationId: string,
  filters?: {
    search?: string
    triggerType?: string
    enabled?: boolean
    limit?: number
    offset?: number
  }
) {
  return getOrgCache().from(organizationId, 'workflowApps').list(filters)
}
