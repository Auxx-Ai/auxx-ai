// apps/web/src/components/data-connectors/hooks/use-connector-resources.ts
'use client'

// Connector-aware resource hooks (05e — connector-target-resources-splice). The mapping
// editor resolves a mapping's target def + fields PROJECTION-FIRST: a lazily-provisioned
// owned def doesn't exist in the global resource store yet, so it's projected from the
// mapping's persisted `targetSpec` + `provision` specs; a mapping with a real def falls
// back to the global store unchanged. Both global hooks are called unconditionally
// (rules-of-hooks); the global hook is a cheap selector when the projection wins.
// See plans/data-connectors/v5/connector-target-resources-splice-plan.md §4.2.

import type { Resource, ResourceField } from '@auxx/lib/resources/client'
import { useResourceFields, useResourceProperty } from '~/components/resources'
import {
  projectPotentialResource,
  projectProvisionFields,
} from '../lib/connector-target-projection'
import type { DraftMapping } from '../stores/connector-draft-store'

/** The subset of a mapping the connector hooks read (so call-sites can pass a child too). */
type MappingLike = Pick<DraftMapping, 'entityDefinitionId' | 'targetSpec' | 'fieldMappings'>

/**
 * Projection-first resource property. Returns the global-store value for a real def,
 * else the POTENTIAL owned def projected from `targetSpec` (so `label`/`icon` render
 * before the def exists). Same return shape as {@link useResourceProperty}.
 */
export function useConnectorResourceProperty<K extends keyof Resource>(
  mapping: MappingLike | null | undefined,
  properties: K[]
): Pick<Resource, K> | undefined {
  const global = useResourceProperty(mapping?.entityDefinitionId, properties)
  if (mapping?.entityDefinitionId) return global
  const potential = mapping ? projectPotentialResource(mapping) : null
  if (!potential) return global
  const picked = {} as Pick<Resource, K>
  for (const key of properties) {
    picked[key] = (potential as unknown as Resource)[key]
  }
  return picked
}

/**
 * Projection-first resource fields. Returns the global-store fields for a real def, else
 * the synthetic provision fields (the columns the lazy owned def will create). Mirrors
 * the `{ fields }` shape of {@link useResourceFields} for a 1:1 swap.
 */
export function useConnectorResourceFields(mapping: MappingLike | null | undefined): {
  fields: ResourceField[]
} {
  const global = useResourceFields(mapping?.entityDefinitionId)
  if (mapping?.entityDefinitionId) return { fields: global.fields }
  return { fields: mapping ? projectProvisionFields(mapping) : [] }
}
