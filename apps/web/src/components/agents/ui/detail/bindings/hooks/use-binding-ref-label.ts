// apps/web/src/components/agents/ui/detail/bindings/hooks/use-binding-ref-label.ts
'use client'

import { resolveFieldRef } from '@auxx/lib/resources/client'
import {
  fieldRefToKey,
  isAppFieldRef,
  parseResourceFieldId,
  type ResourceFieldId,
  toFieldPath,
} from '@auxx/types/field'
import { useCallback, useMemo } from 'react'
import { useResourceStore } from '~/components/resources'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'

/** Capitalize an entity-type slug for display ("participant" → "Participant"). */
function capitalize(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1)
}

/** Map installationId → app slug from the cached installed-apps query. */
function useAppSlugMap(): Map<string, string> {
  const installed = api.apps.listInstalled.useQuery({}, { staleTime: ORG_STATIC_STALE_TIME })
  return useMemo(() => {
    const map = new Map<string, string>()
    for (const i of installed.data?.installations ?? []) {
      map.set(i.installationId, i.app.slug)
    }
    return map
  }, [installed.data])
}

/**
 * Resolve a stored binding var ref (a `VarRef` — single segment or FieldPath
 * array) to a human-readable label, entirely from the client resource store +
 * installed apps. Handles the three segment forms the resolver understands:
 *
 *   - `<entity>:self`              → "<Entity label> ID"
 *   - `<entity>:@app:<slug>:<key>` → the app field's label (shared `resolveFieldRef`)
 *   - `<entity>:<fieldId>`         → the field's label
 *
 * Paths join with " → ". Unresolvable segments fall back to the raw ref.
 */
export function useBindingRefLabel(): (ref: string | string[] | undefined) => string {
  const resourceMap = useResourceStore((s) => s.resourceMap)
  const fieldMap = useResourceStore((s) => s.fieldMap)
  const slugByInstallationId = useAppSlugMap()

  return useCallback(
    (ref) => {
      if (!ref) return ''
      const segments = Array.isArray(ref) ? ref : [ref]
      return segments
        .map((segment) => {
          const { entityDefinitionId, fieldId } = parseResourceFieldId(segment as ResourceFieldId)

          if (fieldId === 'self') {
            return `${resourceMap.get(entityDefinitionId)?.label ?? capitalize(entityDefinitionId)} ID`
          }

          if (isAppFieldRef(segment)) {
            const resource = resourceMap.get(entityDefinitionId)
            return (
              resolveFieldRef(
                resource?.fields ?? [],
                entityDefinitionId,
                segment,
                slugByInstallationId
              )?.field.label ?? segment
            )
          }

          return fieldMap[segment as ResourceFieldId]?.label ?? segment
        })
        .join(' → ')
    },
    [resourceMap, fieldMap, slugByInstallationId]
  )
}

/**
 * Resolve a stored binding var ref to a `FieldBadge`-compatible key
 * (`fieldRefToKey` format), rewriting `@app:` segments to the concrete
 * app-owned field's `resourceFieldId` so `useField`/`useFields` can look it
 * up. Returns null when the ref isn't a real field (`self` refs) or an app
 * segment can't be resolved — callers fall back to the plain label.
 */
export function useBindingRefBadgeKey(): (ref: string | string[] | undefined) => string | null {
  const resourceMap = useResourceStore((s) => s.resourceMap)
  const slugByInstallationId = useAppSlugMap()

  return useCallback(
    (ref) => {
      if (!ref) return null
      const segments = Array.isArray(ref) ? ref : [ref]
      const resolved: ResourceFieldId[] = []
      for (const segment of segments) {
        const { entityDefinitionId, fieldId } = parseResourceFieldId(segment as ResourceFieldId)
        if (fieldId === 'self') return null

        if (isAppFieldRef(segment)) {
          const resource = resourceMap.get(entityDefinitionId)
          const match = resolveFieldRef(
            resource?.fields ?? [],
            entityDefinitionId,
            segment,
            slugByInstallationId
          )
          if (!match) return null
          resolved.push(match.concreteRef)
          continue
        }

        resolved.push(segment as ResourceFieldId)
      }
      return fieldRefToKey(resolved.length === 1 ? resolved[0]! : toFieldPath(resolved))
    },
    [resourceMap, slugByInstallationId]
  )
}
