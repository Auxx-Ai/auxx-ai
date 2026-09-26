// packages/lib/src/sidebar-layout/resource-nav.ts

import type { Resource } from '../resources/registry/types'
import type { ResourceNavEntry } from './types'

/** Project the org's resources to what the sidebar renders: EntityDefinition-backed defs a sidebar can hold. */
export function toResourceNav(resources: readonly Resource[]): ResourceNavEntry[] {
  const out: ResourceNavEntry[] = []
  for (const resource of resources) {
    if (resource.type !== 'custom' || resource.sidebar === 'never') continue
    out.push({
      id: resource.entityDefinitionId,
      apiSlug: resource.apiSlug,
      label: resource.label,
      plural: resource.plural,
      icon: resource.icon,
      color: resource.color,
      entityType: resource.entityType ?? null,
      dataConnectorId: resource.dataConnectorId ?? null,
      sidebar: resource.sidebar,
      featureKeys: resource.featureKeys ?? null,
    })
  }
  return out
}
