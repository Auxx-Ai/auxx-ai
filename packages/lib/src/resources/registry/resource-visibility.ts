// packages/lib/src/resources/registry/resource-visibility.ts

import { isMailLensTableId } from '../picker/mail-lens-tables'
import type { Resource } from './types'

/**
 * The stable identity of a def, independent of how it was named.
 *
 * System resources (`thread`, `message`, `user`, …) have no `EntityDefinition`
 * row and carry `entityType === id === '<tableId>'`. Def-backed system types
 * (`inbox`, `tag`, `payment`, …) carry the org's CUID as `id` and the system slug
 * as `entityType`. User-authored defs have no `entityType`, so they key on their
 * CUID and can never collide with a curated entry.
 */
export function resourceDefKey(resource: Resource): string {
  return resource.entityType ?? resource.id
}

/**
 * Whether a def key names a def the generic record path refuses — the shared
 * mail-lens set, applied at the AI boundary.
 *
 * Keyed by the canonical def key ({@link resourceDefKey}), so every naming of the
 * same def is covered once the caller has resolved it: `thread`, `threads`,
 * `Threads`, the `threads` apiSlug and the `thread:<id>` RecordId prefix all land
 * on `thread`.
 */
export function isAiBlockedDefKey(key: string): boolean {
  return isMailLensTableId(key)
}

/**
 * Whether this resource is refused by the generic record path. Normalization-proof
 * by construction: the caller has already resolved whatever the model typed to a
 * `Resource`, and the check runs on the resolved identity.
 */
export function isAiBlockedResource(resource: Resource): boolean {
  return isAiBlockedDefKey(resourceDefKey(resource))
}

/**
 * Whether the AI may be *told about* this def — shown in `list_entities`, in the
 * prompt's entity catalog, and included in the global `search_entities` scope.
 *
 * Not an access check. The tools still gate on `canViewEntity` / `hasDefPresence`
 * per def and the picker still narrows per row.
 *
 * The block composes FIRST and is one-directional: `thread` / `message` carry a
 * per-member mail lens that exists only in `mail-query/`, and `canViewEntity`
 * is an unconditional pass-through for both (`NON_RECORD_DEF_SLUGS`), so the
 * generic record path has no gate of its own to fall back on. A production
 * turn once called `query_records({"entity":"threads"})` — the model routing
 * around the mail tools into the one path that applies no lens. Reading
 * `resource.aiVisible` directly at any call site would reopen exactly that
 * hole; this function is the only door.
 */
export function isAiVisibleResource(resource: Resource): boolean {
  if (isAiBlockedResource(resource)) return false
  return resource.aiVisible
}
