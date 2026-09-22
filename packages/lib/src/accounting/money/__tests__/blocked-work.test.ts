// packages/lib/src/accounting/money/__tests__/blocked-work.test.ts
//
// The Blocked tab's merge (88 §4.5): two paged reads into one page, newest
// refusal first, with a cursor that resumes each read where it left off.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  movements: [] as Array<{ id: string; blockedAt: Date | null }>,
  shipments: [] as Array<{ id: string; blockedAt: Date | null }>,
  movementCalls: [] as Array<Record<string, unknown>>,
  shipmentCalls: [] as Array<Record<string, unknown>>,
}))

vi.mock('../blocked-movements', () => ({
  listBlockedMovements: async (_db: unknown, _org: string, options: Record<string, unknown>) => {
    h.movementCalls.push(options)
    const offset = (options.offset as number) ?? 0
    return h.movements.slice(offset, offset + (options.limit as number))
  },
  countBlockedMovements: async () => h.movements.length,
}))
vi.mock('../../sales/fulfillments/posting-reads', () => ({
  listBlockedFulfillments: async (_db: unknown, _org: string, options: Record<string, unknown>) => {
    h.shipmentCalls.push(options)
    const offset = (options.offset as number) ?? 0
    return h.shipments.slice(offset, offset + (options.limit as number))
  },
  countBlockedFulfillments: async () => h.shipments.length,
}))

import type { Database } from '@auxx/database'
import { countBlockedWork, listBlockedWork } from '../blocked-work'

const db = {} as Database
const at = (day: number) => new Date(`2026-09-${String(day).padStart(2, '0')}T00:00:00.000Z`)

beforeEach(() => {
  h.movements = []
  h.shipments = []
  h.movementCalls = []
  h.shipmentCalls = []
})

describe('listBlockedWork', () => {
  it('merges both kinds newest refusal first and resumes each read where it stopped', async () => {
    h.movements = [
      { id: 'm1', blockedAt: at(9) },
      { id: 'm2', blockedAt: at(5) },
      { id: 'm3', blockedAt: null },
    ]
    h.shipments = [
      { id: 's1', blockedAt: at(7) },
      { id: 's2', blockedAt: at(6) },
    ]
    const first = await listBlockedWork(db, 'org_1', { limit: 3 })
    expect(first.items.map((row) => `${row.kind}:${row.id}`)).toEqual([
      'movement:m1',
      'shipment:s1',
      'shipment:s2',
    ])
    expect(first.nextCursor).toEqual({ movement: 1, shipment: 2 })

    const second = await listBlockedWork(db, 'org_1', { limit: 3, cursor: first.nextCursor })
    expect(second.items.map((row) => `${row.kind}:${row.id}`)).toEqual([
      'movement:m2',
      'movement:m3',
    ])
    expect(second.nextCursor).toBeUndefined()
  })

  it('reads only the kinds the category filter names', async () => {
    h.movements = [{ id: 'm1', blockedAt: at(1) }]
    h.shipments = [{ id: 's1', blockedAt: at(2) }]

    const shipmentsOnly = await listBlockedWork(db, 'org_1', {
      limit: 10,
      categories: ['fulfillment'],
    })
    expect(shipmentsOnly.items.map((row) => row.id)).toEqual(['s1'])
    expect(h.movementCalls).toHaveLength(0)

    const receiptsOnly = await listBlockedWork(db, 'org_1', {
      limit: 10,
      categories: ['receipt'],
    })
    expect(receiptsOnly.items.map((row) => row.id)).toEqual(['m1'])
    expect(h.movementCalls[0]).toMatchObject({ categories: ['customer_receipt'] })
    expect(h.shipmentCalls).toHaveLength(1)
  })

  it('offers a next page while either read returned a full page', async () => {
    h.movements = [{ id: 'm1', blockedAt: at(1) }]
    h.shipments = [
      { id: 's1', blockedAt: at(3) },
      { id: 's2', blockedAt: at(2) },
    ]
    const page = await listBlockedWork(db, 'org_1', { limit: 2 })
    expect(page.items.map((row) => row.id)).toEqual(['s1', 's2'])
    expect(page.nextCursor).toEqual({ movement: 0, shipment: 2 })
  })
})

describe('countBlockedWork', () => {
  it('is both halves', async () => {
    h.movements = [{ id: 'm1', blockedAt: null }]
    h.shipments = [
      { id: 's1', blockedAt: null },
      { id: 's2', blockedAt: null },
    ]
    expect(await countBlockedWork(db, 'org_1')).toBe(3)
  })
})
