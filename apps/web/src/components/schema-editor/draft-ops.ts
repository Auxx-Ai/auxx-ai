// apps/web/src/components/schema-editor/draft-ops.ts

import { FieldType } from '@auxx/database/enums'
import {
  BaseType,
  mapBaseTypeToFieldType,
  mapFieldTypeToBaseType,
} from '@auxx/lib/workflow-engine/client'
import { generateId } from '@auxx/utils'
import type { VariableTypeValue } from '~/components/workflow/ui/variable-type-picker'
import type { FieldTypeValue, SchemaFieldDraft } from './schema-draft'

/**
 * Pure mutations over the draft tree. Rows carry stable `id`s, so add / rename /
 * retype / delete are each one recursive, immutable update — no immer, no
 * path-surgery, unit-testable without React. Descendants live in `children`
 * (object rows) or in the single `items` draft (array-of-object rows); the
 * recursion descends into both.
 */

/** Sentinel picker values for the structural (non-FieldType) entries. */
export const STRUCTURAL_OBJECT = '__object__'
export const STRUCTURAL_ARRAY = '__array__'

/** A picker value is either a leaf FieldType or one of the structural sentinels. */
export type PickerValue = FieldTypeValue | typeof STRUCTURAL_OBJECT | typeof STRUCTURAL_ARRAY

export function newFieldDraft(): SchemaFieldDraft {
  return { id: generateId(), name: '', nullable: false, kind: 'field', fieldType: FieldType.TEXT }
}

function newObjectItems(): SchemaFieldDraft {
  return { id: generateId(), name: 'item', nullable: false, kind: 'object', children: [] }
}

/** The picker value currently representing a row. */
export function pickerValueOf(row: SchemaFieldDraft): PickerValue {
  if (row.kind === 'object') return STRUCTURAL_OBJECT
  if (row.kind === 'array') return STRUCTURAL_ARRAY
  return (row.fieldType ?? FieldType.TEXT) as FieldTypeValue
}

/**
 * Short, lowercase type label in the JSON-Schema idiom (`string`, `array[object]`,
 * `enum`, …) — matches the plain-text look of the read row and type picker.
 */
export function typeLabelOf(value: PickerValue): string {
  switch (value) {
    case STRUCTURAL_OBJECT:
      return 'object'
    case STRUCTURAL_ARRAY:
      return 'array[object]'
    case FieldType.TEXT:
      return 'string'
    case FieldType.NUMBER:
      return 'number'
    case FieldType.CHECKBOX:
      return 'boolean'
    case FieldType.DATE:
      return 'date'
    case FieldType.DATETIME:
      return 'datetime'
    case FieldType.EMAIL:
      return 'email'
    case FieldType.URL:
      return 'url'
    case FieldType.SINGLE_SELECT:
      return 'enum'
    case FieldType.MULTI_SELECT:
      return 'array[enum]'
    case FieldType.TAGS:
      return 'array[string]'
    default:
      return 'json'
  }
}

/** Apply `patch` to the row with `id`, recursing through children + items. */
export function updateRow(
  rows: SchemaFieldDraft[],
  id: string,
  patch: (row: SchemaFieldDraft) => SchemaFieldDraft
): SchemaFieldDraft[] {
  return rows.map((r) => {
    let row = r.id === id ? patch(r) : r
    if (row.children) row = { ...row, children: updateRow(row.children, id, patch) }
    if (row.items) row = { ...row, items: updateRow([row.items], id, patch)[0]! }
    return row
  })
}

/** Remove the row with `id` (and only deletable rows — never an `items` draft). */
export function removeRow(rows: SchemaFieldDraft[], id: string): SchemaFieldDraft[] {
  return rows
    .filter((r) => r.id !== id)
    .map((r) => {
      let row = r
      if (row.children) row = { ...row, children: removeRow(row.children, id) }
      if (row.items?.children) {
        row = { ...row, items: { ...row.items, children: removeRow(row.items.children, id) } }
      }
      return row
    })
}

/**
 * Append a new TEXT field. `parentId` null adds to the root; otherwise it adds
 * to the named object row's `children`, or an array row's `items.children`.
 */
export function addField(
  rows: SchemaFieldDraft[],
  parentId: string | null
): { rows: SchemaFieldDraft[]; id: string } {
  const field = newFieldDraft()
  if (!parentId) return { rows: [...rows, field], id: field.id }

  const insert = (list: SchemaFieldDraft[]): SchemaFieldDraft[] =>
    list.map((r) => {
      if (r.id === parentId) {
        if (r.kind === 'object') return { ...r, children: [...(r.children ?? []), field] }
        if (r.kind === 'array' && r.items) {
          return { ...r, items: { ...r.items, children: [...(r.items.children ?? []), field] } }
        }
        return r
      }
      let row = r
      if (row.children) row = { ...row, children: insert(row.children) }
      if (row.items) row = { ...row, items: insert([row.items])[0]! }
      return row
    })

  return { rows: insert(rows), id: field.id }
}

/**
 * Retype a row, pruning incompatible parts. Structural ↔ leaf switches drop the
 * now-meaningless children/items/options/raw; select types keep an editable
 * options list. All changes stay in the pre-save draft — no confirm.
 */
export function changeRowType(row: SchemaFieldDraft, value: PickerValue): SchemaFieldDraft {
  const base = {
    id: row.id,
    name: row.name,
    description: row.description,
    nullable: row.nullable,
    required: row.required,
  }

  if (value === STRUCTURAL_OBJECT) {
    return { ...base, kind: 'object', children: row.children ?? [] }
  }
  if (value === STRUCTURAL_ARRAY) {
    return { ...base, kind: 'array', items: row.items ?? newObjectItems() }
  }

  const fieldType = value as FieldTypeValue
  const next: SchemaFieldDraft = { ...base, kind: 'field', fieldType }
  if (fieldType === FieldType.SINGLE_SELECT || fieldType === FieldType.MULTI_SELECT) {
    next.options = row.options ?? []
  }
  return next
}

// ---------------------------------------------------------------------------
// Bridge to the shared `VariableTypePicker` (BaseType + isArray model)
// ---------------------------------------------------------------------------

/**
 * `BaseType`s the schema editor doesn't author — handed to the picker's
 * `excludeTypes`. The draft model speaks a JSON-Schema-shaped subset, so
 * workflow-only types (file/secret/relation/…) and the redundant `TAGS`
 * (authored as `string` + array) are filtered out of the list.
 */
export const SCHEMA_EDITOR_EXCLUDED_TYPES: BaseType[] = [
  BaseType.ARRAY,
  BaseType.TIME,
  BaseType.FILE,
  BaseType.REFERENCE,
  BaseType.RELATION,
  BaseType.ACTOR,
  BaseType.SECRET,
  BaseType.ANY,
  BaseType.NULL,
  BaseType.PHONE,
  BaseType.CURRENCY,
  BaseType.ADDRESS,
  BaseType.TAGS,
]

/**
 * Whether the editor can author an array of this base type. Only the three
 * forms the draft model represents — `array[object]`, `array[enum]`
 * (MULTI_SELECT), `array[string]` (TAGS) — expose the picker's Array toggle.
 */
export function canArrayInSchema(baseType: BaseType): boolean {
  return baseType === BaseType.OBJECT || baseType === BaseType.ENUM || baseType === BaseType.STRING
}

/**
 * Current row → the picker's `{ baseType, isArray }` value. Structural rows
 * (object / array-of-object) and the editor's array leaves (MULTI_SELECT /
 * TAGS) carry the array dimension the shared 1:1 mapper can't; every other
 * leaf defers to `mapFieldTypeToBaseType`.
 */
export function typeValueOf(row: SchemaFieldDraft): VariableTypeValue {
  if (row.kind === 'object') return { baseType: BaseType.OBJECT, isArray: false }
  if (row.kind === 'array') return { baseType: BaseType.OBJECT, isArray: true }
  if (row.fieldType === FieldType.MULTI_SELECT) return { baseType: BaseType.ENUM, isArray: true }
  if (row.fieldType === FieldType.TAGS) return { baseType: BaseType.STRING, isArray: true }
  return { baseType: mapFieldTypeToBaseType(row.fieldType ?? FieldType.TEXT), isArray: false }
}

/**
 * The picker's `{ baseType, isArray }` value → a `PickerValue` for
 * `changeRowType`. Mirrors `typeValueOf`: structural + array variants are
 * explicit, the rest defers to `mapBaseTypeToFieldType` (which has no `OBJECT`
 * or `JSON` case, both handled here).
 */
export function pickerValueFromTypeValue({ baseType, isArray }: VariableTypeValue): PickerValue {
  if (baseType === BaseType.OBJECT) return isArray ? STRUCTURAL_ARRAY : STRUCTURAL_OBJECT
  if (baseType === BaseType.JSON) return FieldType.JSON
  if (isArray && baseType === BaseType.ENUM) return FieldType.MULTI_SELECT
  if (isArray && baseType === BaseType.STRING) return FieldType.TAGS
  return mapBaseTypeToFieldType(baseType) as PickerValue
}

/** Sibling names of a row, used for duplicate-name validation in the edit card. */
export function siblingNames(rows: SchemaFieldDraft[], id: string): string[] {
  const list = findSiblingList(rows, id)
  return list ? list.filter((r) => r.id !== id).map((r) => r.name) : []
}

function findSiblingList(rows: SchemaFieldDraft[], id: string): SchemaFieldDraft[] | null {
  if (rows.some((r) => r.id === id)) return rows
  for (const row of rows) {
    if (row.children) {
      const found = findSiblingList(row.children, id)
      if (found) return found
    }
    if (row.items?.children) {
      const found = findSiblingList(row.items.children, id)
      if (found) return found
    }
  }
  return null
}
