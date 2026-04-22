// packages/lib/src/placeholders/path-parser.ts

import type { FieldReference } from '@auxx/types/field'
import { getRootEntityId, isFieldPath, keyToFieldRef } from '@auxx/types/field'

/**
 * Synthetic `date:` placeholder slugs. These are not real entity fields —
 * the token body is the slug itself and the resolver computes the value.
 */
export type DateSlug = 'today' | 'now' | 'tomorrow' | 'yesterday'

const DATE_SLUGS = new Set<string>(['today', 'now', 'tomorrow', 'yesterday'])

/**
 * Synthetic `org:` placeholder slugs. The Organization resource has no
 * custom-field definitions yet, so we expose a fixed set of columns from
 * the `Organization` DB row. Distinct prefix from the (future) entity-backed
 * `organization:<fieldId>` namespace.
 */
export type OrgSlug = 'name' | 'handle' | 'website'

const ORG_SLUGS = new Set<string>(['name', 'handle', 'website'])

/**
 * Synthetic `user:` placeholder slugs. The sender's user record is read
 * from the `userProfile` cache rather than routed through
 * `FieldValueService` — the user resource has no custom fields and the
 * join-scoped lookup doesn't work for single-user resolution.
 */
export type UserSlug = 'id' | 'email' | 'name' | 'firstName' | 'lastName'

const USER_SLUGS = new Set<string>(['id', 'email', 'name', 'firstName', 'lastName'])

export type ParsedPlaceholder =
  | {
      kind: 'date'
      slug: DateSlug
    }
  | {
      kind: 'org'
      slug: OrgSlug
    }
  | {
      kind: 'user'
      slug: UserSlug
    }
  | {
      kind: 'field'
      fieldRef: FieldReference
      /** First entity definition id — the routing hint for record-source dispatch. */
      rootEntityDefinitionId: string
    }

/**
 * Parse a placeholder token id into its structured form.
 * Token ids are exactly the picker's fieldRefKey output (e.g. `contact:email`,
 * `thread:x::ticket:y`) or the synthetic `date:<slug>` / `org:<slug>` /
 * `user:<slug>` shapes.
 *
 * Phase 2 will extend this to strip trailing `| formatter[:arg]` segments.
 */
export function parsePlaceholderId(id: string): ParsedPlaceholder {
  if (!id) throw new Error('placeholder id is empty')

  if (id.startsWith('date:')) {
    const slug = id.slice('date:'.length)
    if (!DATE_SLUGS.has(slug)) {
      throw new Error(`unknown date slug: ${slug}`)
    }
    return { kind: 'date', slug: slug as DateSlug }
  }

  if (id.startsWith('org:')) {
    const slug = id.slice('org:'.length)
    if (!ORG_SLUGS.has(slug)) {
      throw new Error(`unknown org slug: ${slug}`)
    }
    return { kind: 'org', slug: slug as OrgSlug }
  }

  // `user:<slug>` is synthetic when there's no relationship traversal and the
  // slug is in the known set. `user:…::…` still routes through the field
  // path (though today we don't expose any user relationships).
  if (id.startsWith('user:') && !id.includes('::')) {
    const slug = id.slice('user:'.length)
    if (USER_SLUGS.has(slug)) {
      return { kind: 'user', slug: slug as UserSlug }
    }
  }

  const fieldRef = keyToFieldRef(id)
  const rootEntityDefinitionId = isFieldPath(fieldRef)
    ? getRootEntityId(fieldRef)
    : getRootEntityId([fieldRef])

  return { kind: 'field', fieldRef, rootEntityDefinitionId }
}

/**
 * Safe variant that returns null instead of throwing on malformed ids.
 */
export function tryParsePlaceholderId(id: string): ParsedPlaceholder | null {
  try {
    return parsePlaceholderId(id)
  } catch {
    return null
  }
}
