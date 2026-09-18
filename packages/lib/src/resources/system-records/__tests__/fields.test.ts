// packages/lib/src/resources/system-records/__tests__/fields.test.ts
//
// The def-and-fields resolver every converted module calls first. What matters
// here is the fork: the cache outside a transaction, the transaction's own
// snapshot inside one (the half 36 modules re-implemented without).

import { PgTransaction } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  defId: vi.fn(),
  bySystemAttributes: vi.fn(),
}))

vi.mock('../../../cache', () => ({
  getCachedEntityDefId: h.defId,
  getOrgCache: () => ({
    from: () => ({ bySystemAttributes: h.bySystemAttributes }),
  }),
}))

vi.mock('@auxx/database', async () => ({
  schema: await import('../../../../../database/src/db/schema/index'),
}))

import { UnprocessableEntityError } from '../../../errors'
import { requireSystemFields, systemFieldMap, systemFields } from '../fields'

const ORG = 'org_1'
const ATTRS = ['payment_gateway_name', 'payment_gateway_status'] as const

/** A stand-in that passes `instanceof PgTransaction`, so the snapshot arm runs. */
function transaction(rows: {
  defs?: { id: string }[]
  fields?: { id: string; systemAttribute: string }[]
}) {
  const tx = Object.create(PgTransaction.prototype)
  tx.query = {
    EntityDefinition: { findMany: vi.fn().mockResolvedValue(rows.defs ?? []) },
    CustomField: { findMany: vi.fn().mockResolvedValue(rows.fields ?? []) },
  }
  return tx
}

beforeEach(() => {
  vi.clearAllMocks()
  h.defId.mockResolvedValue('def_pg')
  h.bySystemAttributes.mockResolvedValue({
    payment_gateway_name: { id: 'f_name' },
    payment_gateway_status: null,
  })
})

describe('systemFields', () => {
  it('resolves the def and its fields from the cache', async () => {
    const ctx = await systemFields(undefined, ORG, 'payment_gateway', ATTRS)
    expect(ctx?.defId).toBe('def_pg')
    expect(ctx?.fields.payment_gateway_name?.id).toBe('f_name')
    expect(ctx?.fields.payment_gateway_status).toBeNull()
  })

  it('answers null when the def is missing, and asks for no fields', async () => {
    h.defId.mockResolvedValue(null)
    expect(await systemFields(undefined, ORG, 'payment_gateway', ATTRS)).toBeNull()
    expect(h.bySystemAttributes).not.toHaveBeenCalled()
  })

  it('reads the def from the TRANSACTION, not the cache, inside one', async () => {
    const tx = transaction({ defs: [{ id: 'def_tx' }], fields: [] })
    const ctx = await systemFields(tx, ORG, 'payment_gateway', ATTRS)
    expect(ctx?.defId).toBe('def_tx')
    expect(h.defId).not.toHaveBeenCalled()
    expect(h.bySystemAttributes).not.toHaveBeenCalled()
  })

  it('reads the fields from the transaction snapshot, keyed by attribute', async () => {
    const tx = transaction({
      defs: [{ id: 'def_tx' }],
      fields: [{ id: 'f_tx', systemAttribute: 'payment_gateway_status' }],
    })
    const ctx = await systemFields(tx, ORG, 'payment_gateway', ATTRS)
    expect(ctx?.fields.payment_gateway_status?.id).toBe('f_tx')
    expect(ctx?.fields.payment_gateway_name).toBeNull()
  })

  it('refuses an ambiguous def rather than picking one', async () => {
    const tx = transaction({ defs: [{ id: 'a' }, { id: 'b' }] })
    await expect(systemFields(tx, ORG, 'payment_gateway', ATTRS)).rejects.toBeInstanceOf(
      UnprocessableEntityError
    )
  })

  it('refuses an ambiguous field rather than picking one', async () => {
    const tx = transaction({
      defs: [{ id: 'def_tx' }],
      fields: [
        { id: 'a', systemAttribute: 'payment_gateway_name' },
        { id: 'b', systemAttribute: 'payment_gateway_name' },
      ],
    })
    await expect(systemFieldMap(tx, ORG, ATTRS)).rejects.toBeInstanceOf(UnprocessableEntityError)
  })
})

describe('requireSystemFields', () => {
  it('names the entity type in the refusal', async () => {
    h.defId.mockResolvedValue(null)
    await expect(requireSystemFields(undefined, ORG, 'payment_gateway', ATTRS)).rejects.toThrow(
      /payment_gateway/
    )
  })

  it('returns the context when the def exists', async () => {
    const ctx = await requireSystemFields(undefined, ORG, 'payment_gateway', ATTRS)
    expect(ctx.defId).toBe('def_pg')
  })
})
