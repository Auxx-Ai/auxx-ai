// apps/web/src/components/resources/hooks/use-resolve-entity-id.ts

import { useResourceStore } from '../store/resource-store'

/**
 * Resolve an entity type/apiSlug/UUID to the actual entityDefinitionId UUID.
 * Returns null if not found or resources not yet loaded.
 *
 * @param entityTypeOrSlugOrId - Can be entityType ('tag'), apiSlug ('tags'), or UUID
 * @returns The resolved entityDefinitionId UUID, or null if not found
 *
 * @example
 * ```tsx
 * const tagEntityDefId = useResolveEntityDefinitionId('tag')
 * // Returns the UUID like "abc123-def456"
 * ```
 *
 * @example
 * ```tsx
 * // All of these return the same UUID:
 * useResolveEntityDefinitionId('tag')           // by entityType
 * useResolveEntityDefinitionId('tags')          // by apiSlug
 * useResolveEntityDefinitionId('abc123-def456') // by id (passthrough)
 * ```
 */
export function useResolveEntityDefinitionId(
  entityTypeOrSlugOrId: string | undefined
): string | null {
  const getResourceById = useResourceStore((s) => s.getResourceById)

  if (!entityTypeOrSlugOrId) return null

  const resource = getResourceById(entityTypeOrSlugOrId)
  return resource?.id ?? null
}
