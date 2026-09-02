// packages/lib/src/purchasing/intake/__tests__/draft-store.test.ts
//
// The draft store, over a fake Redis. Three properties carry the weight, and all
// three replace something a table used to do for free:
//
//   1. 🛑 The org id is IN THE KEY, and that prefix is now the ONLY org scope
//      there is — there is no row predicate to fall back on, so a draft id
//      leaked across orgs must resolve to nothing.
//   2. ⚠️ Every write passes `required: true`. `setRedisData` swallows its
//      errors and returns null otherwise, and a silent no-op would leave the
//      review screen loading forever.
//   3. Every write re-stamps the TTL, so a draft somebody is mid-review on does
//      not expire under them. The TTL itself replaces the sweep job.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  /** Every `setRedisData` call, in order. */
  writes: [] as { key: string; ttl?: number; required?: boolean }[],
  deletes: [] as { key: string; required?: boolean }[],
  /** When set, the next write throws — the `required: true` path. */
  failWrite: false,
}))

vi.mock('@auxx/redis', () => ({
  setRedisData: vi.fn(async (key: string, data: unknown, ttl?: number, required?: boolean) => {
    h.writes.push({ key, ttl, required })
    if (h.failWrite) {
      // What the real client does ONLY when `required` is true; without it the
      // failure is swallowed and the caller is told nothing.
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

import { ConflictError, NotFoundError } from '../../../errors'
import type { IntakeDraftPayload } from '../client'
import {
  createIntakeDraft,
  discardIntakeDraft,
  failIntakeDraft,
  markIntakeDraftCommitted,
  markIntakeDraftReady,
  setIntakeDraftPhase,
  updateIntakeDraftPayload,
} from '../draft-mutations'
import { getIntakeDraft, INTAKE_DRAFT_TTL_SECONDS, intakeDraftKey } from '../draft-queries'

const INPUT = { assetRef: 'asset:media_1', fileName: 'quote.pdf', mimeType: 'application/pdf' }

const PAYLOAD = {
  transcription: {
    vendorName: 'Acme',
    vendorEmail: null,
    vendorPhone: null,
    vendorAddress: null,
    quoteNumber: 'Q-77',
    quoteDate: null,
    validUntil: null,
    currency: 'EUR',
    subtotalText: null,
    shippingText: null,
    taxText: null,
    totalText: null,
    lines: [],
  },
  vendorRecordId: null,
  vendorCandidates: [],
  lines: [],
  currency: 'EUR',
  quoteNumber: 'Q-77',
  quoteDate: null,
  expectedDeliveryDate: null,
  shippingCents: 0,
  taxCents: 0,
} satisfies IntakeDraftPayload

beforeEach(() => {
  h.store = new Map()
  h.writes = []
  h.deletes = []
  h.failWrite = false
})

async function seed(organizationId = 'org_1'): Promise<string> {
  const created = await createIntakeDraft(organizationId, 'user_1', INPUT)
  return created._unsafeUnwrap().draftId
}

describe('the key', () => {
  it('🛑 carries the org id, then the draft id', () => {
    expect(intakeDraftKey('org_1', 'draft_1')).toBe('purchase-intake:org_1:draft_1')
  })

  it('🛑 a draft id leaked into another org resolves to nothing', async () => {
    const draftId = await seed('org_1')

    const theirs = await getIntakeDraft('org_2', draftId)
    expect(theirs._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)

    // And no write from the wrong org can reach it either.
    const write = await setIntakeDraftPhase('org_2', draftId, 'vendor')
    expect(write._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    expect((await getIntakeDraft('org_1', draftId))._unsafeUnwrap().phase).toBeNull()
  })
})

describe('createIntakeDraft', () => {
  it('opens a reading draft the review screen can already fetch', async () => {
    const draftId = await seed()

    const view = (await getIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view).toMatchObject({
      id: draftId,
      status: 'reading',
      phase: null,
      assetRef: 'asset:media_1',
      fileName: 'quote.pdf',
      mimeType: 'application/pdf',
      payload: null,
      error: null,
      purchaseOrderInstanceId: null,
    })
  })

  it('does not leak the storage-only fields into the client contract', async () => {
    const draftId = await seed()
    const view = (await getIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view).not.toHaveProperty('organizationId')
    expect(view).not.toHaveProperty('createdById')
  })
})

describe('every write', () => {
  it('⚠️ passes required: true, so a failure is an err rather than a silent no-op', async () => {
    h.failWrite = true

    const created = await createIntakeDraft('org_1', 'user_1', INPUT)
    expect(created.isErr()).toBe(true)
    expect(h.writes.every((w) => w.required === true)).toBe(true)
  })

  it('re-stamps the TTL so a draft under active review does not expire', async () => {
    const draftId = await seed()
    await setIntakeDraftPhase('org_1', draftId, 'lines')
    await updateIntakeDraftPayload('org_1', draftId, PAYLOAD)

    expect(h.writes).toHaveLength(3)
    expect(h.writes.every((w) => w.ttl === INTAKE_DRAFT_TTL_SECONDS)).toBe(true)
  })

  it('derives its TTL from the temp upload window, not a hardcoded 86400', () => {
    // The draft and the asset it describes must expire together: a draft that
    // outlived its document would render a live table beside a dead preview.
    expect(INTAKE_DRAFT_TTL_SECONDS).toBe(24 * 60 * 60)
  })

  it('refuses a draft that is gone, rather than resurrecting it', async () => {
    const result = await setIntakeDraftPhase('org_1', 'never_existed', 'document')
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    // 🛑 No write attempted — a NotFound must not create the key it just missed.
    expect(h.writes).toEqual([])
  })
})

describe('the lifecycle', () => {
  it('ticks phases without touching the status', async () => {
    const draftId = await seed()
    await setIntakeDraftPhase('org_1', draftId, 'vendor')

    const view = (await getIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view.phase).toBe('vendor')
    expect(view.status).toBe('reading')
  })

  it('a payload save never promotes a reading draft', async () => {
    const draftId = await seed()
    await updateIntakeDraftPayload('org_1', draftId, PAYLOAD)

    expect((await getIntakeDraft('org_1', draftId))._unsafeUnwrap().status).toBe('reading')
  })

  it('ready carries the proposal and clears any earlier error', async () => {
    const draftId = await seed()
    await failIntakeDraft('org_1', draftId, 'the model could not read it')
    await markIntakeDraftReady('org_1', draftId, PAYLOAD)

    const view = (await getIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view.status).toBe('ready')
    expect(view.phase).toBe('draft')
    expect(view.error).toBeNull()
    expect(view.payload).toEqual(PAYLOAD)
  })

  it('a failure is shown verbatim on the dialog', async () => {
    const draftId = await seed()
    await failIntakeDraft('org_1', draftId, 'Pick another default model.')

    const view = (await getIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view.status).toBe('failed')
    expect(view.error).toBe('Pick another default model.')
  })

  it('🛑 refuses to write over a committed draft', async () => {
    const draftId = await seed()
    await markIntakeDraftReady('org_1', draftId, PAYLOAD)
    await markIntakeDraftCommitted('org_1', draftId, 'inst_1')

    const late = await updateIntakeDraftPayload('org_1', draftId, PAYLOAD)
    expect(late._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)

    const view = (await getIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view.status).toBe('committed')
    expect(view.purchaseOrderInstanceId).toBe('inst_1')
  })

  it('discard deletes the key, and required: true rides on the delete too', async () => {
    const draftId = await seed()
    await discardIntakeDraft('org_1', draftId)

    expect(h.deletes).toEqual([{ key: `purchase-intake:org_1:${draftId}`, required: true }])
    expect((await getIntakeDraft('org_1', draftId)).isErr()).toBe(true)
  })

  it('an expired key and one that never existed give the same answer', async () => {
    const draftId = await seed()
    h.store.clear() // what the TTL does

    const expired = await getIntakeDraft('org_1', draftId)
    const never = await getIntakeDraft('org_1', 'nope')
    expect(expired._unsafeUnwrapErr().message).toBe(never._unsafeUnwrapErr().message)
  })
})
