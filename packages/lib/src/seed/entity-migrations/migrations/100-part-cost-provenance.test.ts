// packages/lib/src/seed/entity-migrations/migrations/100-part-cost-provenance.test.ts
//
// Covers `pruneViewConfigFields`, the one piece of migration 100 with real logic in it
// (plans/parts/cost-provenance-and-stale-values.md §6.4). Everything else the migration
// does is `ensureCustomFields` (already covered by its own helper) and a delete.
//
// The pruning exists because there is NO foreign key from `TableView` to `CustomField`:
// deleting `part_unit_price` leaves its id sitting in user-editable jsonb. Two things make
// that worth a test rather than a one-liner:
//
//  1. **There are two config shapes, not one.** Panel/dialog views store
//     `fieldVisibility`/`fieldOrder`; table/kanban views store
//     `columnVisibility`/`columnOrder`. The plan named only the first pair, and the two
//     known dev rows are one of each — pruning one family would have left the other
//     dangling.
//  2. **A filter group emptied by pruning matches everything.** Dropping the last
//     condition from a group reduces it to the bare org scope, so the group has to go
//     with it. That is the same failure shape as an all-dropped condition set elsewhere
//     in the product, and it is silent.

import { describe, expect, it } from 'vitest'
import { pruneViewConfigFields } from './100-part-cost-provenance'

/** The two spellings the same field can appear under in a stored config. */
const IDS = ['fld_unit_price', 'def_part:fld_unit_price']

describe('pruneViewConfigFields — panel and dialog views', () => {
  it('removes the field from fieldOrder and fieldVisibility', () => {
    const { config, changed } = pruneViewConfigFields(
      {
        fieldOrder: ['def_part:fld_sku', 'def_part:fld_unit_price', 'def_part:fld_cost'],
        fieldVisibility: {
          'def_part:fld_sku': true,
          'def_part:fld_unit_price': true,
          'def_part:fld_cost': true,
        },
        showLabels: true,
      },
      IDS
    )

    expect(changed).toBe(true)
    expect(config).toEqual({
      fieldOrder: ['def_part:fld_sku', 'def_part:fld_cost'],
      fieldVisibility: { 'def_part:fld_sku': true, 'def_part:fld_cost': true },
      showLabels: true,
    })
  })

  it('matches the bare field id as well as the composed resourceFieldId', () => {
    // Which spelling a config holds depends on when and by what it was written.
    const { config, changed } = pruneViewConfigFields(
      { fieldOrder: ['fld_sku', 'fld_unit_price'], fieldVisibility: { fld_unit_price: false } },
      IDS
    )

    expect(changed).toBe(true)
    expect(config).toEqual({ fieldOrder: ['fld_sku'], fieldVisibility: {} })
  })

  it('prunes group membership and unsets an anchor pointing at the deleted field', () => {
    const { config, changed } = pruneViewConfigFields(
      {
        fieldOrder: ['def_part:fld_cost'],
        fieldVisibility: {},
        fieldGroups: [
          {
            id: 'g1',
            label: 'Pricing',
            fieldIds: ['def_part:fld_unit_price', 'def_part:fld_cost'],
            anchorFieldId: 'def_part:fld_unit_price',
          },
        ],
      },
      IDS
    )

    expect(changed).toBe(true)
    const groups = (config as { fieldGroups: Array<Record<string, unknown>> }).fieldGroups
    expect(groups[0]?.fieldIds).toEqual(['def_part:fld_cost'])
    // Unset means "render at the end" — the schema's own fallback.
    expect(groups[0]?.anchorFieldId).toBeUndefined()
  })
})

describe('pruneViewConfigFields — table and kanban views', () => {
  it('removes the field from every column key, not just order and visibility', () => {
    const { config, changed } = pruneViewConfigFields(
      {
        viewType: 'table',
        columnOrder: ['fld_sku', 'fld_unit_price'],
        columnVisibility: { fld_sku: true, fld_unit_price: true },
        columnLabels: { fld_unit_price: 'Unit Price' },
        columnSizing: { fld_unit_price: 120 },
        columnFormatting: { fld_unit_price: { style: 'currency' } },
        columnPinning: { left: ['_checkbox', 'fld_unit_price'], right: [] },
      },
      IDS
    )

    expect(changed).toBe(true)
    expect(config).toEqual({
      viewType: 'table',
      columnOrder: ['fld_sku'],
      columnVisibility: { fld_sku: true },
      columnLabels: {},
      columnSizing: {},
      columnFormatting: {},
      columnPinning: { left: ['_checkbox'], right: [] },
    })
  })

  it('drops a sort on the deleted field', () => {
    const { config, changed } = pruneViewConfigFields(
      {
        sorting: [
          { id: 'fld_unit_price', desc: false },
          { id: 'fld_sku', desc: true },
        ],
      },
      IDS
    )

    expect(changed).toBe(true)
    expect((config as { sorting: unknown[] }).sorting).toEqual([{ id: 'fld_sku', desc: true }])
  })

  it('drops a condition on the deleted field but keeps the rest of its group', () => {
    const { config, changed } = pruneViewConfigFields(
      {
        filters: [
          {
            id: 'g1',
            logicalOperator: 'AND',
            conditions: [
              { id: 'c1', fieldId: 'fld_unit_price', operator: 'gt', value: 0 },
              { id: 'c2', fieldId: 'fld_sku', operator: 'is', value: 'AL400' },
            ],
          },
        ],
      },
      IDS
    )

    expect(changed).toBe(true)
    const groups = (config as { filters: Array<{ conditions: unknown[] }> }).filters
    expect(groups).toHaveLength(1)
    expect(groups[0]?.conditions).toEqual([
      { id: 'c2', fieldId: 'fld_sku', operator: 'is', value: 'AL400' },
    ])
  })

  it('drops a filter group whose every condition referenced the deleted field', () => {
    // Left in place with no conditions, the group reduces to the bare org scope and
    // matches every row — turning a narrow saved view into "everything", silently.
    const { config, changed } = pruneViewConfigFields(
      {
        filters: [
          {
            id: 'g1',
            logicalOperator: 'AND',
            conditions: [{ id: 'c1', fieldId: 'fld_unit_price', operator: 'gt', value: 0 }],
          },
        ],
      },
      IDS
    )

    expect(changed).toBe(true)
    expect((config as { filters: unknown[] }).filters).toEqual([])
  })
})

describe('pruneViewConfigFields — idempotency and tolerance', () => {
  it('reports no change when nothing references the field', () => {
    const original = {
      fieldOrder: ['def_part:fld_sku'],
      fieldVisibility: { 'def_part:fld_sku': true },
    }

    const { config, changed } = pruneViewConfigFields(original, IDS)

    // `changed` is what gates the UPDATE, so a re-run of the migration touches no
    // row and bumps no `updatedAt` — the config it hands back is unchanged either way.
    expect(changed).toBe(false)
    expect(config).toEqual(original)
  })

  it('is a no-op on a config that is not an object', () => {
    expect(pruneViewConfigFields(null, IDS)).toEqual({ config: null, changed: false })
    expect(pruneViewConfigFields('nonsense', IDS)).toEqual({ config: 'nonsense', changed: false })
    expect(pruneViewConfigFields([1, 2], IDS)).toEqual({ config: [1, 2], changed: false })
  })

  it('leaves unmodelled keys untouched', () => {
    // `TableView.config` is jsonb with no DB-level shape, and zod strips unknown keys on
    // read — a pruner that rebuilt the blob from a parsed shape would drop them for real.
    const { config } = pruneViewConfigFields(
      { fieldOrder: ['fld_unit_price'], somethingNobodyModelled: { keep: 'me' } },
      IDS
    )

    expect((config as Record<string, unknown>).somethingNobodyModelled).toEqual({ keep: 'me' })
  })
})
