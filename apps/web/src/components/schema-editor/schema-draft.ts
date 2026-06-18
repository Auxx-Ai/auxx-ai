// apps/web/src/components/schema-editor/schema-draft.ts

import { FieldType } from '@auxx/database/enums'
import type { SelectOption } from '@auxx/types/custom-field'
import { generateId } from '@auxx/utils'

/**
 * The authoring model for the shared schema editor. Rows speak the platform
 * `FieldType` language; the persisted format is plain JSON Schema. `x-auxx`
 * vendor keywords bridge the two on leaf nodes (labels/colors a bare `enum`
 * can't carry), and any construct the FieldType mapping can't represent is
 * preserved verbatim as a `JSON` leaf via `raw` — the losslessness invariant
 * that makes it safe to open a server-declared schema in the field UI.
 *
 * See `plans/mcp/v5/structured-output-unification.md` and
 * `plans/mcp/v5/schema-editor-dialog.md`.
 */

/** Concrete value type of the `FieldType` enum object. */
export type FieldTypeValue = (typeof FieldType)[keyof typeof FieldType]

export interface SchemaFieldDraft {
  /** Local row key (stable across edits). */
  id: string
  name: string
  description?: string
  nullable: boolean
  /** Read/emitted only when `policy.emitRequired` (workflow mode). */
  required?: boolean
  kind: 'field' | 'object' | 'array'
  /** `kind: 'field'` — the picker FieldType (incl. `JSON` for `raw` leaves). */
  fieldType?: FieldTypeValue
  /** SINGLE_SELECT / MULTI_SELECT — resource-style options. */
  options?: SelectOption[]
  /** `kind: 'object'` children. */
  children?: SchemaFieldDraft[]
  /** `kind: 'array'` element schema (arrays of objects). */
  items?: SchemaFieldDraft
  /** Unrepresentable construct, re-emitted verbatim by `draftToJsonSchema`. */
  raw?: Record<string, unknown>
}

/** Editor policy — the per-mode fork (workflow / MCP / data source). */
export interface SchemaPolicy {
  /** Workflow mode emits the `required` array; MCP mode never does. */
  emitRequired: boolean
  /**
   * Root JSON Schema type the editor accepts. `'object'` (the default) keeps the
   * load-bearing object-root contract that workflow LLM structured-output needs
   * (the provider APIs and output-variable mapping require an object root). `'any'`
   * lets MCP edit array/scalar-rooted result schemas — list tools commonly produce
   * top-level arrays.
   */
  root?: 'object' | 'any'
  /**
   * Label on the synthetic root row in the Visual tab. Defaults to
   * `structured_output` (the editor's workflow origin); other consumers pass a
   * domain term (e.g. data sources use `record`).
   */
  rootLabel?: string
  /**
   * Allow arbitrary JSON Schema property names. The default (false) requires
   * identifier-shaped names so workflow variable paths (`structured_output.x`)
   * stay clean; data sources / general JSON schemas set this to permit any key
   * (`Total Price`, `line-items`, …).
   */
  freeformNames?: boolean
}

/**
 * The shape of a schema's root, as far as the visual editor can author it. An
 * object root or an array-of-objects root both seed the row tree; anything else
 * (scalar root, array of scalars) is JSON-tab only.
 */
export type SchemaRootKind = 'object' | 'array-of-objects' | 'other'

/** Classify a root JSON Schema into a {@link SchemaRootKind}. */
export function jsonSchemaRootKind(schema: Record<string, unknown>): SchemaRootKind {
  if (isObjectNode(schema)) return 'object'
  if (isArrayOfObjectsNode(schema)) return 'array-of-objects'
  return 'other'
}

/** The vendor-extension keyword carrying FieldType metadata on leaf nodes. */
const VENDOR_KEYWORD = 'x-auxx'

/**
 * FieldTypes the field editor can author. A pasted schema using anything else
 * opens as a `JSON` (`raw`) leaf and is edited in the JSON tab.
 */
export const PICKER_FIELD_TYPES: FieldTypeValue[] = [
  FieldType.TEXT,
  FieldType.NUMBER,
  FieldType.CHECKBOX,
  FieldType.DATE,
  FieldType.DATETIME,
  FieldType.EMAIL,
  FieldType.URL,
  FieldType.SINGLE_SELECT,
  FieldType.MULTI_SELECT,
  FieldType.TAGS,
  FieldType.JSON,
]

type JsonNode = Record<string, unknown>

// ---------------------------------------------------------------------------
// Read: JSON Schema → draft rows
// ---------------------------------------------------------------------------

/**
 * Convert a root JSON Schema into editor rows. An object root seeds rows from its
 * `properties`; an **array-of-objects** root seeds them from `items.properties`
 * (the rows describe one element — the dialog re-wraps on save). Any other root
 * (scalar, array of scalars) yields an empty list and is JSON-tab only.
 */
export function jsonSchemaToDraft(schema: Record<string, unknown>): SchemaFieldDraft[] {
  if (isObjectNode(schema)) return objectChildren(schema)
  if (isArrayOfObjectsNode(schema)) return objectChildren(schema.items as JsonNode)
  return []
}

function objectChildren(node: JsonNode): SchemaFieldDraft[] {
  const properties = (node.properties ?? {}) as Record<string, JsonNode>
  const requiredSet = new Set(asStringArray(node.required))
  return Object.entries(properties).map(([name, child]) =>
    nodeToDraft(name, child, requiredSet.has(name))
  )
}

function nodeToDraft(name: string, node: JsonNode, isRequired: boolean): SchemaFieldDraft {
  const draft = convertNode(node)
  draft.name = name
  draft.required = isRequired
  return draft
}

/** Build a draft (sans name/required) for a single JSON Schema node. */
function convertNode(node: JsonNode): SchemaFieldDraft {
  const base: SchemaFieldDraft = { id: generateId(), name: '', nullable: false, kind: 'field' }
  if (typeof node.description === 'string') base.description = node.description

  // 1. Trust an explicit FieldType from a prior editor save.
  const vendored = fromVendorKeyword(node, base)
  if (vendored) return vendored

  // 2. Infer from structure.
  const { type, nullable, exotic } = normalizeType(node.type)
  base.nullable = nullable
  if (exotic) return rawLeaf(node, base)

  // The only enums we can author are string enums (SINGLE_SELECT) and string
  // array-item enums (MULTI_SELECT). A numeric or mixed enum stays a raw leaf.
  if (node.enum !== undefined && type !== 'array' && !stringEnumOptions(node)) {
    return rawLeaf(node, base)
  }

  switch (type) {
    case 'object':
      base.kind = 'object'
      base.children = objectChildren(node)
      return base
    case 'array':
      return arrayToDraft(node, base)
    case 'string':
      return stringToDraft(node, base)
    case 'number':
    case 'integer':
      base.fieldType = FieldType.NUMBER
      return base
    case 'boolean':
      base.fieldType = FieldType.CHECKBOX
      return base
    case 'null':
      // A `null`-only sample carries no real type (a single null value tells us
      // nothing but "this can be null"). Author it as a nullable text field the
      // user can retype, rather than an opaque JSON leaf.
      base.fieldType = FieldType.TEXT
      base.nullable = true
      return base
    default:
      // missing type, or anything else → preserve verbatim.
      return rawLeaf(node, base)
  }
}

function fromVendorKeyword(node: JsonNode, base: SchemaFieldDraft): SchemaFieldDraft | null {
  const vendor = node[VENDOR_KEYWORD]
  if (!vendor || typeof vendor !== 'object') return null
  const fieldType = (vendor as { fieldType?: unknown }).fieldType
  if (typeof fieldType !== 'string' || !PICKER_FIELD_TYPES.includes(fieldType as FieldTypeValue)) {
    return null
  }
  if (fieldType === FieldType.JSON) return null // JSON leaves are raw-driven, not vendored.

  const { nullable } = normalizeType(node.type)
  base.nullable = nullable
  base.fieldType = fieldType as FieldTypeValue

  const options = (vendor as { options?: unknown }).options
  if (Array.isArray(options)) base.options = options as SelectOption[]
  return base
}

function arrayToDraft(node: JsonNode, base: SchemaFieldDraft): SchemaFieldDraft {
  const items = node.items
  if (!items || typeof items !== 'object' || Array.isArray(items)) return rawLeaf(node, base)
  const itemNode = items as JsonNode
  const { type: itemType, exotic } = normalizeType(itemNode.type)
  if (exotic) return rawLeaf(node, base)

  // Array of objects → a row sub-tree.
  if (itemType === 'object') {
    base.kind = 'array'
    base.items = convertNode(itemNode)
    base.items.name = 'item'
    return base
  }

  // Array of a string enum → MULTI_SELECT.
  const enumOptions = stringEnumOptions(itemNode)
  if (itemType === 'string' && enumOptions) {
    base.fieldType = FieldType.MULTI_SELECT
    base.options = enumOptions
    return base
  }
  // Array of plain (formatless) strings → the dedicated TAGS leaf.
  if (itemType === 'string' && itemNode.format === undefined && itemNode.enum === undefined) {
    base.fieldType = FieldType.TAGS
    return base
  }

  // Array of any other representable scalar — number / boolean / formatted string
  // (date, datetime, email, url) → a generic array with a scalar element draft.
  const itemDraft = convertNode(itemNode)
  if (itemDraft.kind === 'field' && !itemDraft.raw && itemDraft.fieldType !== FieldType.JSON) {
    itemDraft.name = 'item'
    base.kind = 'array'
    base.items = itemDraft
    return base
  }
  return rawLeaf(node, base)
}

function stringToDraft(node: JsonNode, base: SchemaFieldDraft): SchemaFieldDraft {
  const enumOptions = stringEnumOptions(node)
  if (node.enum !== undefined && !enumOptions) return rawLeaf(node, base) // numeric/mixed enum
  if (enumOptions) {
    base.fieldType = FieldType.SINGLE_SELECT
    base.options = enumOptions
    return base
  }
  switch (node.format) {
    case 'date-time':
      base.fieldType = FieldType.DATETIME
      return base
    case 'date':
      base.fieldType = FieldType.DATE
      return base
    case 'email':
      base.fieldType = FieldType.EMAIL
      return base
    case 'uri':
      base.fieldType = FieldType.URL
      return base
    default:
      base.fieldType = FieldType.TEXT
      return base
  }
}

function rawLeaf(node: JsonNode, base: SchemaFieldDraft): SchemaFieldDraft {
  base.kind = 'field'
  base.fieldType = FieldType.JSON
  base.nullable = false
  base.raw = structuredClone(node)
  return base
}

// ---------------------------------------------------------------------------
// Write: draft rows → JSON Schema
// ---------------------------------------------------------------------------

/**
 * Serialize editor rows back to a root JSON Schema. `additionalProperties` is
 * never emitted (the OpenAI client re-adds it in strict mode); `required` is
 * emitted only under `policy.emitRequired`.
 */
export function draftToJsonSchema(
  rows: SchemaFieldDraft[],
  policy: SchemaPolicy,
  rootKind: SchemaRootKind = 'object'
): Record<string, unknown> {
  const obj = objectNode(rows, policy)
  // An array-of-objects root re-wraps the row object as the element schema.
  return rootKind === 'array-of-objects' ? { type: 'array', items: obj } : obj
}

function objectNode(rows: SchemaFieldDraft[], policy: SchemaPolicy): JsonNode {
  const properties: Record<string, unknown> = {}
  for (const row of rows) {
    properties[row.name] = draftNodeToJson(row, policy)
  }
  const node: JsonNode = { type: 'object', properties }
  if (policy.emitRequired) {
    const required = rows.filter((r) => r.required).map((r) => r.name)
    if (required.length > 0) node.required = required
  }
  return node
}

function draftNodeToJson(draft: SchemaFieldDraft, policy: SchemaPolicy): JsonNode {
  // A raw leaf re-emits its preserved node verbatim — but its description stays
  // editable in the row, so sync that one field back onto the clone.
  if (draft.raw) {
    const node = structuredClone(draft.raw)
    if (draft.description) node.description = draft.description
    else delete node.description
    return node
  }

  let node: JsonNode
  if (draft.kind === 'object') {
    node = objectNode(draft.children ?? [], policy)
  } else if (draft.kind === 'array') {
    node = { type: 'array', items: draft.items ? draftNodeToJson(draft.items, policy) : {} }
  } else {
    node = fieldNodeToJson(draft)
  }

  if (draft.description) node.description = draft.description
  return applyNullable(node, draft.nullable)
}

function fieldNodeToJson(draft: SchemaFieldDraft): JsonNode {
  switch (draft.fieldType) {
    case FieldType.TEXT:
      return { type: 'string' }
    case FieldType.NUMBER:
      return { type: 'number' }
    case FieldType.CHECKBOX:
      return { type: 'boolean' }
    case FieldType.DATE:
      return { type: 'string', format: 'date' }
    case FieldType.DATETIME:
      return { type: 'string', format: 'date-time' }
    case FieldType.EMAIL:
      return { type: 'string', format: 'email' }
    case FieldType.URL:
      return { type: 'string', format: 'uri' }
    case FieldType.SINGLE_SELECT:
      return withVendor(
        { type: 'string', enum: optionValues(draft.options) },
        FieldType.SINGLE_SELECT,
        draft.options
      )
    case FieldType.MULTI_SELECT:
      return withVendor(
        { type: 'array', items: { type: 'string', enum: optionValues(draft.options) } },
        FieldType.MULTI_SELECT,
        draft.options
      )
    case FieldType.TAGS:
      return { type: 'array', items: { type: 'string' } }
    default:
      // JSON leaf with no `raw` — an explicit, empty "anything goes" node.
      return {}
  }
}

function withVendor(
  node: JsonNode,
  fieldType: FieldTypeValue,
  options: SelectOption[] | undefined
): JsonNode {
  node[VENDOR_KEYWORD] = { fieldType, options: options ?? [] }
  return node
}

/** Convert a string `type` into a `['type', 'null']` union when nullable. */
function applyNullable(node: JsonNode, nullable: boolean): JsonNode {
  if (!nullable) return node
  if (typeof node.type === 'string') return { ...node, type: [node.type, 'null'] }
  return node
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a JSON Schema `type` (string | array) into a primary type. */
function normalizeType(type: unknown): { type?: string; nullable: boolean; exotic: boolean } {
  if (typeof type === 'string') return { type, nullable: false, exotic: false }
  if (Array.isArray(type)) {
    const rest = type.filter((t) => t !== 'null')
    const nullable = type.includes('null')
    if (rest.length === 1 && typeof rest[0] === 'string') {
      return { type: rest[0], nullable, exotic: false }
    }
    // `['string','number']` and friends can't map to one FieldType.
    return { nullable, exotic: true }
  }
  return { nullable: false, exotic: true }
}

/** Read a string `enum` into SelectOptions, or null if absent / non-string. */
function stringEnumOptions(node: JsonNode): SelectOption[] | null {
  const values = node.enum
  if (!Array.isArray(values) || values.length === 0) return null
  if (!values.every((v) => typeof v === 'string')) return null
  return (values as string[]).map((value) => ({ id: generateId(), label: value, value }))
}

function optionValues(options: SelectOption[] | undefined): string[] {
  return (options ?? []).map((o) => o.value)
}

function isObjectNode(node: unknown): node is JsonNode {
  return (
    !!node &&
    typeof node === 'object' &&
    !Array.isArray(node) &&
    (node as JsonNode).type === 'object'
  )
}

/** An `{ type: 'array', items: { type: 'object', … } }` root — editable as rows. */
function isArrayOfObjectsNode(node: unknown): node is JsonNode {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false
  if ((node as JsonNode).type !== 'array') return false
  return isObjectNode((node as JsonNode).items)
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}
