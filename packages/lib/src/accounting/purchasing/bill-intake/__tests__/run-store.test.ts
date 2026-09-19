// packages/lib/src/accounting/purchasing/bill-intake/__tests__/run-store.test.ts
//
// The bill intake run store, over a fake Redis. Copies
// `intake/__tests__/draft-store.test.ts`'s harness — the three load-bearing
// properties are the same ones documented there:
//
//   1. 🛑 The org id is IN THE KEY, and that prefix is the ONLY org scope —
//      a run id leaked across orgs must resolve to nothing.
//   2. ⚠️ Every write passes `required: true`.
//   3. Every write re-stamps the TTL.
//
// Plus this store's own two additions: a `needs_vendor` park/resume cycle,
// and a pointer key written only once the run is `created`.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  writes: [] as { key: string; ttl?: number; required?: boolean }[],
  deletes: [] as { key: string; required?: boolean }[],
  failWrite: false,
}))

vi.mock('@auxx/redis', () => ({
  setRedisData: vi.fn(async (key: string, data: unknown, ttl?: number, required?: boolean) => {
    h.writes.push({ key, ttl, required })
    if (h.failWrite) {
      if (required) throw new Error('redis down')
      return null
    }
    h.store.set(key, JSON.parse(JSON.stringify(data)))
    return 'OK'
  }),
  getRedisData: vi.fn(async (key: string) => h.store.get(key) ?? null),
  deleteRedisData: vi.fn(async (key: string, required?: boolean) => {
    h.deletes.push({ key, required })
    return h.store.delete(key) ? 1 : 0
  }),
}))

import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../../../errors'
import {
  billIntakeRunKey,
  billIntakeRunPointerKey,
  createBillIntakeRun,
  discardBillIntakeRun,
  failBillIntakeRun,
  getBillIntakeRun,
  getBillIntakeRunForBill,
  markBillIntakeRunCreated,
  parkBillIntakeRunForVendor,
  resumeBillIntakeRun,
  setBillIntakeRunPhase,
  updateBillIntakeRun,
} from '../run-store'

const INPUT = { assetRef: 'asset:media_1', fileName: 'invoice.pdf', mimeType: 'application/pdf' }

const CANDIDATES = [
  { recordId: 'company:c1' as never, displayName: 'Acme Ltd', secondary: 'acme.com' },
  { recordId: 'company:c2' as never, displayName: 'Acme Industrial', secondary: null },
]

beforeEach(() => {
  h.store = new Map()
  h.writes = []
  h.deletes = []
  h.failWrite = false
})

async function seed(organizationId = 'org_1'): Promise<string> {
  const created = await createBillIntakeRun(organizationId, 'user_1', INPUT)
  return created._unsafeUnwrap().runId
}

describe('the key', () => {
  it('🛑 carries the org id, then the run id', () => {
    expect(billIntakeRunKey('org_1', 'run_1')).toBe('bill-intake:org_1:run_1')
  })

  it('🛑 the pointer key names the bill, not the run', () => {
    expect(billIntakeRunPointerKey('org_1', 'inst_1')).toBe('bill-intake:org_1:bill:inst_1')
  })

  it('🛑 a run id leaked into another org resolves to nothing', async () => {
    const runId = await seed('org_1')

    const theirs = await getBillIntakeRun('org_2', runId)
    expect(theirs._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)

    const write = await setBillIntakeRunPhase('org_2', runId, 'vendor')
    expect(write._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    expect((await getBillIntakeRun('org_1', runId))._unsafeUnwrap().phase).toBeNull()
  })
})

describe('createBillIntakeRun', () => {
  it('opens a reading run the dialog can already poll', async () => {
    const runId = await seed()

    const view = (await getBillIntakeRun('org_1', runId))._unsafeUnwrap()
    expect(view).toMatchObject({
      id: runId,
      status: 'reading',
      phase: null,
      assetRef: 'asset:media_1',
      fileName: 'invoice.pdf',
      mimeType: 'application/pdf',
      vendorRecordId: null,
      vendorCandidates: [],
      purchaseOrderRecordId: null,
      transcription: null,
      proposals: null,
      warnings: [],
      vendorBillInstanceId: null,
      vendorBillLineRecordIds: [],
      existingBillRecordId: null,
      error: null,
    })
  })

  it('carries the vendor and order given at open, when the choose page prefilled them', async () => {
    const created = await createBillIntakeRun('org_1', 'user_1', {
      ...INPUT,
      vendorRecordId: 'company:c1' as never,
      purchaseOrderRecordId: 'purchase_order:po1' as never,
    })
    const runId = created._unsafeUnwrap().runId
    const view = (await getBillIntakeRun('org_1', runId))._unsafeUnwrap()
    expect(view.vendorRecordId).toBe('company:c1')
    expect(view.purchaseOrderRecordId).toBe('purchase_order:po1')
  })

  it('does not leak the storage-only fields into the client contract', async () => {
    const runId = await seed()
    const view = (await getBillIntakeRun('org_1', runId))._unsafeUnwrap()
    expect(view).not.toHaveProperty('organizationId')
    expect(view).not.toHaveProperty('createdById')
  })
})

describe('every write', () => {
  it('⚠️ passes required: true, so a failure is an err rather than a silent no-op', async () => {
    h.failWrite = true

    const created = await createBillIntakeRun('org_1', 'user_1', INPUT)
    expect(created.isErr()).toBe(true)
    expect(h.writes.every((w) => w.required === true)).toBe(true)
  })

  it('re-stamps the TTL so a run under active reading does not expire', async () => {
    const runId = await seed()
    await setBillIntakeRunPhase('org_1', runId, 'document')
    await setBillIntakeRunPhase('org_1', runId, 'lines')

    expect(h.writes.length).toBeGreaterThanOrEqual(3)
    expect(h.writes.every((w) => typeof w.ttl === 'number' && w.ttl > 0)).toBe(true)
  })

  it('refuses a run that is gone, rather than resurrecting it', async () => {
    const result = await setBillIntakeRunPhase('org_1', 'never_existed', 'document')
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    expect(h.writes).toEqual([])
  })
})

describe('phase ticks', () => {
  it('tick the phase without touching status', async () => {
    const runId = await seed()
    await setBillIntakeRunPhase('org_1', runId, 'vendor')

    const view = (await getBillIntakeRun('org_1', runId))._unsafeUnwrap()
    expect(view.phase).toBe('vendor')
    expect(view.status).toBe('reading')
  })
})

describe('park and resume', () => {
  it('parks with candidates, status needs_vendor', async () => {
    const runId = await seed()
    await parkBillIntakeRunForVendor('org_1', runId, CANDIDATES)

    const view = (await getBillIntakeRun('org_1', runId))._unsafeUnwrap()
    expect(view.status).toBe('needs_vendor')
    expect(view.vendorCandidates).toEqual(CANDIDATES)
  })

  it('resume sets the vendor and puts the run back to reading', async () => {
    const runId = await seed()
    await parkBillIntakeRunForVendor('org_1', runId, CANDIDATES)
    await resumeBillIntakeRun('org_1', runId, 'company:c1' as never)

    const view = (await getBillIntakeRun('org_1', runId))._unsafeUnwrap()
    expect(view.status).toBe('reading')
    expect(view.vendorRecordId).toBe('company:c1')
  })

  it('🛑 resume is refused when the run is not parked', async () => {
    const runId = await seed()

    const resumed = await resumeBillIntakeRun('org_1', runId, 'company:c1' as never)
    expect(resumed._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)

    const view = (await getBillIntakeRun('org_1', runId))._unsafeUnwrap()
    expect(view.vendorRecordId).toBeNull()
  })
})

describe('failure', () => {
  it('is shown verbatim, and carries the duplicate pointer when given', async () => {
    const runId = await seed()
    await failBillIntakeRun(
      'org_1',
      runId,
      'Invoice INV-1 from Acme is already BILL-0042',
      'vendor_bill:b1' as never
    )

    const view = (await getBillIntakeRun('org_1', runId))._unsafeUnwrap()
    expect(view.status).toBe('failed')
    expect(view.error).toBe('Invoice INV-1 from Acme is already BILL-0042')
    expect(view.existingBillRecordId).toBe('vendor_bill:b1')
  })
})

describe('created', () => {
  it('sets status, phase, the bill ids, and writes the pointer key', async () => {
    const runId = await seed()
    await markBillIntakeRunCreated('org_1', runId, {
      vendorBillInstanceId: 'inst_1',
      vendorBillRecordId: 'vendor_bill:inst_1' as never,
      vendorBillLineRecordIds: ['vendor_bill_line:l1' as never],
    })

    const view = (await getBillIntakeRun('org_1', runId))._unsafeUnwrap()
    expect(view.status).toBe('created')
    expect(view.phase).toBe('bill')
    expect(view.vendorBillInstanceId).toBe('inst_1')
    expect(view.vendorBillLineRecordIds).toEqual(['vendor_bill_line:l1'])

    const found = (await getBillIntakeRunForBill('org_1', 'inst_1'))._unsafeUnwrap()
    expect(found?.id).toBe(runId)
  })

  it('🛑 refuses a later overwrite once created', async () => {
    const runId = await seed()
    await markBillIntakeRunCreated('org_1', runId, {
      vendorBillInstanceId: 'inst_1',
      vendorBillRecordId: 'vendor_bill:inst_1' as never,
      vendorBillLineRecordIds: [],
    })

    const late = await updateBillIntakeRun('org_1', runId, { error: 'late write' })
    expect(late._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)

    const view = (await getBillIntakeRun('org_1', runId))._unsafeUnwrap()
    expect(view.status).toBe('created')
    expect(view.error).toBeNull()
  })

  it('getBillIntakeRunForBill answers null when there is no run for that bill', async () => {
    const found = await getBillIntakeRunForBill('org_1', 'nope')
    expect(found._unsafeUnwrap()).toBeNull()
  })
})

describe('discard', () => {
  it('deletes the key, and required: true rides on the delete too', async () => {
    const runId = await seed()
    await discardBillIntakeRun('org_1', runId)

    expect(h.deletes).toEqual([{ key: `bill-intake:org_1:${runId}`, required: true }])
    expect((await getBillIntakeRun('org_1', runId)).isErr()).toBe(true)
  })
})

describe('expiry', () => {
  it('an expired key and one that never existed give the same answer', async () => {
    const runId = await seed()
    h.store.clear()

    const expired = await getBillIntakeRun('org_1', runId)
    const never = await getBillIntakeRun('org_1', 'nope')
    expect(expired._unsafeUnwrapErr().message).toBe(never._unsafeUnwrapErr().message)
  })
})
