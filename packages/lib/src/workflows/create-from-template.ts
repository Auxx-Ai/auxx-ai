// packages/lib/src/workflows/create-from-template.ts

import { createScopedLogger } from '@auxx/logger'
import { deriveTriggerColumns } from '../workflow-engine/catalog/derive-trigger'
import { dehydrateGraph, type GraphDocument } from '../workflow-engine/catalog/graph-hydration'
import { DEHYDRATION_OPTIONS } from '../workflow-engine/catalog/hydration-policy'
import { TemplateGraphTransformer } from './template-graph-transformer'
import {
  checkEntityReadiness,
  type RequiredEntity,
  resolveAllAppSlugs,
  resolveEntityRefsInGraph,
} from './template-resolution'
import type { WorkflowCreateInput, WorkflowTriggerType } from './types'

const logger = createScopedLogger('workflow-template-install')

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

  // Report classifier edges that route nowhere. Warn rather than throw: a
  // template with a mis-wired branch still installs to a canvas the user can
  // fix, and refusing the install would be a new failure mode on a door that
  // has never had one. All 12 bundled templates are clean today, so a hit here
  // means an admin-authored DB template.
  const classifierErrors = transformer.validateClassifierEdges(transformed.graph as any)
  if (classifierErrors.length > 0) {
    logger.warn('Template has classifier edges that route to no category', {
      organizationId,
      userId,
      errors: classifierErrors,
    })
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

  // THE THIRD WRITE SEAM (plan 23 §3). `TemplateGraphTransformer` rewrites ids
  // and strips `$comment` from `node.data`, but never touched the top level —
  // so every install seeded a fresh workflow with derived keys already baked
  // in (`_targetBranches` in 26 bundled-template nodes, `data.id`,
  // `node.type`). This is the door, not the transformer: both install paths
  // (the create-from-template router and graph-edit's `apply_template`) go
  // through here, and it runs AFTER every rewrite pass so nothing downstream
  // re-fattens the document.
  //
  // Deliberately after `deriveTriggerColumns` above: the derivation reads the
  // fully-resolved graph, and dehydration is a projection of the SAME content.
  const graph = dehydrateGraph(transformed.graph as unknown as GraphDocument, DEHYDRATION_OPTIONS)

  return {
    graph: graph as unknown as TemplateWorkflowData['graph'],
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
