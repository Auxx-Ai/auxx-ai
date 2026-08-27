// packages/lib/src/field-hooks/post/line-item-part-stamp.test.ts
//
// The SECOND door for the 08 §6.2 stamp. The system hook in
// `resources/hooks/line-item-hooks.ts` covers `UnifiedCrudHandler` writes — how the
// LineBuilder ADDS a line. Every EDIT goes through `fieldValue.set` →
// `FieldValueService`, which never reads the system-hook registry, so a re-point
// reaches only this handler.
//
// Verified against the running app before this file existed: re-pointing a line at a
// catalog item with a part left `line_item_part` NULL.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityFieldChangeEvent } from '../types'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  resolveCatalogItemPart: vi.fn(),
  setValueWithType: vi.fn(),
  createFieldValueContext: vi.fn(),
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))
vi.mock('../../resources/hooks/line-item-hooks', () => ({
  resolveCatalogItemPart: h.resolveCatalogItemPart,
}))
vi.mock('../../field-values/field-value-mutations', () => ({
  setValueWithType: h.setValueWithType,
}))
vi.mock('../../field-values/field-value-helpers', () => ({
  createFieldValueContext: h.createFieldValueContext,
}))
vi.mock('../../field-values/stored-field-type', () => ({ toFieldType: () => 'RELATIONSHIP' }))

import { stampPartOnCatalogItemChange } from './line-item-part-stamp'

const LINE = 'linedef:line-1'
const CATALOG_ITEM = 'cidef:ci-1'
const PART = 'partdef:part-1'

function event(overrides: Partial<EntityFieldChangeEvent> = {}): EntityFieldChangeEvent {
  return {
    recordId: LINE,
    entityDefinitionId: 'linedef',
    entityType: 'line_item',
    entitySlug: 'line-items',
    field: { id: 'fld-ci', systemAttribute: 'line_item_catalog_item', type: 'RELATIONSHIP' },
    oldValue: null,
    newValue: [{ type: 'relationship', recordId: CATALOG_ITEM }],
    oldDisplay: null,
    newDisplay: null,
    organizationId: 'org_1',
    userId: 'usr_1',
    ...overrides,
  } as unknown as EntityFieldChangeEvent
}

beforeEach(() => {
  vi.clearAllMocks()
  h.bySystemAttributes.mockResolvedValue({
    line_item_part: { id: 'fld-part', type: 'RELATIONSHIP' },
  })
  h.createFieldValueContext.mockResolvedValue({ organizationId: 'org_1' })
  h.setValueWithType.mockResolvedValue([])
})

describe('stampPartOnCatalogItemChange', () => {
  it('stamps the part when a line is re-pointed at a catalog item that has one', async () => {
    h.resolveCatalogItemPart.mockResolvedValue(PART)

    await stampPartOnCatalogItemChange(event())

    expect(h.setValueWithType).toHaveBeenCalledWith(expect.anything(), {
      recordId: LINE,
      fieldId: 'fld-part',
      fieldType: 'RELATIONSHIP',
      value: { type: 'relationship', recordId: PART },
    })
  })

  it('clears the stamp when the new catalog item has no part', async () => {
    h.resolveCatalogItemPart.mockResolvedValue(null)

    await stampPartOnCatalogItemChange(event())

    expect(h.setValueWithType).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fieldId: 'fld-part', value: null })
    )
  })

  it('clears the stamp when the catalog item is detached entirely', async () => {
    await stampPartOnCatalogItemChange(event({ newValue: null }))

    expect(h.resolveCatalogItemPart).not.toHaveBeenCalled()
    expect(h.setValueWithType).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ value: null })
    )
  })

  it('leaves an existing stamp alone when the part cannot be resolved', async () => {
    // `undefined` = unmigrated org or a transient read failure. Clearing here would
    // wipe good provenance on a Redis blip.
    h.resolveCatalogItemPart.mockResolvedValue(undefined)

    await stampPartOnCatalogItemChange(event())

    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('ignores every field except the catalog item — no recursion on its own write', async () => {
    await stampPartOnCatalogItemChange(
      event({
        field: {
          id: 'fld-part',
          systemAttribute: 'line_item_part',
          type: 'RELATIONSHIP',
        } as never,
      })
    )
    await stampPartOnCatalogItemChange(
      event({
        field: { id: 'fld-qty', systemAttribute: 'line_item_qty', type: 'NUMBER' } as never,
      })
    )

    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('no-ops when the org has no line_item_part field', async () => {
    h.bySystemAttributes.mockResolvedValue({})

    await stampPartOnCatalogItemChange(event())

    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('never fails the line edit that triggered it', async () => {
    h.resolveCatalogItemPart.mockRejectedValue(new Error('redis down'))

    await expect(stampPartOnCatalogItemChange(event())).resolves.toBeUndefined()
  })
})
