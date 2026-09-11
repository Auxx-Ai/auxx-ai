// packages/lib/src/data-connectors/cross-connector-links/__tests__/shipstation-order-link.test.ts
// The ShipStation -> Shopify order link pass, with `./queries` mocked (Drizzle column
// refs are undefined under vitest), so only the decision logic runs.
//
// The point of this pass is that a WRONG FORMAT GUESS PRODUCES ZERO LINKS, NEVER WRONG
// LINKS, so most cases below assert that nothing was written: a UUID never reaches a
// lookup, an unmatched id writes nothing and logs no warning, a too-short prefix is
// refused, and a second run over an already-correct edge is a no-op.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSyncCtx } from '../../__test-helpers'
import type { SyncCtx } from '../../sinks/types'

const h = vi.hoisted(() => ({
  resolveFields: vi.fn(),
  listBindings: vi.fn(),
  readExternalIds: vi.fn(),
  findOrders: vi.fn(),
  readTargets: vi.fn(),
  // Params mirror `UnifiedCrudHandler.update` so `mock.calls[n]` destructures as the
  // real tuple instead of an empty one.
  update: vi.fn(
    async (
      _recordId: string,
      _values: Record<string, unknown>,
      _modes?: Record<string, 'set' | 'add' | 'remove'>,
      _options?: Record<string, unknown>
    ) => ({})
  ),
}))

vi.mock('../queries', () => ({
  SHIPMENT_ORDER_ATTRIBUTE: 'shipment_order',
  resolveShipmentOrderLinkFields: h.resolveFields,
  listShipmentBindings: h.listBindings,
  readExternalShipmentIds: h.readExternalIds,
  findShopifyOrderInstances: h.findOrders,
  readCurrentOrderTargets: h.readTargets,
}))

import {
  parseShopifyOrderIdFromExternalShipmentId,
  resolveShipStationOrderLinks,
} from '../shipstation-order-link'

const ORG = 'org_1'
const SHIPMENT_DEF = 'def_shipment'
const ORDER_DEF = 'def_order'
const EXT_FIELD = 'fld_external_shipment_id'
const ORDER_FIELD = 'fld_shipment_order'
const SHIPMENT = 'inst_shipment_1'
const ORDER = 'inst_order_1'

/** The verified real-data shape: `<shopifyOrderId>-<unknown>`. */
const NUMERIC_PAIR = '7475907559600-8667090518192'
const SHOPIFY_ORDER_ID = '7475907559600'
/** A real value from the reference account, from a different order source. */
const UUID_SHAPED = '029dca61-7961-cd09-5338-3cecd1784ede'

function ctx(): SyncCtx {
  return makeSyncCtx({
    orgId: ORG,
    connector: { id: 'dc1', type: 'app:shipstation' } as unknown as SyncCtx['connector'],
    relationshipCrud: { update: h.update } as unknown as SyncCtx['relationshipCrud'],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.resolveFields.mockResolvedValue({
    shipmentDefId: SHIPMENT_DEF,
    orderDefId: ORDER_DEF,
    externalShipmentIdFieldId: EXT_FIELD,
    orderFieldId: ORDER_FIELD,
  })
  h.listBindings.mockResolvedValue([{ entityInstanceId: SHIPMENT, pinnedFields: [] }])
  h.readExternalIds.mockResolvedValue(new Map([[SHIPMENT, NUMERIC_PAIR]]))
  h.findOrders.mockResolvedValue(new Map([[SHOPIFY_ORDER_ID, ORDER]]))
  h.readTargets.mockResolvedValue(new Map<string, string>())
  h.update.mockResolvedValue({})
})

describe('parseShopifyOrderIdFromExternalShipmentId', () => {
  it('takes the first component of a numeric pair', () => {
    expect(parseShopifyOrderIdFromExternalShipmentId(NUMERIC_PAIR)).toBe(SHOPIFY_ORDER_ID)
  })

  it('refuses a UUID', () => {
    expect(parseShopifyOrderIdFromExternalShipmentId(UUID_SHAPED)).toBeNull()
  })

  it('refuses a numeric first component that is too short', () => {
    expect(parseShopifyOrderIdFromExternalShipmentId('1234567-8667090518192')).toBeNull()
  })

  it('refuses a bare id with no second component', () => {
    // Real value on the reference account. It DOES match a stored order, and is
    // refused anyway: one unverified shape is not evidence for a second one.
    expect(parseShopifyOrderIdFromExternalShipmentId('7439103557808')).toBeNull()
  })

  it('refuses a non-numeric second component, and never reads it', () => {
    expect(parseShopifyOrderIdFromExternalShipmentId('7475907559600-abc')).toBeNull()
  })

  it('refuses a third component', () => {
    expect(parseShopifyOrderIdFromExternalShipmentId('7475907559600-866709-1')).toBeNull()
  })

  it('refuses empty and missing values', () => {
    expect(parseShopifyOrderIdFromExternalShipmentId('')).toBeNull()
    expect(parseShopifyOrderIdFromExternalShipmentId(null)).toBeNull()
    expect(parseShopifyOrderIdFromExternalShipmentId(undefined)).toBeNull()
  })
})

describe('resolveShipStationOrderLinks — the matching case', () => {
  it('links a numeric pair whose first component matches a stored Shopify order', async () => {
    const result = await resolveShipStationOrderLinks(ctx())

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toMatchObject({ examined: 1, linked: 1, unmatched: 0 })
    expect(h.update).toHaveBeenCalledTimes(1)
    const [recordId, values] = h.update.mock.calls[0]!
    expect(recordId).toBe(`${SHIPMENT_DEF}:${SHIPMENT}`)
    expect(values).toEqual({ shipment_order: `${ORDER_DEF}:${ORDER}` })
  })

  it('looks the order up by the FIRST component only', async () => {
    await resolveShipStationOrderLinks(ctx())
    expect(h.findOrders).toHaveBeenCalledWith(expect.anything(), ORG, ORDER_DEF, [SHOPIFY_ORDER_ID])
  })

  it('marks the shipment def touched so the grid refetches', async () => {
    const c = ctx()
    await resolveShipStationOrderLinks(c)
    expect([...c.touchedDefs]).toEqual([SHIPMENT_DEF])
  })
})

describe('resolveShipStationOrderLinks — no match is silent', () => {
  it('writes nothing when the order is not synced yet', async () => {
    h.findOrders.mockResolvedValue(new Map())

    const result = await resolveShipStationOrderLinks(ctx())

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toMatchObject({ examined: 1, unmatched: 1, linked: 0 })
    expect(h.update).not.toHaveBeenCalled()
  })

  it('leaves no retry state behind — a later run re-derives and links', async () => {
    h.findOrders.mockResolvedValue(new Map())
    await resolveShipStationOrderLinks(ctx())

    // The Shopify delta lands; nothing about the shipment changed.
    h.findOrders.mockResolvedValue(new Map([[SHOPIFY_ORDER_ID, ORDER]]))
    const second = await resolveShipStationOrderLinks(ctx())

    expect(second._unsafeUnwrap()).toMatchObject({ linked: 1, unmatched: 0 })
    expect(h.update).toHaveBeenCalledTimes(1)
  })

  it('writes nothing when the id is ambiguous across two Shopify connections', async () => {
    h.findOrders.mockResolvedValue(new Map([[SHOPIFY_ORDER_ID, null]]))

    const result = await resolveShipStationOrderLinks(ctx())

    expect(result._unsafeUnwrap()).toMatchObject({ unmatched: 1, linked: 0 })
    expect(h.update).not.toHaveBeenCalled()
  })
})

describe('resolveShipStationOrderLinks — the shape gate', () => {
  it('skips a UUID without ever attempting a lookup', async () => {
    h.readExternalIds.mockResolvedValue(new Map([[SHIPMENT, UUID_SHAPED]]))

    const result = await resolveShipStationOrderLinks(ctx())

    expect(result._unsafeUnwrap()).toMatchObject({ examined: 1, skippedShape: 1, linked: 0 })
    expect(h.findOrders).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })

  it('skips a first component that is numeric but too short', async () => {
    h.readExternalIds.mockResolvedValue(new Map([[SHIPMENT, '1234567-8667090518192']]))

    const result = await resolveShipStationOrderLinks(ctx())

    expect(result._unsafeUnwrap()).toMatchObject({ skippedShape: 1, linked: 0 })
    expect(h.findOrders).not.toHaveBeenCalled()
  })

  it('counts a shipment with no stored external id separately, and skips it', async () => {
    h.readExternalIds.mockResolvedValue(new Map())

    const result = await resolveShipStationOrderLinks(ctx())

    expect(result._unsafeUnwrap()).toMatchObject({ missingExternalId: 1, skippedShape: 0 })
    expect(h.findOrders).not.toHaveBeenCalled()
  })

  it('still links the qualifying siblings of a skipped value', async () => {
    h.listBindings.mockResolvedValue([
      { entityInstanceId: 'inst_uuid', pinnedFields: [] },
      { entityInstanceId: SHIPMENT, pinnedFields: [] },
    ])
    h.readExternalIds.mockResolvedValue(
      new Map([
        ['inst_uuid', UUID_SHAPED],
        [SHIPMENT, NUMERIC_PAIR],
      ])
    )

    const result = await resolveShipStationOrderLinks(ctx())

    expect(result._unsafeUnwrap()).toMatchObject({ examined: 2, skippedShape: 1, linked: 1 })
    expect(h.update).toHaveBeenCalledTimes(1)
  })
})

describe('resolveShipStationOrderLinks — idempotency', () => {
  it('writes nothing when the edge already points at the right order', async () => {
    h.readTargets.mockResolvedValue(new Map([[`${SHIPMENT}::${ORDER_FIELD}`, ORDER]]))

    const result = await resolveShipStationOrderLinks(ctx())

    expect(result._unsafeUnwrap()).toMatchObject({ alreadyLinked: 1, linked: 0 })
    expect(h.update).not.toHaveBeenCalled()
  })

  it('does not touch the def when every edge is already correct', async () => {
    h.readTargets.mockResolvedValue(new Map([[`${SHIPMENT}::${ORDER_FIELD}`, ORDER]]))

    const c = ctx()
    await resolveShipStationOrderLinks(c)

    expect([...c.touchedDefs]).toEqual([])
  })

  it('rewrites an edge pointing at the WRONG order', async () => {
    h.readTargets.mockResolvedValue(new Map([[`${SHIPMENT}::${ORDER_FIELD}`, 'inst_order_other']]))

    const result = await resolveShipStationOrderLinks(ctx())

    expect(result._unsafeUnwrap()).toMatchObject({ linked: 1, alreadyLinked: 0 })
    expect(h.update).toHaveBeenCalledTimes(1)
  })
})

describe('resolveShipStationOrderLinks — guards', () => {
  it('leaves a field the user paused alone', async () => {
    h.listBindings.mockResolvedValue([{ entityInstanceId: SHIPMENT, pinnedFields: [ORDER_FIELD] }])

    const result = await resolveShipStationOrderLinks(ctx())

    expect(result._unsafeUnwrap()).toMatchObject({ pinned: 1, linked: 0 })
    expect(h.update).not.toHaveBeenCalled()
  })

  it('does nothing when the org has no shipment def, field or order def', async () => {
    h.resolveFields.mockResolvedValue(null)

    const result = await resolveShipStationOrderLinks(ctx())

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toMatchObject({ examined: 0, linked: 0 })
    expect(h.listBindings).not.toHaveBeenCalled()
  })

  it('counts a failed write without throwing, so a later run retries it', async () => {
    h.update.mockRejectedValue(new Error('boom'))

    const result = await resolveShipStationOrderLinks(ctx())

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toMatchObject({ failed: 1, linked: 0 })
  })

  it('returns err rather than throwing when a read blows up', async () => {
    h.listBindings.mockRejectedValue(new Error('db down'))

    const result = await resolveShipStationOrderLinks(ctx())

    expect(result.isErr()).toBe(true)
  })
})
