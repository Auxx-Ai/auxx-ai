// packages/lib/src/data-connectors/cross-connector-links/__tests__/dispatch.test.ts
// The engine's door: only a ShipStation connector may run the ShipStation pass. Every
// other connector must not reach a single query, because this hook sits in the hot
// finalize path of every sync in the product.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSyncCtx } from '../../__test-helpers'
import type { SyncCtx } from '../../sinks/types'

const h = vi.hoisted(() => ({ shipstation: vi.fn() }))

vi.mock('../shipstation-order-link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shipstation-order-link')>()),
  resolveShipStationOrderLinks: h.shipstation,
}))

import { ok } from 'neverthrow'
import { resolveCrossConnectorLinks } from '../index'

const ctx = (type: string): SyncCtx =>
  makeSyncCtx({ connector: { id: 'dc1', type } as unknown as SyncCtx['connector'] })

beforeEach(() => {
  vi.clearAllMocks()
  h.shipstation.mockResolvedValue(ok({ examined: 3, linked: 3 }))
})

describe('resolveCrossConnectorLinks', () => {
  it('runs the order link pass for a ShipStation connector', async () => {
    const result = await resolveCrossConnectorLinks(ctx('app:shipstation'))

    expect(h.shipstation).toHaveBeenCalledTimes(1)
    expect(result._unsafeUnwrap()).toMatchObject({ linked: 3 })
  })

  it.each([
    'app:shopify',
    'app:quickbooks',
    'generic_rest',
  ])('does nothing for a %s connector', async (type) => {
    const result = await resolveCrossConnectorLinks(ctx(type))

    expect(h.shipstation).not.toHaveBeenCalled()
    expect(result._unsafeUnwrap()).toMatchObject({ examined: 0, linked: 0 })
  })
})
