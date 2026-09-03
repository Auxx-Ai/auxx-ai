// packages/lib/src/field-values/__tests__/cell-sync-state-read.test.ts

/**
 * The batch read path emits a per-cell `sync` state beside the value
 * (plans/money/tasks/40-per-field-sync-pin.md sections 4 D2 and 7): the
 * records' live `DataConnectorItem`s are read BESIDE the value query and
 * collapsed with the row marker through `resolveCellSyncState`, in the D2
 * order paused > synced > edited > none. A cell with no stored row has nothing
 * to ride on, so the path emits a value-less result for it whenever it is
 * paused or edited (task 42 §3: a cleared overwrite cell is healed like any
 * other drift), and the item read is one call per batch whether or not anything
 * is bound.
 *
 * NOTE on imports: `field-value-helpers` is imported for its TYPES only; see
 * the cache mock below for why the double sits under the barrel.
 */

import { toResourceFieldId } from '@auxx/types/field'
import { toRecordId } from '@auxx/types/resource'

const { findCachedResource, getCachedUserInstanceGrants, listItemBindingsForInstances } =
  vi.hoisted(() => ({
    findCachedResource: vi.fn(),
    getCachedUserInstanceGrants: vi.fn(),
    listItemBindingsForInstances: vi.fn(),
  }))

// Mock the cache at the module that DEFINES `findCachedResource`, not the
// barrel: `field-value-helpers` sits inside the real barrel's own import graph,
// so a barrel mock leaves its `validateFieldReferences` /
// `getFieldInfoFromRegistry` bound to the real, DB-backed function (see the
// note in `name-compose-on-read.test.ts`). The barrel re-exports from here, so
// every importer sees the double.
vi.mock('../../cache/org-cache-helpers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findCachedResource,
}))
vi.mock('../../cache/user-cache-helpers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCachedUserInstanceGrants,
}))
// The item read is the one query this path adds; the fake db below only
// answers the value query, so the bindings come from here.
vi.mock('../../data-connectors/item-bindings', () => ({ listItemBindingsForInstances }))

import type { InstanceConnectorBinding } from '../../data-connectors/sync-state'
import type { FieldValueContext } from '../field-value-helpers'
import { batchGetValues } from '../field-value-queries'
import type { TypedFieldValueResult } from '../types'

const ORG = 'org_1'
const DEF = 'def_product'
const P1_ID = 'prd_1'
const P2_ID = 'prd_2'
const P1 = toRecordId(DEF, P1_ID)
const P2 = toRecordId(DEF, P2_ID)

const SHOPIFY = 'dc_shopify'
const OTHER = 'dc_other'

/** Field ids as the FieldValue rows store them (concrete `CustomField.id`s). */
const DESCRIPTION = 'fld_description'
const SKU = 'fld_sku'
const NOTES = 'fld_notes'
const ALIASES = 'fld_aliases'
const TITLE = 'fld_title'

const ref = (fieldId: string) => `${DEF}:${fieldId}`

const PRODUCT_RESOURCE = {
  id: DEF,
  fields: [
    { id: DESCRIPTION, key: 'description', fieldType: 'TEXT', options: {} },
    { id: SKU, key: 'sku', fieldType: 'TEXT', options: {} },
    { id: NOTES, key: 'notes', fieldType: 'TEXT', options: {} },
    { id: ALIASES, key: 'aliases', fieldType: 'TEXT', options: { multi: true } },
    { id: TITLE, key: 'title', fieldType: 'TEXT', options: {} },
  ],
}

/**
 * One Shopify product mapping as the read path loads it: `description` and
 * `aliases` overwrite, `sku` is the identity, `notes` only fills blanks.
 * `title` is not bound at all.
 */
function shopifyItem(overrides: Partial<InstanceConnectorBinding> = {}): InstanceConnectorBinding {
  return {
    connectorId: SHOPIFY,
    managedFields: [ref(DESCRIPTION), ref(SKU), ref(NOTES), ref(ALIASES)],
    pinnedFields: [],
    bindings: [
      { targetFieldRef: ref(DESCRIPTION), mergeStrategy: 'overwrite' },
      { targetFieldRef: ref(SKU), identityRole: { kind: 'externalId' } },
      { targetFieldRef: ref(NOTES), mergeStrategy: 'fill_blank' },
      { targetFieldRef: ref(ALIASES), mergeStrategy: 'overwrite' },
    ],
    ...overrides,
  }
}

/** Rows are whatever `orderBy` resolves to; the builder shape is not asserted. */
function fakeDb(rows: unknown[]): FieldValueContext['db'] {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'from', 'innerJoin', 'where']) {
    chain[method] = () => chain
  }
  chain.orderBy = () => Promise.resolve(rows)
  return chain as unknown as FieldValueContext['db']
}

function context(db: FieldValueContext['db']): FieldValueContext {
  return {
    db,
    organizationId: ORG,
    fieldCache: new Map(),
    batchRelationshipValidationCache: new Map(),
    validator: {} as FieldValueContext['validator'],
    bypassFieldGuards: new Set(),
  }
}

/** A stored TEXT row as the batch query projects it. */
function textRow(
  entityId: string,
  fieldId: string,
  value: string,
  managedByConnectorId: string | null = null,
  sortKey = 'a0'
) {
  return {
    id: `fv_${entityId}_${fieldId}_${sortKey}`,
    entityId,
    fieldId,
    sortKey,
    valueText: value,
    valueJson: null,
    aiStatus: null,
    managedByConnectorId,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  }
}

function bound(entries: Array<[string, InstanceConnectorBinding[]]>) {
  listItemBindingsForInstances.mockResolvedValue(new Map(entries))
}

async function read(rows: unknown[], recordIds = [P1], fieldIds = [DESCRIPTION]) {
  const db = fakeDb(rows)
  const result = await batchGetValues(context(db), {
    recordIds,
    fieldReferences: fieldIds.map((fieldId) => toResourceFieldId(DEF, fieldId)),
  })
  return { db, values: result.values }
}

function cell(values: TypedFieldValueResult[], recordId: string, fieldId: string) {
  return values.find((v) => v.recordId === recordId && v.fieldRef === ref(fieldId))
}

beforeEach(() => {
  findCachedResource.mockReset().mockImplementation(async (_org: string, key: string) => {
    return key === DEF ? PRODUCT_RESOURCE : null
  })
  getCachedUserInstanceGrants.mockReset().mockResolvedValue({ userId: 'user_1' })
  listItemBindingsForInstances.mockReset().mockResolvedValue(new Map())
})

describe('batchGetValues, the four D2 states', () => {
  it('synced: a row stamped by the connector', async () => {
    bound([[P1_ID, [shopifyItem()]]])
    const { values } = await read([textRow(P1_ID, DESCRIPTION, 'From Shopify', SHOPIFY)])

    const c = cell(values, P1, DESCRIPTION)
    expect(c?.sync).toEqual({ connectorId: SHOPIFY, state: 'synced', willOverwrite: true })
    // Still on the wire for one release.
    expect(c?.managedByConnectorId).toBe(SHOPIFY)
    expect(c?.value).toMatchObject({ type: 'text', value: 'From Shopify' })
  })

  it('edited: no marker, but the overwrite binding will heal the cell', async () => {
    bound([[P1_ID, [shopifyItem()]]])
    const { values } = await read([textRow(P1_ID, DESCRIPTION, 'My own words', null)])

    const c = cell(values, P1, DESCRIPTION)
    expect(c?.sync).toEqual({ connectorId: SHOPIFY, state: 'edited', willOverwrite: true })
    expect(c?.managedByConnectorId).toBeNull()
  })

  it('paused: the item pins the field, and the marker does not matter', async () => {
    bound([[P1_ID, [shopifyItem({ pinnedFields: [DESCRIPTION] })]]])
    const { values } = await read([textRow(P1_ID, DESCRIPTION, 'From Shopify', SHOPIFY)])

    expect(cell(values, P1, DESCRIPTION)?.sync).toEqual({
      connectorId: SHOPIFY,
      state: 'paused',
      willOverwrite: true,
    })
  })

  it('none: a field the connector does not bind', async () => {
    bound([[P1_ID, [shopifyItem()]]])
    const { values } = await read([textRow(P1_ID, TITLE, 'Hand-made title')], [P1], [TITLE])

    const c = cell(values, P1, TITLE)
    expect(c).toBeDefined()
    expect(c?.sync).toBeNull()
  })
})

describe('batchGetValues, the edited rule is exactly what drift heals', () => {
  it('an identity field with no marker is not edited', async () => {
    bound([[P1_ID, [shopifyItem()]]])
    const { values } = await read([textRow(P1_ID, SKU, 'SKU-1')], [P1], [SKU])

    expect(cell(values, P1, SKU)?.sync).toBeNull()
  })

  it('a fill_blank field with no marker is not edited', async () => {
    bound([[P1_ID, [shopifyItem()]]])
    const { values } = await read([textRow(P1_ID, NOTES, 'Typed by hand')], [P1], [NOTES])

    expect(cell(values, P1, NOTES)?.sync).toBeNull()
  })

  it('a multi field with no marker is not edited, and synced with no overwrite', async () => {
    bound([[P1_ID, [shopifyItem()]]])
    const { values } = await read(
      [
        textRow(P1_ID, ALIASES, 'user alias', null, 'a0'),
        textRow(P1_ID, ALIASES, 'shopify alias', SHOPIFY, 'a1'),
      ],
      [P1],
      [ALIASES]
    )

    const c = cell(values, P1, ALIASES)
    // Any row's marker wins for a multi field; row-level writes never re-assert.
    expect(c?.sync).toEqual({ connectorId: SHOPIFY, state: 'synced', willOverwrite: false })
    expect(Array.isArray(c?.value)).toBe(true)

    const { values: unmarked } = await read(
      [textRow(P1_ID, ALIASES, 'user alias', null)],
      [P1],
      [ALIASES]
    )
    expect(cell(unmarked, P1, ALIASES)?.sync).toBeNull()
  })

  it("a marker with no item behind it is still synced (the sink's stamp is the truth)", async () => {
    bound([])
    const { values } = await read([textRow(P1_ID, DESCRIPTION, 'From Shopify', SHOPIFY)])

    expect(cell(values, P1, DESCRIPTION)?.sync).toEqual({
      connectorId: SHOPIFY,
      state: 'synced',
      willOverwrite: false,
    })
  })
})

describe('batchGetValues, several connectors and items on one record', () => {
  it("a pin beats another connector's marker and names the pinning connector", async () => {
    bound([[P1_ID, [shopifyItem({ pinnedFields: [DESCRIPTION] })]]])
    const { values } = await read([textRow(P1_ID, DESCRIPTION, 'From elsewhere', OTHER)])

    const c = cell(values, P1, DESCRIPTION)
    expect(c?.sync).toMatchObject({ connectorId: SHOPIFY, state: 'paused' })
    expect(c?.managedByConnectorId).toBe(OTHER)
  })

  it('two items of one connector on one instance union their lists', async () => {
    // One mapping binds the description (unpinned); the other, say a
    // `order.line_item` stream, only pins the notes.
    const customerStream = shopifyItem()
    const orderStream = shopifyItem({
      managedFields: [ref(NOTES)],
      pinnedFields: [NOTES],
      bindings: [{ targetFieldRef: ref(NOTES), mergeStrategy: 'fill_blank' }],
    })
    bound([[P1_ID, [customerStream, orderStream]]])
    const { values } = await read(
      [textRow(P1_ID, DESCRIPTION, 'My own words'), textRow(P1_ID, NOTES, 'Keep these')],
      [P1],
      [DESCRIPTION, NOTES]
    )

    expect(cell(values, P1, DESCRIPTION)?.sync).toEqual({
      connectorId: SHOPIFY,
      state: 'edited',
      willOverwrite: true,
    })
    expect(cell(values, P1, NOTES)?.sync).toEqual({
      connectorId: SHOPIFY,
      state: 'paused',
      willOverwrite: false,
    })
  })
})

describe('batchGetValues, cells with no stored row', () => {
  it('a paused empty cell still reaches the badge as a value-less result', async () => {
    bound([[P1_ID, [shopifyItem({ pinnedFields: [DESCRIPTION] })]]])
    const { values } = await read([], [P1], [DESCRIPTION, TITLE])

    const c = cell(values, P1, DESCRIPTION)
    expect(c).toEqual({
      recordId: P1,
      fieldRef: ref(DESCRIPTION),
      value: null,
      fieldType: 'TEXT',
      fieldOptions: {},
      aiStatus: null,
      aiMetadata: null,
      managedByConnectorId: null,
      sync: { connectorId: SHOPIFY, state: 'paused', willOverwrite: true },
    })
    // The unbound, row-less cell stays silent: the client null-backfills it.
    expect(cell(values, P1, TITLE)).toBeUndefined()
  })

  it('an emptied overwrite cell reaches the badge as edited (drift heals a cleared row, task 42)', async () => {
    bound([[P1_ID, [shopifyItem()]]])
    const { values } = await read([], [P1], [DESCRIPTION])

    expect(cell(values, P1, DESCRIPTION)?.sync).toEqual({
      connectorId: SHOPIFY,
      state: 'edited',
      willOverwrite: true,
    })
    expect(cell(values, P1, DESCRIPTION)?.value).toBeNull()
  })

  it('an emptied cell whose binding never heals (fill_blank) stays silent', async () => {
    bound([[P1_ID, [shopifyItem()]]])
    const { values } = await read([], [P1], [NOTES])

    expect(values).toEqual([])
  })

  it('a pin on one record does not invent cells on another', async () => {
    bound([[P1_ID, [shopifyItem({ pinnedFields: [DESCRIPTION] })]]])
    const { values } = await read([], [P1, P2], [DESCRIPTION])

    expect(values.map((v) => v.recordId)).toEqual([P1])
  })
})

describe('batchGetValues, the item read', () => {
  it('is issued once per batch, beside the value query, and yields null when nothing is bound', async () => {
    bound([])
    const { db, values } = await read(
      [textRow(P1_ID, DESCRIPTION, 'a'), textRow(P2_ID, DESCRIPTION, 'b')],
      [P1, P2],
      [DESCRIPTION, TITLE]
    )

    expect(listItemBindingsForInstances).toHaveBeenCalledTimes(1)
    expect(listItemBindingsForInstances).toHaveBeenCalledWith(db, ORG, [P1_ID, P2_ID])
    expect(values).toHaveLength(2)
    for (const v of values) expect(v.sync).toBeNull()
  })
})
