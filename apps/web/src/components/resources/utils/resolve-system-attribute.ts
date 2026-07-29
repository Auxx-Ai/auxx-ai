// apps/web/src/components/resources/utils/resolve-system-attribute.ts

'use client'

import { getDefinitionId, type RecordId } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { useResourceStore } from '../store/resource-store'
import { getNormalizedDefinitionId } from './normalize-record-id'

/**
 * The slice of resource state a systemAttribute lookup needs. Hooks select
 * these three so they stay reactive; imperative callers read them off
 * `useResourceStore.getState()`.
 */
export interface SystemAttributeMaps {
  systemAttributeMap: Record<string, ResourceFieldId>
  systemAttributeByDef: Record<string, ResourceFieldId>
  ambiguousSystemAttributes: Set<string>
}

const warned = new Set<string>()

/**
 * Warn once per attribute, in dev only. An ambiguous bare lookup is a latent
 * wrong-field read or write; the console line is what makes it findable before
 * it becomes a data bug.
 */
function warnAmbiguous(attr: string): void {
  if (process.env.NODE_ENV === 'production' || warned.has(attr)) return
  warned.add(attr)
  console.warn(
    `[systemAttribute] "${attr}" is owned by more than one entity definition and was resolved ` +
      'without one. Pass an entityDefinitionId (or a RecordId) to resolve it unambiguously.'
  )
}

/**
 * Resolve a systemAttribute to a ResourceFieldId, preferring the definition it
 * belongs to.
 *
 * systemAttributes are only unique by CONVENTION — they encode their own
 * definition as a prefix (`ticket_status`, `tag_color`). Cloned field sets
 * break that convention: `personal_inbox` carries `inbox_name` verbatim, so a
 * bare lookup can return the other definition's field. Resolution order:
 *
 * 1. `${definitionId}:${attr}` — exact, always correct when a definition is known.
 * 2. bare `attr` — only when no definition was supplied, or the definition has
 *    no such attribute AND the attribute is unambiguous.
 *
 * A bare fallback for an AMBIGUOUS attribute is deliberately refused: returning
 * the other definition's field is how a wrong value gets written.
 */
export function resolveSystemAttributeRef(
  maps: SystemAttributeMaps,
  attr: string,
  entityDefinitionId?: string | null
): ResourceFieldId | undefined {
  if (entityDefinitionId) {
    const canonical = getNormalizedDefinitionId(entityDefinitionId)
    const scoped =
      maps.systemAttributeByDef[`${canonical}:${attr}`] ??
      maps.systemAttributeByDef[`${entityDefinitionId}:${attr}`]
    if (scoped) return scoped
    // Definition known but attribute absent from it. Falling back to the bare
    // map here would hand back a DIFFERENT definition's field — exactly the bug
    // this resolver exists to prevent.
    if (maps.ambiguousSystemAttributes.has(attr)) return undefined
  } else if (maps.ambiguousSystemAttributes.has(attr)) {
    warnAmbiguous(attr)
  }
  return maps.systemAttributeMap[attr]
}

/** {@link resolveSystemAttributeRef} against a RecordId's definition. */
export function resolveSystemAttributeForRecord(
  maps: SystemAttributeMaps,
  attr: string,
  recordId: RecordId | null | undefined
): ResourceFieldId | undefined {
  return resolveSystemAttributeRef(maps, attr, recordId ? getDefinitionId(recordId) : null)
}

/** Imperative variant for callers outside React render. */
export function getSystemAttributeRef(
  attr: string,
  entityDefinitionId?: string | null
): ResourceFieldId | undefined {
  return resolveSystemAttributeRef(useResourceStore.getState(), attr, entityDefinitionId)
}
