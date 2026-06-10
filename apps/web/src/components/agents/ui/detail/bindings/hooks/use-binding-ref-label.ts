// apps/web/src/components/agents/ui/detail/bindings/hooks/use-binding-ref-label.ts
'use client'

import type { Resource, ResourceField } from '@auxx/lib/resources/client'
import {
  fieldRefToKey,
  parseResourceFieldId,
  type ResourceFieldId,
  toFieldPath,
} from '@auxx/types/field'
import { useCallback, useMemo } from 'react'
import { useResourceStore } from '~/components/resources'
import { api } from '~/trpc/react'

/** Sentinel marking a connection-late-bound app field segment (`@app:<slug>:<key>`). */
const APP_SEGMENT_PREFIX = '@app:'

/** Capitalize an entity-type slug for display ("participant" → "Participant"). */
function capitalize(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1)
}

/** Parse an `@app:<slug>:<key>` field part. Returns null for non-app parts. */
function parseAppFieldPart(fieldId: string): { slug: string; key: string } | null {
  if (!fieldId.startsWith(APP_SEGMENT_PREFIX)) return null
  const rest = fieldId.slice(APP_SEGMENT_PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep <= 0) return null
  return { slug: rest.slice(0, sep), key: rest.slice(sep + 1) }
}

/** Find the concrete app-owned field an `@app:<slug>:<key>` segment names. */
function findAppField(
  resource: Resource | undefined,
  slug: string,
  key: string,
  slugByInstallationId: Map<string, string>
): ResourceField | undefined {
  return resource?.fields.find(
    (f) =>
      f.appFieldKey === key &&
      f.appInstallationId &&
      slugByInstallationId.get(f.appInstallationId) === slug
  )
}

/** Map installationId → app slug from the cached installed-apps query. */
function useAppSlugMap(): Map<string, string> {
  const installed = api.apps.listInstalled.useQuery({})
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
 *   - `<entity>:@app:<slug>:<key>` → the app field's label
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
          const resource = resourceMap.get(entityDefinitionId)

          if (fieldId === 'self') {
            return `${resource?.label ?? capitalize(entityDefinitionId)} ID`
          }

          const app = parseAppFieldPart(fieldId)
          if (app) {
            const field = findAppField(resource, app.slug, app.key, slugByInstallationId)
            return field?.label ?? segment
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

        const app = parseAppFieldPart(fieldId)
        if (app) {
          const field = findAppField(
            resourceMap.get(entityDefinitionId),
            app.slug,
            app.key,
            slugByInstallationId
          )
          if (!field?.resourceFieldId) return null
          resolved.push(field.resourceFieldId)
          continue
        }

        resolved.push(segment as ResourceFieldId)
      }
      return fieldRefToKey(resolved.length === 1 ? resolved[0]! : toFieldPath(resolved))
    },
    [resourceMap, slugByInstallationId]
  )
}
