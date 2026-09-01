// packages/lib/src/builds/__tests__/absorption-override-fields.test.ts
//
// The REGISTRY contract for the two per-part absorption overrides
// (plans/money/tasks/22-per-part-absorption.md §2).
//
// These assertions look like they are testing a config object, and they are —
// but every one of them is a behaviour somebody depends on and none of them is
// visible at the call site. `creatable` is what puts a column in the import
// picker, `updatable` is what lets a second import pass revise it, `hidden`
// would remove it from import entirely, and an omitted `showInTable` silently
// resolves to `showInPanel !== false`.

import { describe, expect, it } from 'vitest'
import { getImportableFields } from '../../import/fields/get-importable-fields'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import type { Resource } from '../../resources/registry/types'

const LABOR = PART_FIELDS.laborCostPerUnit
const OVERHEAD = PART_FIELDS.overheadCostPerUnit

describe('per-part absorption override fields', () => {
  it('declares both fields on the part registry', () => {
    expect(LABOR?.systemAttribute).toBe('part_labor_cost_per_unit')
    expect(OVERHEAD?.systemAttribute).toBe('part_overhead_cost_per_unit')
  })

  // 🛑 The importability contract. `getImportableFields` filters on
  // `creatable && !hidden && !relationship` and never reads `updatable`; the
  // CRUD layer enforces `updatable` on the write. Both are needed and they do
  // different jobs — one to be offered a column, one so a re-import can revise
  // the value rather than have it silently dropped.
  it('is creatable AND updatable, and never `hidden`', () => {
    for (const field of [LABOR, OVERHEAD]) {
      expect(field?.capabilities.creatable).toBe(true)
      expect(field?.capabilities.updatable).toBe(true)
      expect(field?.capabilities.hidden).toBeFalsy()
      // Not `computed` — that is the flag the five frozen `part_standard_*`
      // fields carry, and it is what keeps every writer but the roll out.
      expect(field?.capabilities.computed).toBeFalsy()
    }
  })

  it('actually reaches the import column picker', () => {
    const resource = { fields: [LABOR, OVERHEAD] } as unknown as Resource
    const keys = getImportableFields(resource).map((f) => f.key)

    expect(keys).toContain('part_labor_cost_per_unit')
    expect(keys).toContain('part_overhead_cost_per_unit')
  })

  // The frozen block stays locked. If this ever flips, an import could write a
  // standard cost directly and the roll would stop being its only writer.
  it('leaves the frozen standard-cost fields uncreatable', () => {
    const resource = {
      fields: [
        PART_FIELDS.standardLaborCost,
        PART_FIELDS.standardOverheadCost,
        PART_FIELDS.standardCost,
      ],
    } as unknown as Resource

    expect(getImportableFields(resource)).toHaveLength(0)
  })

  // 🛑 `showInTable` unset resolves to `showInPanel !== false`, so omitting both
  // would add two mostly-empty currency columns to every org's parts list.
  it('is hidden from the panel and from the default table, explicitly', () => {
    for (const field of [LABOR, OVERHEAD]) {
      expect(field?.showInPanel).toBe(false)
      expect(field?.showInTable).toBe(false)
      expect(field?.showInDialogs).toBe(false)
    }
  })

  // Migration 116 names its payload by registry KEY. A rename would make it
  // throw rather than quietly create one field fewer than it claims to, but
  // this fails first and says which key moved.
  it('keeps the keys migration 116 names', () => {
    expect(Object.keys(PART_FIELDS)).toEqual(
      expect.arrayContaining(['laborCostPerUnit', 'overheadCostPerUnit'])
    )
  })
})
