// apps/web/src/components/schema-editor/draft-ops.ts

import { FieldType } from '@auxx/database/enums'
import {
  BaseType,
  mapBaseTypeToFieldType,
  mapFieldTypeToBaseType,
} from '@auxx/lib/workflow-engine/client'
import { generateId } from '@auxx/utils'
import type { VariableTypeValue } from '~/components/workflow/ui/variable-type-picker'
import { getVarTypeName } from '~/components/workflow/utils/icon-helper'
import type { FieldTypeValue, SchemaFieldDraft } from './schema-draft'

/**
 * Pure mutations over the draft tree. Rows carry stable `id`s, so add / rename /
 * retype / delete are each one recursive, immutable update — no immer, no
 * path-surgery, unit-testable without React. Descendants live in `children`
 * (object rows) or in the single `items` draft (array-of-object rows); the
 * recursion descends into both.
 */

export function newFieldDraft(): SchemaFieldDraft {
  return { id: generateId(), name: '', nullable: false, kind: 'field', fieldType: FieldType.TEXT }
}

function newObjectItems(): SchemaFieldDraft {
  return { id: generateId(), name: 'item', nullable: false, kind: 'object', children: [] }
}

/** A leaf array-element draft for an array of scalars (`array[number]`, …). */
function scalarItems(fieldType: FieldTypeValue): SchemaFieldDraft {
  return { id: generateId(), name: 'item', nullable: false, kind: 'field', fieldType }
}

/**
 * Short, lowercase type label in the JSON-Schema idiom (`string`, `array[object]`,
 * `array[number]`, `datetime`, …) — matches the plain-text look of the read row
 * and type picker. Reuses the shared `getVarTypeName` (Title Case) lowered to the
 * editor's idiom, and brackets arrays as `array[<base>]` uniformly.
 */
export function typeLabelOf({ baseType, isArray }: VariableTypeValue): string {
  const base = getVarTypeName(baseType).toLowerCase().replaceAll(' ', '')
  return isArray ? `array[${base}]` : base
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
 * Retype a row to the picker's `{ baseType, isArray }` selection, pruning
 * incompatible parts. Structural ↔ leaf switches drop the now-meaningless
 * children/items/options/raw; select types keep an editable options list; an
 * `isArray` scalar becomes an `array` row with a leaf element draft. All changes
 * stay in the pre-save draft — no confirm.
 */
export function changeRowType(
  row: SchemaFieldDraft,
  { baseType, isArray }: VariableTypeValue
): SchemaFieldDraft {
  const base = {
    id: row.id,
    name: row.name,
    description: row.description,
    nullable: row.nullable,
    required: row.required,
  }

  // Object, and array-of-object — the row-tree structural kinds.
  if (baseType === BaseType.OBJECT) {
    if (isArray) return { ...base, kind: 'array', items: row.items ?? newObjectItems() }
    return { ...base, kind: 'object', children: row.children ?? [] }
  }

  // Enum → SINGLE_SELECT (or MULTI_SELECT for an array); both keep the options.
  if (baseType === BaseType.ENUM) {
    return {
      ...base,
      kind: 'field',
      fieldType: isArray ? FieldType.MULTI_SELECT : FieldType.SINGLE_SELECT,
      options: row.options ?? [],
    }
  }

  // Array of plain strings has a dedicated leaf type (TAGS).
  if (baseType === BaseType.STRING && isArray) {
    return { ...base, kind: 'field', fieldType: FieldType.TAGS }
  }

  if (baseType === BaseType.JSON) {
    return { ...base, kind: 'field', fieldType: FieldType.JSON }
  }

  const fieldType = mapBaseTypeToFieldType(baseType) as FieldTypeValue
  // Array of a scalar leaf (number / boolean / date / datetime / email / url).
  if (isArray) return { ...base, kind: 'array', items: scalarItems(fieldType) }
  return { ...base, kind: 'field', fieldType }
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
 * Whether the editor can author an array of this base type. Any type the picker
 * offers (i.e. not in {@link SCHEMA_EDITOR_EXCLUDED_TYPES}) is arrayable as
 * `array[<base>]`, except `json` (the catch-all for unrepresentable shapes) and
 * the structural `array` itself.
 */
export function canArrayInSchema(baseType: BaseType): boolean {
  return (
    !SCHEMA_EDITOR_EXCLUDED_TYPES.includes(baseType) &&
    baseType !== BaseType.ARRAY &&
    baseType !== BaseType.JSON
  )
}

/**
 * Current row → the picker's `{ baseType, isArray }` value. Structural rows
 * (object / array) and the editor's array leaves (MULTI_SELECT / TAGS) carry the
 * array dimension; an `array` row's base type comes from its element draft so
 * scalar arrays (`array[number]`, …) round-trip; every other leaf defers to
 * `mapFieldTypeToBaseType`.
 */
export function typeValueOf(row: SchemaFieldDraft): VariableTypeValue {
  if (row.kind === 'object') return { baseType: BaseType.OBJECT, isArray: false }
  if (row.kind === 'array') {
    const items = row.items
    const baseType =
      items?.kind === 'field'
        ? mapFieldTypeToBaseType(items.fieldType ?? FieldType.TEXT)
        : BaseType.OBJECT
    return { baseType, isArray: true }
  }
  if (row.fieldType === FieldType.MULTI_SELECT) return { baseType: BaseType.ENUM, isArray: true }
  if (row.fieldType === FieldType.TAGS) return { baseType: BaseType.STRING, isArray: true }
  return { baseType: mapFieldTypeToBaseType(row.fieldType ?? FieldType.TEXT), isArray: false }
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
