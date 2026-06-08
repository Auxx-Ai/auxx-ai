// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/schema-references.ts

import { findCachedResource, getCachedResources } from '../../../../../cache/org-cache-helpers'
import type { Resource } from '../../../../../resources/registry/types'

/**
 * Shared validation of `entity:` / `field:` reference chips against the org's
 * cached schema. Lifted out of `set-agent-prompt.ts` so the procedure-authoring
 * tools reuse the SAME actionable rejection a broken `@[field:ticket:status]`
 * chip produces. Validates `entity:`/`field:` chips only — `@[tool:…]` /
 * `@[article:…]` are not checked here (tools are reconciled separately).
 */

export interface SchemaValidationResult {
  /** Chip ids that don't resolve — the rejection condition. */
  unresolvedReferences: string[]
  /** Non-blocking advisories (e.g. a field-bearing entity mentioned in prose with no chip). */
  warnings: string[]
  /** Present only when `unresolvedReferences` is non-empty. */
  errorMessage?: string
}

/** Collect every `reference` chip id from a doc/fragment. */
export function collectReferenceIds(doc: unknown): string[] {
  const ids: string[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; attrs?: { id?: unknown }; content?: unknown[] }
    if (n.type === 'reference' && typeof n.attrs?.id === 'string') ids.push(n.attrs.id)
    if (Array.isArray(n.content)) for (const child of n.content) walk(child)
  }
  walk(doc)
  return ids
}

/** Extract plain text from a doc/fragment for prose-mention scanning. */
function collectText(doc: unknown): string {
  const parts: string[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; text?: unknown; content?: unknown[] }
    if (typeof n.text === 'string') parts.push(n.text)
    if (Array.isArray(n.content)) for (const child of n.content) walk(child)
  }
  walk(doc)
  return parts.join(' ')
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Validate `entity:` / `field:` chips against the org's cached schema. Returns
 * unresolved chip ids (rejection condition) + non-blocking warnings. Resource
 * lookup matches `findCachedResource` (id / entityType / apiSlug); field lookup
 * verifies the field exists on its declared entity by `id` or `resourceFieldId`.
 * Relationship-traversal paths (`a:b::c:d`) validate only the root segment.
 */
export async function validateSchemaReferences(
  doc: unknown,
  organizationId: string
): Promise<SchemaValidationResult> {
  const ids = collectReferenceIds(doc)
  const entityChips = ids.filter((id) => id.startsWith('entity:'))
  const fieldChips = ids.filter((id) => id.startsWith('field:'))

  const unresolved: string[] = []
  const warnings: string[] = []

  const entityKeys = new Set<string>()
  for (const chip of entityChips) entityKeys.add(chip.slice('entity:'.length))
  for (const chip of fieldChips) {
    const payload = chip.slice('field:'.length)
    const head = payload.split('::')[0] ?? payload
    const entityKey = head.split(':')[0]
    if (entityKey) entityKeys.add(entityKey)
  }

  const resolvedByKey = new Map<string, Resource | null>()
  for (const key of entityKeys) {
    resolvedByKey.set(key, await findCachedResource(organizationId, key))
  }

  for (const chip of entityChips) {
    const key = chip.slice('entity:'.length)
    if (!resolvedByKey.get(key)) unresolved.push(chip)
  }

  for (const chip of fieldChips) {
    const payload = chip.slice('field:'.length)
    const head = payload.split('::')[0] ?? payload
    const parts = head.split(':')
    const entityKey = parts[0]
    const fieldKey = parts[1]
    if (!entityKey || !fieldKey) {
      unresolved.push(chip)
      continue
    }
    const resource = resolvedByKey.get(entityKey)
    if (!resource) {
      unresolved.push(chip)
      continue
    }
    const found = resource.fields.some(
      (f) => f.id === fieldKey || f.resourceFieldId === `${entityKey}:${fieldKey}`
    )
    if (!found) unresolved.push(chip)
  }

  // Warning: a field-bearing entity mentioned in prose with no @[entity:…] chip.
  const chippedEntityKeys = new Set<string>()
  for (const chip of entityChips) {
    const key = chip.slice('entity:'.length)
    const resolved = resolvedByKey.get(key)
    if (resolved) {
      chippedEntityKeys.add(resolved.id)
      if (resolved.entityType) chippedEntityKeys.add(resolved.entityType)
      if (resolved.apiSlug) chippedEntityKeys.add(resolved.apiSlug)
    }
  }

  const allResources = await getCachedResources(organizationId)
  const text = collectText(doc).toLowerCase()
  const mentionedWithoutChip: string[] = []
  for (const r of allResources) {
    const alreadyChipped =
      chippedEntityKeys.has(r.id) ||
      (r.entityType ? chippedEntityKeys.has(r.entityType) : false) ||
      (r.apiSlug ? chippedEntityKeys.has(r.apiSlug) : false)
    if (alreadyChipped) continue
    const label = r.label?.toLowerCase()
    if (!label) continue
    if (new RegExp(`\\b${escapeRegex(label)}\\b`, 'i').test(text))
      mentionedWithoutChip.push(r.label)
  }
  if (mentionedWithoutChip.length > 0) {
    warnings.push(
      `Prose mentions ${mentionedWithoutChip.map((l) => `"${l}"`).join(', ')} but no \`@[entity:…]\` chip is present. Wrap the entity noun with \`@[entity:<apiSlug>]\` so admins can audit scope at a glance.`
    )
  }

  if (unresolved.length === 0) return { unresolvedReferences: [], warnings }

  const slugList = allResources.map((r) => r.apiSlug).join(', ')
  const errorMessage = `Rejected — ${unresolved.length} unresolved schema chip(s): ${unresolved.map((c) => `\`${c}\``).join(', ')}. For \`@[entity:<key>]\` chips, key must be one of the apiSlugs: ${slugList}. For \`@[field:<entityDef>:<fieldId>]\` chips, call \`list_entity_fields\` on the entityDef first and use a real field id from the response. Fix and retry.`

  return { unresolvedReferences: unresolved, warnings, errorMessage }
}
