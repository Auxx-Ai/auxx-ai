// packages/lib/src/money/__tests__/send-email-document-type.test.ts
//
// Regression guard for purchasing plan 07 §2.1 — `documentTypeOf` used to default every
// non-invoice def to `'quote'`, which would have minted a customer-facing approve/decline
// public token for a purchase order sent to a vendor, silently. It now resolves against the
// document-type registry and throws on an unregistered def.

import { toRecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DOCUMENT_TYPE_DESCRIPTORS } from '../../documents/client'
import { BadRequestError } from '../../errors'
import { documentTypeOf } from '../send-email'

const { mockCacheGet } = vi.hoisted(() => ({ mockCacheGet: vi.fn() }))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({ get: mockCacheGet }),
}))

const ORG_ID = 'org_test'

/** entityType slug -> per-org `EntityDefinition.id`, the shape of the `entityDefs` cache. */
const ENTITY_DEFS: Record<string, string> = {
  ...Object.fromEntries(
    DOCUMENT_TYPE_DESCRIPTORS.map((d) => [d.entityType, `def_${d.entityType}`])
  ),
  work_order: 'def_work_order',
  contact: 'def_contact',
}

beforeEach(() => {
  mockCacheGet.mockReset()
  mockCacheGet.mockImplementation(async (_orgId: string, key: string) =>
    key === 'entityDefs' ? ENTITY_DEFS : {}
  )
})

describe('documentTypeOf (purchasing plan 07 §2.1)', () => {
  // Data-driven over the registry rather than a hardcoded quote/invoice pair: adding a
  // document type to `DOCUMENT_TYPE_DESCRIPTORS` must be all that send needs, so a new
  // entry has to be covered here without editing this file.
  describe.each(
    DOCUMENT_TYPE_DESCRIPTORS.map((d) => [d.id, d.entityType] as const)
  )('registered type %s', (id, entityType) => {
    it('resolves the literal entityType slug convention (internal builders)', async () => {
      await expect(documentTypeOf(ORG_ID, toRecordId(entityType, 'inst_1'))).resolves.toBe(id)
    })

    it('resolves the literal slug without touching the org cache', async () => {
      await documentTypeOf(ORG_ID, toRecordId(entityType, 'inst_1'))
      expect(mockCacheGet).not.toHaveBeenCalled()
    })

    it('resolves the EntityDefinition cuid convention (records view / drawer Send)', async () => {
      const defId = ENTITY_DEFS[entityType] as string
      await expect(documentTypeOf(ORG_ID, toRecordId(defId, 'inst_1'))).resolves.toBe(id)
      expect(mockCacheGet).toHaveBeenCalledWith(ORG_ID, 'entityDefs')
    })
  })

  it('still resolves quote and invoice exactly as before (both conventions)', async () => {
    await expect(documentTypeOf(ORG_ID, toRecordId('quote', 'q1'))).resolves.toBe('quote')
    await expect(documentTypeOf(ORG_ID, toRecordId('invoice', 'i1'))).resolves.toBe('invoice')
    await expect(documentTypeOf(ORG_ID, toRecordId('def_quote', 'q1'))).resolves.toBe('quote')
    await expect(documentTypeOf(ORG_ID, toRecordId('def_invoice', 'i1'))).resolves.toBe('invoice')
  })

  it('THROWS on an unregistered def cuid instead of defaulting to quote', async () => {
    // The whole point of the change: under the old if-chain this returned 'quote' and the
    // caller minted a public approve/decline token for it.
    await expect(documentTypeOf(ORG_ID, toRecordId('def_work_order', 'w1'))).rejects.toThrow(
      BadRequestError
    )
  })

  it('THROWS on an unregistered literal entityType slug', async () => {
    await expect(documentTypeOf(ORG_ID, toRecordId('work_order', 'w1'))).rejects.toThrow(
      BadRequestError
    )
  })

  it('names the offending def in the error so the missing registry entry is obvious', async () => {
    await expect(documentTypeOf(ORG_ID, toRecordId('def_work_order', 'w1'))).rejects.toThrow(
      /def_work_order/
    )
  })

  it('THROWS when the def resolves to nothing at all (unknown cuid)', async () => {
    await expect(documentTypeOf(ORG_ID, toRecordId('cuid_nobody_knows', 'x1'))).rejects.toThrow(
      BadRequestError
    )
  })
})
