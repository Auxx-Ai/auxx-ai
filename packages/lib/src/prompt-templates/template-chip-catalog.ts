// packages/lib/src/prompt-templates/template-chip-catalog.ts

import { ENTITY_DEFINITION_TYPES, type EntityDefinitionType } from '@auxx/types/resource'

/**
 * Audit table for every `@[...]` chip id referenced from a system prompt
 * template. The boot-time test (`__tests__/chip-catalog.test.ts`) walks each
 * compiled template's `DocJSON`, finds every inline `reference` node, and
 * asserts the id resolves via {@link resolveTemplateChip}.
 *
 * If a contributor adds a new chip to a `.md` template that isn't in here,
 * the test fails — forcing the audit to stay in sync with the source files.
 *
 * The catalog is intentionally a flat constant table rather than a runtime
 * lookup against the live tool / EntityDefinition tables: the system
 * templates ship in the binary and need to validate at module-eval, before
 * any DB connection exists.
 *
 * See: plans/kopilot/templates/template-overhaul-with-references.md §5
 */

/**
 * Tools referenced by chip id in system templates. The chip id is
 * `tool:<name>`. The names below must match the `name` field on a real
 * `AgentToolDefinition` in
 * `packages/lib/src/ai/kopilot/capabilities/**\/tools/*.ts`.
 *
 * If a tool is renamed, this list and any `.md` referencing it both have to
 * be updated.
 */
export const KNOWN_TOOL_NAMES = new Set<string>([
  'get_thread_detail',
  'list_notes',
  'get_entity',
  'get_entity_history',
  'search_entities',
  'search_knowledge',
  'get_transcript',
])

/**
 * `entity:<entityDefinitionId>` chip ids that are guaranteed to resolve in
 * any org. These are system types from `ENTITY_DEFINITION_TYPES`.
 */
export const SYSTEM_ENTITY_IDS: Set<string> = new Set(ENTITY_DEFINITION_TYPES)

/**
 * `entity:<entityDefinitionId>` chip ids that exist only after a
 * `@auxx/seed` domain pack has been installed for the org (e.g. Shopify
 * orders, sales pipeline deals).
 *
 * Per Q2 of the templates-v2 plan: these aren't on the system type guard,
 * but the runtime EntityDefinition row resolves them once the seed is
 * applied. If the org hasn't installed the seed, the reference resolver
 * logs a miss and the chip flattens to `[reference](missing:entity:order)`
 * in the rendered prompt — visible drift instead of silent degradation.
 */
export const SEED_ENTITY_IDS = new Set<string>(['order', 'deal'])

export type ChipKind =
  | { ok: true; kind: 'tool'; name: string }
  | { ok: true; kind: 'entity:system'; entityDefinitionId: EntityDefinitionType }
  | { ok: true; kind: 'entity:seed'; entityDefinitionId: string }
  | { ok: false; reason: string }

/**
 * Resolve a chip id from a system template to a known catalog entry, or
 * return a structured failure with the reason.
 */
export function resolveTemplateChip(chipId: string): ChipKind {
  const colon = chipId.indexOf(':')
  if (colon <= 0) return { ok: false, reason: `chip id "${chipId}" missing prefix` }
  const prefix = chipId.slice(0, colon)
  const rest = chipId.slice(colon + 1)

  if (prefix === 'tool') {
    if (KNOWN_TOOL_NAMES.has(rest)) return { ok: true, kind: 'tool', name: rest }
    return {
      ok: false,
      reason: `unknown tool name "${rest}" — add it to KNOWN_TOOL_NAMES or fix the chip`,
    }
  }

  if (prefix === 'entity') {
    if (SYSTEM_ENTITY_IDS.has(rest)) {
      return { ok: true, kind: 'entity:system', entityDefinitionId: rest as EntityDefinitionType }
    }
    if (SEED_ENTITY_IDS.has(rest)) {
      return { ok: true, kind: 'entity:seed', entityDefinitionId: rest }
    }
    return {
      ok: false,
      reason: `unknown entity "${rest}" — not in ENTITY_DEFINITION_TYPES or SEED_ENTITY_IDS`,
    }
  }

  return {
    ok: false,
    reason: `unsupported chip prefix "${prefix}" in system template — only tool / entity are vetted`,
  }
}
