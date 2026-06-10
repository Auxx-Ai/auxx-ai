// apps/web/src/components/agents/ui/detail/bindings/hooks/use-binding-ref-label.ts
'use client'

import { parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import { useCallback, useMemo } from 'react'
import { useResourceStore } from '~/components/resources'
import { api } from '~/trpc/react'

/** Sentinel marking a connection-late-bound app field segment (`@app:<slug>:<key>`). */
const APP_SEGMENT_PREFIX = '@app:'

/** Capitalize an entity-type slug for display ("participant" → "Participant"). */
function capitalize(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1)
}

/**
 * Resolve a stored binding var ref (a `VarRef` — single segment or FieldPath
 * array) to a human-readable label, entirely from the client resource store +
 * installed apps. Handles the three segment forms the resolver understands:
 *
 *   - `<entity>:self`              → "<Entity label> ID"
 *   - `<entity>:@app:<slug>:<key>` → the app field's label
 *   - `<entity>:<fieldId>`         → the field's label
 *
 * Paths join with " → ". Unresolvable segments fall back to the raw ref.
 */
export function useBindingRefLabel(): (ref: string | string[] | undefined) => string {
  const resourceMap = useResourceStore((s) => s.resourceMap)
  const fieldMap = useResourceStore((s) => s.fieldMap)
  const installed = api.apps.listInstalled.useQuery({})

  const slugByInstallationId = useMemo(() => {
    const map = new Map<string, string>()
    for (const i of installed.data?.installations ?? []) {
      map.set(i.installationId, i.app.slug)
    }
    return map
  }, [installed.data])

  return useCallback(
    (ref) => {
      if (!ref) return ''
      const segments = Array.isArray(ref) ? ref : [ref]
      return segments
        .map((segment) => {
          const { entityDefinitionId, fieldId } = parseResourceFieldId(segment as ResourceFieldId)
          const resource = resourceMap.get(entityDefinitionId)

          if (fieldId === 'self') {
            return `${resource?.label ?? capitalize(entityDefinitionId)} ID`
          }

          if (fieldId.startsWith(APP_SEGMENT_PREFIX)) {
            const rest = fieldId.slice(APP_SEGMENT_PREFIX.length)
            const sep = rest.indexOf(':')
            if (sep <= 0) return segment
            const slug = rest.slice(0, sep)
            const key = rest.slice(sep + 1)
            const field = resource?.fields.find(
              (f) =>
                f.appFieldKey === key &&
                f.appInstallationId &&
                slugByInstallationId.get(f.appInstallationId) === slug
            )
            return field?.label ?? segment
          }

          return fieldMap[segment as ResourceFieldId]?.label ?? segment
        })
        .join(' → ')
    },
    [resourceMap, fieldMap, slugByInstallationId]
  )
}
