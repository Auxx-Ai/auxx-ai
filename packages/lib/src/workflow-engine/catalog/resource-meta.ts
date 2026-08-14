// packages/lib/src/workflow-engine/catalog/resource-meta.ts

import type { Resource } from '../../resources/client'
import type { ResourceMeta, VariableGeneratorOptions } from '../../resources/variable-generators'
import type { OutputContext } from './output-context'

/**
 * Shared adapter between an `OutputContext` and the
 * `packages/lib/src/resources/variable-generators` generator functions.
 *
 * Extracted from three verbatim copies in `catalog/nodes/find.ts`, `crud.ts`
 * (`getCrudNodeOutputVariables`'s non-thread tail), and `resource-trigger.ts`
 * (`getResourceTriggerOutputVariables`): the `new Map(allResources.map((r) =>
 * [r.id, r]))` dedupe and the `{ id: resource.entityDefinitionId ??
 * resource.id, label, plural }` meta construction. Each of those files kept
 * its own local `ResourceWithFields` type as a narrower cast of
 * `context.resource` — that cast is unnecessary: `OutputContext.resource` is
 * already typed as the full `Resource` union (`id`/`label`/`plural`/`fields`/
 * `entityDefinitionId` all present on both `SystemResource` and
 * `CustomResource`), so this helper reads it directly.
 *
 * Returns `undefined` when the node has no resource selected yet — callers
 * short-circuit on that exactly as each of the three duplicated adapters did
 * before this extraction.
 */
export function resolveResourceGeneratorInputs(context: OutputContext):
  | {
      resource: Resource
      resourceMeta: ResourceMeta
      resourcesMap: VariableGeneratorOptions['resourcesMap']
    }
  | undefined {
  const resource = context.resource
  if (!resource) {
    return undefined
  }

  const resourcesMap = new Map(context.allResources.map((r) => [r.id, r]))

  return {
    resource,
    resourceMeta: {
      id: resource.entityDefinitionId ?? resource.id,
      label: resource.label,
      plural: resource.plural,
    },
    resourcesMap,
  }
}
