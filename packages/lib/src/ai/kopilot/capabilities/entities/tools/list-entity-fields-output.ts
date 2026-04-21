// packages/lib/src/ai/kopilot/capabilities/entities/tools/list-entity-fields-output.ts

import type { ResourceField } from '../../../../../resources/registry/field-types'

const SELECT_TYPES = new Set(['SINGLE_SELECT', 'MULTI_SELECT', 'STATUS'])
const MAX_OPTIONS = 15

/** Metadata fields that are always auto-managed and don't need surfacing. */
const UNIVERSAL_METADATA_EXACT = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'created_at',
  'updated_at',
  'record_id',
])
/** Suffixes for entity-prefixed universal metadata (e.g. 'ticket_created_at'). */
const UNIVERSAL_METADATA_SUFFIXES = ['_created_at', '_updated_at', '_record_id']

/**
 * True for universal metadata (id / created_at / updated_at / record_id) in
 * any form. Used to keep the `autoFilled` summary focused on meaningful
 * hook-populated fields (ticket_number, created_by_id, …) rather than obvious
 * DB columns.
 *
 * The `_id` suffix is intentionally NOT in the suffix list — actor references
 * like `created_by_id` end with `_id` but carry real semantic value. A
 * two-segment trailing `_id` (e.g. `ticket_id`, `contact_id`) is the entity's
 * self-id and is detected separately.
 */
function isUniversalMetadata(systemAttribute: string | null | undefined): boolean {
  if (!systemAttribute) return false
  if (UNIVERSAL_METADATA_EXACT.has(systemAttribute)) return true
  if (UNIVERSAL_METADATA_SUFFIXES.some((s) => systemAttribute.endsWith(s))) return true
  const parts = systemAttribute.split('_')
  if (parts.length === 2 && parts[1] === 'id') return true
  return false
}

/** Per-field entry in the tool response. */
export interface FieldOutput {
  id: string
  label: string
  fieldType: string | undefined
  /** Only present when true — absence means "not required". */
  required?: true
  /** Only present when true — absence means "no uniqueness constraint". */
  unique?: true
  /** Only present when creatable && updatable are both false. */
  readOnly?: true
  /** Only present when creatable && !updatable (e.g. ticket_type). */
  createOnly?: true
  /** Select / multi-select / status option values. */
  options?: Array<{ value: string; label: string }>
  moreOptions?: true
  totalOptions?: number
  /** Relationship target metadata. */
  relationship?: {
    targetEntityDefinitionId: string | null
    relationshipType: string
  }
}

/** Full tool response body (without the `success` wrapper). */
export interface ListEntityFieldsOutput {
  entityDefinitionId: string
  /** IDs the LLM MUST include in `values` when calling create_entity. */
  requiredOnCreate: string[]
  /** IDs the system populates automatically (e.g. ticket_number). */
  autoFilled: string[]
  fields: FieldOutput[]
}

/**
 * Shape a single `ResourceField` for the LLM. Returns `null` when the field
 * should be excluded from the output entirely — currently only `computed`
 * fields (LLM can't set them and they derive from other values).
 */
export function formatFieldOutput(field: ResourceField): FieldOutput | null {
  const caps = field.capabilities

  // Computed fields are excluded from the listing.
  if (caps?.computed) return null

  const id = field.systemAttribute ?? field.key
  const fieldType = (field.fieldType ?? (field.type as unknown as string)) as string | undefined

  const entry: FieldOutput = {
    id,
    label: field.label,
    fieldType,
  }

  if (caps?.required) entry.required = true
  if (caps?.unique) entry.unique = true

  const creatable = caps?.creatable ?? true
  const updatable = caps?.updatable ?? true
  if (!creatable && !updatable) {
    entry.readOnly = true
  } else if (creatable && !updatable) {
    entry.createOnly = true
  }

  const ft = fieldType?.toUpperCase()

  // Select options
  if (ft && SELECT_TYPES.has(ft) && field.options?.options?.length) {
    const all = field.options.options
    entry.options = all.slice(0, MAX_OPTIONS).map((o) => ({ value: o.value, label: o.label }))
    if (all.length > MAX_OPTIONS) {
      entry.moreOptions = true
      entry.totalOptions = all.length
    }
    return entry
  }

  // Relationship target
  if (ft === 'RELATIONSHIP' && field.options?.relationship) {
    const inverseRfId = field.options.relationship.inverseResourceFieldId as string | undefined
    entry.relationship = {
      targetEntityDefinitionId: inverseRfId?.split(':')[0] ?? null,
      relationshipType: field.options.relationship.relationshipType as string,
    }
  }

  return entry
}

/**
 * Build the full `list_entity_fields` response body from a resource's fields.
 * Emits the per-field list plus two summaries:
 *  - `requiredOnCreate` — ids the LLM must include when creating
 *  - `autoFilled` — ids the system populates (hook-owned, excl. universal metadata)
 */
export function buildListEntityFieldsOutput(
  entityDefinitionId: string,
  fields: ResourceField[]
): ListEntityFieldsOutput {
  const formatted: FieldOutput[] = []
  const requiredOnCreate: string[] = []
  const autoFilled: string[] = []

  for (const f of fields) {
    const id = f.systemAttribute ?? f.key
    const caps = f.capabilities
    const creatable = caps?.creatable ?? true

    if (caps?.required && creatable) requiredOnCreate.push(id)

    // Auto-filled: non-creatable, non-computed, and not obvious metadata
    if (!creatable && !caps?.computed && !isUniversalMetadata(f.systemAttribute)) {
      autoFilled.push(id)
    }

    const entry = formatFieldOutput(f)
    if (entry) formatted.push(entry)
  }

  return {
    entityDefinitionId,
    requiredOnCreate,
    autoFilled,
    fields: formatted,
  }
}
