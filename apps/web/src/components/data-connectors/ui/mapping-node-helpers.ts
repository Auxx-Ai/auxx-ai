// apps/web/src/components/data-connectors/ui/mapping-node-helpers.ts
// Pure presentation helpers shared by the mapping editor's node/row components —
// field-icon resolution, related-def lookup, and the source-rootPath → record-noun
// phrasing for a mapping header. No React / no state.

import type { FieldType } from '@auxx/database/types'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import type { ResourceField } from '@auxx/lib/resources/client'
import { mapBaseTypeToFieldType } from '@auxx/lib/workflow-engine/client'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import type { SourceTreeNode } from '../hooks/use-source-paths'

/**
 * The field-type icon for an applied target field — mirrors the picker-list row so the
 * trigger chip matches what you picked. Falls back to the BaseType→FieldType mapping for
 * system fields, then a generic `circle`.
 */
export function fieldIconId(field: ResourceField | undefined): string | undefined {
  if (!field) return undefined
  const fieldType =
    (field.fieldType as FieldType) ||
    (field.type ? mapBaseTypeToFieldType(field.type as any) : undefined)
  return (fieldType && fieldTypeOptions[fieldType]?.iconId) ?? 'circle'
}

/** The related def a relationship field points at, or null if it has none. */
export function relatedDefOf(field: ResourceField): string | null {
  return field.relationship
    ? getRelatedEntityDefinitionId(field.relationship as RelationshipConfig)
    : null
}

/** Naive singularizer for record nouns (`todos → todo`, `line_items → line item`). */
function singularize(word: string): string {
  if (/ies$/.test(word)) return word.replace(/ies$/, 'y')
  if (/(ss|sis|us)$/.test(word)) return word // address, analysis, status
  if (/s$/.test(word)) return word.replace(/s$/, '')
  return word
}

/** A source segment → a lowercase singular noun (`line_items[]` → `line item`). */
function recordNoun(raw: string): string {
  return singularize(raw.replace(/\[\]$/, '')).replace(/[_-]+/g, ' ').toLowerCase().trim()
}

/**
 * Plain-language description of where a mapping's records come from, derived from the
 * defined source schema. An ARRAY branch fans out one record per element, so it reads
 * "each <noun>" (`drafts[]` → "each draft"); a SINGULAR object branch is one record, so
 * it reads "one <noun>" (`customer` → "one customer"). The unnamed array ROOT (`[]`) has
 * no schema name, so it falls back to the stream's own noun (stream key `todos` → "each
 * todo"). Returns the parts split so the header can style the qualifier like a field's
 * TYPE token and the noun like its LABEL (row-consistent).
 */
export function describeRootPath(
  rootPath: string,
  fallbackNoun?: string
): { qualifier: string; noun: string } {
  if (rootPath === '') return { qualifier: 'whole', noun: 'payload' }
  const isArray = rootPath.endsWith('[]')
  const seg = rootPath.replace(/\[\]$/, '').split('.').pop()
  const noun = seg ? recordNoun(seg) : fallbackNoun ? recordNoun(fallbackNoun) : 'item'
  return { qualifier: isArray ? 'each' : 'one', noun }
}

/** The fan-out rootPath for a branch node — arrays keep their `[]` suffix. */
export function branchRootPath(node: SourceTreeNode): string {
  return node.type === 'array' ? `${node.path}[]` : node.path
}
