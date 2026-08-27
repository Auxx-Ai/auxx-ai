// packages/lib/src/resources/hooks/__tests__/line-item-hooks.test.ts
//
// The `line_item_part` stamp (08 §6.2 / §8 "Linking (phase 4)"). The field shipped in
// phase 2 with NOTHING writing it, so these tests pin the four things that made it a
// no-op or a wrong-answer generator:
//
//  1. the hook is reachable through HOOKS_BY_ENTITY_TYPE — an unregistered entity type
//     returns {} silently, which is how `order_number` stayed NULL for three PRs;
//  2. it is keyed on `line_item_catalog_item`, not `line_item_part` — `runPreHooks`
//     skips an update whose registered attribute is absent from `values`, so the wrong
//     key means the stamp never follows a re-point;
//  3. a write that does NOT touch the catalog item leaves the stamp alone — the frozen
//     -stamp assertion that is the whole point of §6.2;
//  4. an explicit part in the same write is the human override and survives.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SystemHookContext } from '../types'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  getValues: vi.fn(),
}))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({ bySystemAttributes: h.bySystemAttributes }),
  }),
}))

vi.mock('../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    getValues = h.getValues
  },
}))

const { LINE_ITEM_HOOKS } = await import('../line-item-hooks')
const { getSystemHooks, getHooksForAttribute } = await import('../system-hooks')

const CATALOG_FIELD_ID = 'fld-line-catalog-item'
const PART_FIELD_ID = 'fld-line-part'
const CATALOG_PART_FIELD_ID = 'fld-catalog-part'

const CATALOG_ITEM = 'defcatalog:instcatalog1'
const PART_A = 'defpart:instparta'
const PART_B = 'defpart:instpartb'

const stamp = LINE_ITEM_HOOKS.line_item_catalog_item![0]!

beforeEach(() => vi.clearAllMocks())

type ContextOverrides = Partial<Record<keyof SystemHookContext, unknown>>

function buildContext(overrides: ContextOverrides = {}): SystemHookContext {
  return {
    operation: 'create',
    entityDef: { id: 'def-line-item', entityType: 'line_item', apiSlug: 'line-items' },
    field: {
      id: CATALOG_FIELD_ID,
      type: 'RELATIONSHIP',
      systemAttribute: 'line_item_catalog_item',
    },
    values: {},
    organizationId: 'org-1',
    userId: 'user-1',
    allFields: [
      { id: CATALOG_FIELD_ID, systemAttribute: 'line_item_catalog_item' },
      { id: PART_FIELD_ID, systemAttribute: 'line_item_part' },
    ],
    ...overrides,
  } as unknown as SystemHookContext
}

/** The catalog item resolves, and carries `part` (or no part when `part` is null). */
function catalogItemHasPart(part: string | null) {
  h.bySystemAttributes.mockResolvedValue({
    catalog_item_part: { id: CATALOG_PART_FIELD_ID, type: 'RELATIONSHIP' },
  })
  h.getValues.mockResolvedValue(
    new Map(part ? [[CATALOG_PART_FIELD_ID, { type: 'relationship', recordId: part }]] : [])
  )
}

describe('line_item_part stamp', () => {
  it('stamps the catalog item’s part on create', async () => {
    catalogItemHasPart(PART_A)

    const values = await stamp(buildContext({ values: { [CATALOG_FIELD_ID]: CATALOG_ITEM } }))

    expect(values[PART_FIELD_ID]).toBe(PART_A)
    expect(h.getValues).toHaveBeenCalledWith({
      recordId: CATALOG_ITEM,
      fieldIds: [CATALOG_PART_FIELD_ID],
    })
  })

  it('reads a systemAttribute-keyed catalog item too', async () => {
    catalogItemHasPart(PART_A)

    const values = await stamp(buildContext({ values: { line_item_catalog_item: CATALOG_ITEM } }))

    expect(values[PART_FIELD_ID]).toBe(PART_A)
  })

  it('unwraps a single-element array relationship value', async () => {
    catalogItemHasPart(PART_A)

    const values = await stamp(buildContext({ values: { [CATALOG_FIELD_ID]: [CATALOG_ITEM] } }))

    expect(values[PART_FIELD_ID]).toBe(PART_A)
  })

  it('stamps nothing on create when the catalog item has no part', async () => {
    catalogItemHasPart(null)

    const values = await stamp(buildContext({ values: { [CATALOG_FIELD_ID]: CATALOG_ITEM } }))

    expect(PART_FIELD_ID in values).toBe(false)
    expect(values).toEqual({ [CATALOG_FIELD_ID]: CATALOG_ITEM })
  })

  it('re-stamps when an update re-points the line at another catalog item', async () => {
    // ⚠️ This only ever runs because the hook is registered under
    // `line_item_catalog_item` — see the registration test below.
    catalogItemHasPart(PART_B)

    const values = await stamp(
      buildContext({
        operation: 'update',
        values: { [CATALOG_FIELD_ID]: CATALOG_ITEM },
        existingInstance: { id: 'inst-line-1' },
      })
    )

    expect(values[PART_FIELD_ID]).toBe(PART_B)
  })

  it('CLEARS the stamp when an update re-points at a catalog item with no part', async () => {
    catalogItemHasPart(null)

    const values = await stamp(
      buildContext({
        operation: 'update',
        values: { [CATALOG_FIELD_ID]: CATALOG_ITEM },
        existingInstance: { id: 'inst-line-1' },
      })
    )

    expect(values[PART_FIELD_ID]).toBeNull()
  })

  it('CLEARS the stamp when an update detaches the catalog item entirely', async () => {
    catalogItemHasPart(PART_A)

    const values = await stamp(
      buildContext({
        operation: 'update',
        values: { [CATALOG_FIELD_ID]: null },
        existingInstance: { id: 'inst-line-1' },
      })
    )

    expect(values[PART_FIELD_ID]).toBeNull()
    expect(h.getValues).not.toHaveBeenCalled()
  })

  it('never overwrites an explicit part set in the same write — the human override', async () => {
    catalogItemHasPart(PART_A)

    const byId = await stamp(
      buildContext({ values: { [CATALOG_FIELD_ID]: CATALOG_ITEM, [PART_FIELD_ID]: PART_B } })
    )
    expect(byId[PART_FIELD_ID]).toBe(PART_B)

    const byAttr = await stamp(
      buildContext({ values: { [CATALOG_FIELD_ID]: CATALOG_ITEM, line_item_part: PART_B } })
    )
    expect(byAttr.line_item_part).toBe(PART_B)
    expect(PART_FIELD_ID in byAttr).toBe(false)

    expect(h.getValues).not.toHaveBeenCalled()
  })

  it('does nothing when the org has no `line_item_part` field yet', async () => {
    catalogItemHasPart(PART_A)

    const values = await stamp(
      buildContext({
        values: { [CATALOG_FIELD_ID]: CATALOG_ITEM },
        allFields: [{ id: CATALOG_FIELD_ID, systemAttribute: 'line_item_catalog_item' }],
      })
    )

    expect(values).toEqual({ [CATALOG_FIELD_ID]: CATALOG_ITEM })
  })

  it('leaves the stamp alone when the catalog item’s part cannot be resolved', async () => {
    // Unmigrated org — `catalog_item_part` does not exist. Collapsing this into "no
    // part" would CLEAR a good stamp.
    h.bySystemAttributes.mockResolvedValue({ catalog_item_part: null })

    const values = await stamp(
      buildContext({
        operation: 'update',
        values: { [CATALOG_FIELD_ID]: CATALOG_ITEM },
        existingInstance: { id: 'inst-line-1' },
      })
    )

    expect(PART_FIELD_ID in values).toBe(false)
  })

  it('does not block the line write when the catalog-item read throws', async () => {
    h.bySystemAttributes.mockRejectedValue(new Error('redis down'))

    const values = await stamp(buildContext({ values: { [CATALOG_FIELD_ID]: CATALOG_ITEM } }))

    expect(values).toEqual({ [CATALOG_FIELD_ID]: CATALOG_ITEM })
  })
})

describe('the stamp is FROZEN (08 §6.2 / §8)', () => {
  // The assertion the whole feature exists for: the three-hop
  // line_item → catalog_item → part chain is LIVE, so re-pointing `catalog_item.part`
  // later must NOT re-attribute an already-stamped historical sale. The hook only ever
  // fires on a `line_item_catalog_item` write, so the observable form of that claim is:
  // a write that does not touch the catalog item leaves `line_item_part` untouched.
  it('a write that does not touch the catalog item leaves line_item_part alone', async () => {
    catalogItemHasPart(PART_B) // catalog_item.part has since moved to PART_B

    const values = await stamp(
      buildContext({
        operation: 'update',
        values: { 'fld-line-qty': 3 },
        existingInstance: { id: 'inst-line-1' },
      })
    )

    expect(values).toEqual({ 'fld-line-qty': 3 })
    expect(h.getValues).not.toHaveBeenCalled()
  })

  it('nothing is written on a create that carries no catalog item at all', async () => {
    catalogItemHasPart(PART_A)

    const values = await stamp(buildContext({ values: { 'fld-line-description': 'labour' } }))

    expect(values).toEqual({ 'fld-line-description': 'labour' })
    expect(h.getValues).not.toHaveBeenCalled()
  })
})

describe('line_item hook registration', () => {
  it('is reachable through the entity-type registry, not just the module export', () => {
    // HOOKS_BY_ENTITY_TYPE returns {} for an unregistered entityType rather than
    // failing — forgetting this entry is a silent no-op (08 status block).
    expect(getSystemHooks('line_item')).toBe(LINE_ITEM_HOOKS)
    expect(Object.keys(getSystemHooks('line_item')).length).toBeGreaterThan(0)
  })

  it('⚠️ is keyed on `line_item_catalog_item`, NOT `line_item_part`', () => {
    // `runPreHooks` skips a hook on UPDATE unless its own registered systemAttribute is
    // present in `values`. Keyed on `line_item_part` this would fire on create only and
    // never follow a re-point, which is half the feature.
    expect(Object.keys(LINE_ITEM_HOOKS)).toEqual(['line_item_catalog_item'])
    expect(getHooksForAttribute('line_item', 'line_item_catalog_item')).toHaveLength(1)
    expect(getHooksForAttribute('line_item', 'line_item_part')).toHaveLength(0)
  })
})

describe('the stamp never moves a total', () => {
  it('line_item_part is not a total trigger', async () => {
    // 08 §2 ⚠️ / §7.2 correction 1: the part is provenance and grouping, never a pricing
    // input. In LINE_TRIGGER_ATTRS it would fire a full document recompute per stamped
    // line for a number that provably did not change — and that set is also the
    // vocabulary the finalize integrity passes match on.
    const { LINE_TRIGGER_ATTRS } = await import('../../../money/totals-hooks')
    expect(LINE_TRIGGER_ATTRS.has('line_item_part')).toBe(false)
    expect(LINE_TRIGGER_ATTRS.has('line_item_catalog_item')).toBe(false)
  })
})
