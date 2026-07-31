// packages/lib/src/workflows/create-from-template.ts

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

  return {
    graph: transformed.graph,
    triggerType: transformed.triggerType as WorkflowTriggerType | undefined,
    entityDefinitionId: transformed.entityDefinitionId,
    envVars: transformed.envVars,
    variables: transformed.variables,
    // Use the template icon as a fallback when the user didn't choose one
    ...(!hasUserIcon && template.icon ? { icon: template.icon } : {}),
  }
}
