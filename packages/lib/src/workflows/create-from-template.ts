// packages/lib/src/workflows/create-from-template.ts

import { deriveTriggerColumns } from '../workflow-engine/catalog/derive-trigger'
import { TemplateGraphTransformer } from './template-graph-transformer'
import {
  checkEntityReadiness,
  type RequiredEntity,
  resolveAllAppSlugs,
  resolveEntityRefsInGraph,
} from './template-resolution'
import type { WorkflowCreateInput, WorkflowTriggerType } from './types'

/** Minimal shape of a resolved workflow template consumed by the builder. */
export interface TemplateForCreate {
  graph: unknown
  triggerType?: string | null
  entityDefinitionId?: string | null
  envVars?: unknown
  variables?: unknown
  icon?: WorkflowCreateInput['icon']
  requiredApps?: Array<{ appSlug: string }>
  requiredEntities?: RequiredEntity[]
}

/** Fields produced from a template that are spread into the create input. */
export type TemplateWorkflowData = Pick<
  WorkflowCreateInput,
  'graph' | 'triggerType' | 'entityDefinitionId' | 'envVars' | 'variables' | 'icon'
>

/**
 * Transform a resolved template into workflow create data: clones the graph with
 * fresh ids, resolves app-slug and entity/field references against the org's
 * caches, and carries over the template icon when the user didn't pick one.
 */
export async function buildTemplateWorkflowData(
  organizationId: string,
  userId: string,
  template: TemplateForCreate,
  hasUserIcon: boolean
): Promise<TemplateWorkflowData> {
  const transformer = new TemplateGraphTransformer()
  const transformed = transformer.transformTemplate(
    {
      graph: template.graph as any,
      triggerType: template.triggerType ?? undefined,
      entityDefinitionId: template.entityDefinitionId ?? undefined,
      // Template rows store these as jsonb, so guard the shape rather than trust it.
      envVars: Array.isArray(template.envVars) ? template.envVars : undefined,
      variables: Array.isArray(template.variables) ? template.variables : undefined,
    },
    { userId }
  )

  // Resolve app slugs (@slug:blockId → realAppId:blockId) using caches
  if (template.requiredApps?.length) {
    const resolvedApps = await resolveAllAppSlugs(
      organizationId,
      template.requiredApps.map((a) => a.appSlug)
    )
    transformer.resolveAppNodes(transformed.graph, resolvedApps)
  }

  // Resolve entity refs (@entity:slug, @field:X) using org caches.
  // Only resolve what's available — unresolved refs stay as-is for the user to fix.
  if (template.requiredEntities?.length) {
    const readiness = await checkEntityReadiness(organizationId, template.requiredEntities)
    resolveEntityRefsInGraph(
      transformed.graph,
      template.requiredEntities,
      readiness.entityIdMap,
      readiness.fieldIdMap
    )
  }

  // Derive the entity scoping from the RESOLVED graph rather than carrying the
  // template's own value across orgs: `resolveEntityRefsInGraph` has just
  // rewritten the graph's entity refs into this org's ids, so anything the
  // template row held is either an authoring-org id or stale. `triggerType`
  // still falls back — templates may use trigger types the catalog cannot see
  // yet (webhook, app triggers), for which the derivation returns nothing.
  //
  // NOTE: `resolveEntityRefsInGraph` currently only rewrites `crud`/`find`
  // nodes, so a template carrying a `resource-trigger` would still install with
  // an unresolved ref — no template does today (see 05-resource-model.md §4a.5).
  const derived = deriveTriggerColumns(
    ((transformed.graph as { nodes?: unknown[] }).nodes ?? []) as Parameters<
      typeof deriveTriggerColumns
    >[0]
  )

  return {
    graph: transformed.graph,
    triggerType: (derived.triggerType ?? transformed.triggerType) as
      | WorkflowTriggerType
      | undefined,
    entityDefinitionId: derived.entityDefinitionId?.startsWith('@')
      ? undefined
      : derived.entityDefinitionId,
    envVars: transformed.envVars,
    variables: transformed.variables,
    // Use the template icon as a fallback when the user didn't choose one
    ...(!hasUserIcon && template.icon ? { icon: template.icon } : {}),
  }
}
