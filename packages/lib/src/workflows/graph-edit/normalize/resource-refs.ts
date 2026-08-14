// packages/lib/src/workflows/graph-edit/normalize/resource-refs.ts

/**
 * Resource-reference normalization (`03-graph-edit-service.md` §3 row 2) —
 * SERVER-ONLY (reads the org cache; never export through a client barrel).
 *
 * `ResourcePicker` writes `resource.id`, which for every `ENTITY_DEFINITION_TYPES`
 * member (tier B) and every user-created entity (tier C) is a per-org
 * EntityDefinition CUID — and both the variable picker and the runtime build
 * paths from it. An agent that writes the bare slug produces a graph whose
 * picker and runtime disagree, so slug → CUID resolution is a CORRECTNESS
 * requirement, not ergonomics (`05-resource-model.md` §2–3). Tier-A slugs
 * (`thread`, `message`, `kb`, …) ARE their canonical id and are left alone —
 * the same gate as `canonicalizeEntityDefinitionId`, and the same trap: the
 * entityDefs cache resolves `thread` to a def id that nothing else uses, so
 * "the cache resolved it" is never the gate.
 *
 * The convention this copies is the template dialect's `@entity:<slug>`
 * resolution (`template-resolution.ts`), which resolves slugs to the same
 * canonical values at install time.
 */

import { err, ok, type Result } from 'neverthrow'
import { getCachedResources } from '../../../cache'
import { type AuxxError, BadRequestError, NotFoundError } from '../../../errors'
import type { Resource } from '../../../resources/registry/types'
import { isSystemResourceId } from '../../../resources/registry/types'
import { closestMatches } from '../refs'
import type { Issue } from '../types'
import type { ResourceAliasIndex } from './friendly-refs'

/**
 * Which config keys hold a resource identifier, per node type. The plan's
 * `resourceRef` manifest marker (01 §6) has not shipped, so the map lives here
 * until it does — keep it in sync with the crud/find/resource-trigger
 * manifests.
 */
export const RESOURCE_CONFIG_KEYS: Readonly<Record<string, readonly string[]>> = {
  find: ['resourceType'],
  crud: ['resourceType'],
  'resource-trigger': ['resourceType', 'entityDefinitionId'],
}

/** The alias strings a resource answers to, for matching and error candidates. */
function resourceAliases(resource: Resource): string[] {
  return [resource.entityType, resource.apiSlug, resource.label, resource.plural].filter(
    (alias): alias is string => typeof alias === 'string' && alias !== ''
  )
}

/**
 * Resolve a friendly resource reference (slug, apiSlug, label, plural, or an
 * already-canonical id) to the value `find`/`crud`/`resource-trigger` configs
 * must persist: the bare slug for tier-A system resources, the org's
 * EntityDefinition CUID for tiers B/C. Unresolvable input is an error naming
 * the closest candidates — never passed through for the runtime to choke on.
 */
export async function resolveResourceRef(
  orgId: string,
  value: string
): Promise<Result<string, AuxxError>> {
  const trimmed = value.trim()
  if (!trimmed) return err(new BadRequestError('Resource reference is empty'))

  // Tier A: table-backed system resources stay slug-keyed everywhere.
  if (isSystemResourceId(trimmed)) return ok(trimmed)

  const resources = await getCachedResources(orgId)

  const byId = resources.find((r) => r.id === trimmed)
  if (byId) return ok(byId.id)

  const needle = trimmed.toLowerCase()
  const strong = resources.filter(
    (r) => r.entityType?.toLowerCase() === needle || r.apiSlug.toLowerCase() === needle
  )
  const matches =
    strong.length > 0
      ? strong
      : resources.filter(
          (r) => r.label.toLowerCase() === needle || r.plural.toLowerCase() === needle
        )

  if (matches.length === 1) return ok(matches[0]!.id)
  if (matches.length > 1) {
    return err(
      new BadRequestError(
        `Resource reference "${trimmed}" is ambiguous — it matches: ` +
          `${matches.map((r) => `"${r.label}" (${r.apiSlug})`).join(', ')}. Use the apiSlug.`
      )
    )
  }

  const allAliases = resources.flatMap(resourceAliases)
  const near = closestMatches(trimmed, allAliases)
  const available = resources
    .filter((r) => r.isVisible)
    .map((r) => r.apiSlug)
    .slice(0, 15)
  const hint =
    near.length > 0
      ? ` Did you mean ${near.map((a) => `"${a}"`).join(' or ')}?`
      : available.length > 0
        ? ` Available resources: ${available.join(', ')}.`
        : ''
  return err(new NotFoundError(`Unknown resource "${trimmed}".${hint}`))
}

/**
 * Build the per-org alias index the pure ref rewriters
 * (`friendly-refs.ts`) consume for the resource path segment. Tier B/C only:
 * a tier-A resource's canonical id IS its slug, so it needs no aliasing in
 * either direction. Aliases that collide across resources are dropped —
 * an ambiguous alias must never silently pick a resource.
 */
export async function buildResourceAliasIndex(orgId: string): Promise<ResourceAliasIndex> {
  const resources = await getCachedResources(orgId)
  const aliasToId = new Map<string, string>()
  const idToSlug = new Map<string, string>()
  const ambiguous = new Set<string>()

  for (const resource of resources) {
    if (resource.type !== 'custom') continue
    idToSlug.set(resource.id, resource.entityType ?? resource.apiSlug)
    for (const alias of [resource.id, ...resourceAliases(resource)]) {
      const key = alias.toLowerCase()
      if (ambiguous.has(key)) continue
      const existing = aliasToId.get(key)
      if (existing && existing !== resource.id) {
        aliasToId.delete(key)
        ambiguous.add(key)
        continue
      }
      aliasToId.set(key, resource.id)
    }
  }

  return { aliasToId, idToSlug }
}

/**
 * Normalize every resource-holding config key of one node config
 * (per {@link RESOURCE_CONFIG_KEYS}). Unresolvable values stay verbatim and
 * come back as ERROR issues carrying the field name — the caller refuses to
 * persist on error severity. Node types without resource keys pass through
 * untouched. Returns a shallow clone; `config` is never mutated.
 */
export async function normalizeResourceConfig<T extends Record<string, unknown>>(
  orgId: string,
  nodeType: string,
  config: T
): Promise<{ config: T; issues: Issue[] }> {
  const keys = RESOURCE_CONFIG_KEYS[nodeType]
  if (!keys) return { config, issues: [] }

  const next: Record<string, unknown> = { ...config }
  const issues: Issue[] = []
  for (const key of keys) {
    const value = next[key]
    if (typeof value !== 'string' || !value.trim()) continue
    const resolved = await resolveResourceRef(orgId, value)
    if (resolved.isOk()) {
      next[key] = resolved.value
    } else {
      issues.push({ severity: 'error', field: key, message: resolved.error.message })
    }
  }
  return { config: next as T, issues }
}
