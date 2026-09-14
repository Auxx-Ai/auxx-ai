// packages/lib/src/returns/intake/__tests__/draft.test.ts
//
// The return-intake draft store, over a fake Redis. Four properties carry the
// weight, and the first three replace something a table used to do for free:
//
//   1. 🛑 The org id is IN THE KEY, and that prefix is now the ONLY org scope
//      there is — there is no row predicate to fall back on, so a draft id
//      leaked across orgs must resolve to nothing.
//   2. ⚠️ Every write passes `required: true`. `setRedisData` swallows its
//      errors and returns null otherwise, and a silent no-op would leave the
//      review screen loading forever.
//   3. Every write re-stamps the TTL, so a dock review of twenty labels does not
//      expire under the person doing it. The TTL itself replaces the sweep job.
//   4. ⚠️ Per-label writes land immediately, never batched — §6.2. A run that
//      dies on label nine must leave eight transcriptions behind.

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

import type { RecordId } from '@auxx/types/resource'
import { ConflictError, NotFoundError } from '../../../errors'
import { EMPTY_TRANSCRIBED_LABEL, type TranscribedLabel } from '../client'
import {
  bestTierOf,
  confirmReturnIntakeLabel,
  createReturnIntakeDraft,
  discardReturnIntakeDraft,
  failReturnIntakeDraft,
  markReturnIntakeDraftReady,
  patchReturnIntakeLabelTranscription,
  recordReturnIntakeCommit,
  recordReturnIntakeLabelCandidates,
  recordReturnIntakeLabelRead,
  setReturnIntakeDraftPhase,
  setReturnIntakeOrderOptions,
} from '../draft-mutations'
import {
  getReturnIntakeDraft,
  RETURN_INTAKE_DRAFT_TTL_SECONDS,
  returnIntakeDraftKey,
} from '../draft-queries'

const INPUT = {
  labels: [
    { fileRef: 'asset:media_1', fileName: 'label-1.jpg' },
    { fileRef: 'asset:media_2', fileName: 'label-2.jpg' },
  ],
}

const READ: TranscribedLabel = {
  ...EMPTY_TRANSCRIBED_LABEL,
  senderName: 'Jane Doe',
  senderStreet1: '12 Dock Road',
  senderCity: 'Leeds',
  carrier: 'ups',
  trackingNumber: '1Z999',
  legible: true,
}

const CONTACT = 'def_contact:contact_1' as RecordId
const ORDER = 'def_order:order_1' as RecordId

beforeEach(() => {
  h.store = new Map()
  h.writes = []
  h.deletes = []
  h.failWrite = false
})

async function seed(organizationId = 'org_1'): Promise<string> {
  const created = await createReturnIntakeDraft(organizationId, 'user_1', INPUT)
  return created._unsafeUnwrap().draftId
}

async function labelIds(organizationId: string, draftId: string): Promise<string[]> {
  const view = (await getReturnIntakeDraft(organizationId, draftId))._unsafeUnwrap()
  return view.payload.labels.map((label) => label.id)
}

describe('the key', () => {
  it('🛑 carries the org id, then the draft id', () => {
    expect(returnIntakeDraftKey('org_1', 'draft_1')).toBe('return-intake:org_1:draft_1')
  })

  it('🛑 has no colon of its own, so the job id splits into exactly three segments', () => {
    // BullMQ rejects a custom job id containing `:` unless it splits into three.
    expect(`returnIntake:org_1:draft_1`.split(':')).toHaveLength(3)
  })

  it('🛑 a draft id leaked into another org resolves to nothing', async () => {
    const draftId = await seed('org_1')

    const theirs = await getReturnIntakeDraft('org_2', draftId)
    expect(theirs._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)

    // And no write from the wrong org can reach it either.
    const write = await setReturnIntakeDraftPhase('org_2', draftId, 'matching')
    expect(write._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    expect((await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap().phase).toBe('reading')
  })
})

describe('createReturnIntakeDraft', () => {
  it('opens a reading draft with one slot per photographed label', async () => {
    const draftId = await seed()

    const view = (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view).toMatchObject({
      id: draftId,
      status: 'reading',
      phase: 'reading',
      labelsRead: 0,
      labelsTotal: 2,
      failureReason: null,
    })
    expect(view.payload.labels).toHaveLength(2)
    expect(view.payload.labels[0]).toMatchObject({
      fileRef: 'asset:media_1',
      fileName: 'label-1.jpg',
      transcription: null,
      candidates: [],
      bestTier: 'none',
      confirmedContactRecordId: null,
      confirmedUnidentified: false,
    })
  })

  it('knows labelsTotal the moment the upload closes, so the dialog can say n of m', async () => {
    const draftId = await seed()
    expect((await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap().labelsTotal).toBe(2)
  })

  it('gives each label its own id, tying the photo to the answer', async () => {
    const ids = await labelIds('org_1', await seed())
    expect(new Set(ids).size).toBe(2)
  })

  it('does not leak the storage-only fields into the client contract', async () => {
    const draftId = await seed()
    const view = (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view).not.toHaveProperty('organizationId')
    expect(view).not.toHaveProperty('createdById')
  })
})

describe('every write', () => {
  it('⚠️ passes required: true, so a failure is an err rather than a silent no-op', async () => {
    h.failWrite = true

    const created = await createReturnIntakeDraft('org_1', 'user_1', INPUT)
    expect(created.isErr()).toBe(true)
    expect(h.writes.every((w) => w.required === true)).toBe(true)
  })

  it('re-stamps the TTL so a draft under active review does not expire', async () => {
    const draftId = await seed()
    const [first] = await labelIds('org_1', draftId)
    await setReturnIntakeDraftPhase('org_1', draftId, 'matching')
    await recordReturnIntakeLabelRead('org_1', draftId, first as string, { transcription: READ })

    expect(h.writes).toHaveLength(3)
    expect(h.writes.every((w) => w.ttl === RETURN_INTAKE_DRAFT_TTL_SECONDS)).toBe(true)
  })

  it('derives its TTL from the temp upload window, not a hardcoded 86400', () => {
    // The draft and the photos it describes must expire together: a draft that
    // outlived its photos is live transcriptions beside dead image panes, and
    // checking one against the other is the whole job of the review screen.
    expect(RETURN_INTAKE_DRAFT_TTL_SECONDS).toBe(24 * 60 * 60)
  })

  it('refuses a draft that is gone, rather than resurrecting it', async () => {
    const result = await setReturnIntakeDraftPhase('org_1', 'never_existed', 'matching')
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    // 🛑 No write attempted — a NotFound must not create the key it just missed.
    expect(h.writes).toEqual([])
  })

  it('refuses a label that is not part of this drop', async () => {
    const draftId = await seed()
    const result = await recordReturnIntakeLabelRead('org_1', draftId, 'nope', {
      transcription: READ,
    })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })
})

describe('the read, label by label', () => {
  it('⚠️ lands one label immediately, leaving the others untouched', async () => {
    const draftId = await seed()
    const [first, second] = await labelIds('org_1', draftId)

    await recordReturnIntakeLabelRead('org_1', draftId, first as string, { transcription: READ })

    const view = (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view.payload.labels[0]?.transcription).toEqual(READ)
    expect(view.payload.labels[1]?.transcription).toBeNull()
    expect(view.payload.labels[1]?.id).toBe(second)
    // The dialog's n-of-m ticks on the write, not at the end of the run.
    expect(view.labelsRead).toBe(1)
    expect(view.status).toBe('reading')
  })

  it('⚠️ ticks labelsRead for a FAILED label too, so the dialog cannot stall', async () => {
    const draftId = await seed()
    const [first] = await labelIds('org_1', draftId)

    await recordReturnIntakeLabelRead('org_1', draftId, first as string, {
      error: 'the provider refused this HEIC',
    })

    const view = (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view.labelsRead).toBe(1)
    expect(view.payload.labels[0]?.error).toBe('the provider refused this HEIC')
    expect(view.payload.labels[0]?.transcription).toBeNull()
  })

  it('🛑 one label failing leaves the other nine readable', async () => {
    const draftId = await seed()
    const [first, second] = await labelIds('org_1', draftId)

    await recordReturnIntakeLabelRead('org_1', draftId, first as string, { error: 'timeout' })
    await recordReturnIntakeLabelRead('org_1', draftId, second as string, { transcription: READ })

    const view = (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view.labelsRead).toBe(2)
    expect(view.payload.labels[1]?.transcription).toEqual(READ)
  })

  it('never ticks labelsRead past labelsTotal, however many times a retry lands', async () => {
    const draftId = await seed()
    const [first] = await labelIds('org_1', draftId)

    for (let i = 0; i < 5; i += 1) {
      await recordReturnIntakeLabelRead('org_1', draftId, first as string, { transcription: READ })
    }

    expect((await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap().labelsRead).toBe(2)
  })
})

describe('typing the label in by hand (§4.6)', () => {
  const ILLEGIBLE: TranscribedLabel = { ...EMPTY_TRANSCRIBED_LABEL, legible: false }

  async function seedIllegible(): Promise<{ draftId: string; labelId: string }> {
    const draftId = await seed()
    const [first] = await labelIds('org_1', draftId)
    await recordReturnIntakeLabelRead('org_1', draftId, first as string, {
      transcription: ILLEGIBLE,
    })
    return { draftId, labelId: first as string }
  }

  it('🛑 fills the sender that §4.6 requires, where commit.ts reads it', async () => {
    const { draftId, labelId } = await seedIllegible()

    await patchReturnIntakeLabelTranscription('org_1', draftId, labelId, {
      senderName: 'Pallet from Meyer GmbH',
      senderStreet1: '9 Hafenstrasse',
      senderCity: 'Bremen',
    })

    const view = (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view.payload.labels[0]?.transcription).toMatchObject({
      senderName: 'Pallet from Meyer GmbH',
      senderStreet1: '9 Hafenstrasse',
      senderCity: 'Bremen',
    })
  })

  it('⚠️ merges over the transcription rather than replacing it', async () => {
    const { draftId, labelId } = await seedIllegible()

    // The street first — the worker could read that much.
    await patchReturnIntakeLabelTranscription('org_1', draftId, labelId, {
      senderStreet1: '9 Hafenstrasse',
    })
    // ...and the name on a second pass, once someone turned the box over.
    await patchReturnIntakeLabelTranscription('org_1', draftId, labelId, {
      senderName: 'Meyer GmbH',
    })

    const view = (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view.payload.labels[0]?.transcription).toMatchObject({
      senderName: 'Meyer GmbH',
      senderStreet1: '9 Hafenstrasse',
    })
  })

  it('🛑 never writes legible, so typing is not relabelled as the model’s reading', async () => {
    const { draftId, labelId } = await seedIllegible()

    await patchReturnIntakeLabelTranscription('org_1', draftId, labelId, {
      senderName: 'Meyer GmbH',
    })

    // The model said it could not read this photo, and it still says so. The
    // review screen's two blocks are driven off exactly this flag, which is how
    // a person's typing can never come back looking like a machine read.
    expect(
      (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap().payload.labels[0]
        ?.transcription?.legible
    ).toBe(false)
  })

  it('🛑 refuses a field no client may write, legible and recipientNameRaw included', async () => {
    const { draftId, labelId } = await seedIllegible()

    await patchReturnIntakeLabelTranscription('org_1', draftId, labelId, {
      // §4.7's outbound check already ran off this; nothing re-reads it.
      recipientNameRaw: 'Auxx Lift Ltd',
      legible: true,
    } as never)

    const transcription = (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap().payload
      .labels[0]?.transcription
    expect(transcription?.legible).toBe(false)
    expect(transcription?.recipientNameRaw).toBeNull()
  })

  it('trims, and treats a blank as a clear rather than a stored empty string', async () => {
    const { draftId, labelId } = await seedIllegible()

    await patchReturnIntakeLabelTranscription('org_1', draftId, labelId, {
      senderName: '  Meyer GmbH  ',
      senderCity: '   ',
      carrier: null,
    })

    const transcription = (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap().payload
      .labels[0]?.transcription
    expect(transcription?.senderName).toBe('Meyer GmbH')
    expect(transcription?.senderCity).toBeNull()
    expect(transcription?.carrier).toBeNull()
  })

  it('⚠️ types in a label whose CALL failed, which has no transcription at all', async () => {
    const draftId = await seed()
    const [first] = await labelIds('org_1', draftId)
    await recordReturnIntakeLabelRead('org_1', draftId, first as string, { error: 'timeout' })

    await patchReturnIntakeLabelTranscription('org_1', draftId, first as string, {
      senderName: 'Meyer GmbH',
    })

    const label = (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap().payload.labels[0]
    expect(label?.transcription).toMatchObject({ senderName: 'Meyer GmbH', legible: false })
  })

  it('leaves every other label in the drop alone', async () => {
    const { draftId, labelId } = await seedIllegible()

    await patchReturnIntakeLabelTranscription('org_1', draftId, labelId, { senderName: 'Meyer' })

    const view = (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view.payload.labels[1]?.transcription).toBeNull()
  })

  it('🛑 a patch from another org resolves to nothing', async () => {
    const { draftId, labelId } = await seedIllegible()

    const theirs = await patchReturnIntakeLabelTranscription('org_2', draftId, labelId, {
      senderName: 'Somebody else',
    })

    expect(theirs._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    expect(
      (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap().payload.labels[0]
        ?.transcription?.senderName
    ).toBeNull()
  })

  it('refuses a label that is not part of this drop', async () => {
    const { draftId } = await seedIllegible()

    const result = await patchReturnIntakeLabelTranscription('org_1', draftId, 'nope', {
      senderName: 'Meyer',
    })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })

  it('🛑 cannot reach a label that already became a return', async () => {
    const { draftId, labelId } = await seedIllegible()
    const ids = await labelIds('org_1', draftId)
    await markReturnIntakeDraftReady('org_1', draftId)
    await recordReturnIntakeCommit('org_1', draftId, ids)

    // NotFound rather than Conflict, and that is the committed draft's own
    // design rather than a gap here: `recordReturnIntakeCommit` REMOVES the
    // labels that became returns, so there is nothing left to patch. A stale tab
    // cannot edit the sender of a parcel that is already booked in under an
    // `RMA-…` either way. (`updateDraft`'s ConflictError covers the whole-draft
    // writes, which is pinned in "the lifecycle" below.)
    const late = await patchReturnIntakeLabelTranscription('org_1', draftId, labelId, {
      senderName: 'Too late',
    })
    expect(late._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })

  it('⚠️ passes required: true and re-stamps the TTL like every other write', async () => {
    const { draftId, labelId } = await seedIllegible()
    h.writes = []

    await patchReturnIntakeLabelTranscription('org_1', draftId, labelId, { senderName: 'Meyer' })

    expect(h.writes).toEqual([
      {
        key: `return-intake:org_1:${draftId}`,
        ttl: RETURN_INTAKE_DRAFT_TTL_SECONDS,
        required: true,
      },
    ])
  })
})

describe('candidates', () => {
  it('derives bestTier from the list, so badge and ordering cannot disagree', () => {
    expect(bestTierOf([])).toBe('none')
    expect(
      bestTierOf([
        { tier: 'name' } as never,
        { tier: 'address' } as never,
        { tier: 'name_place' } as never,
      ])
    ).toBe('address')
  })

  it('stores the ladder answers against the label that produced them', async () => {
    const draftId = await seed()
    const [first] = await labelIds('org_1', draftId)

    await recordReturnIntakeLabelCandidates('org_1', draftId, first as string, {
      candidates: [
        {
          contactRecordId: CONTACT,
          contactName: 'Jane Doe',
          contactPlace: 'Leeds',
          orderRecordId: ORDER,
          orderNumber: 'SO-9',
          tier: 'address',
        },
      ],
      looksOutbound: true,
    })

    const view = (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view.payload.labels[0]?.bestTier).toBe('address')
    expect(view.payload.labels[0]?.candidates).toHaveLength(1)
    // 🛑 Carried, never acted on: an outbound-looking label is a warning, not a
    // refusal — a worker may legitimately be returning something to a vendor.
    expect(view.payload.labels[0]?.looksOutbound).toBe(true)
    expect(view.payload.labels[1]?.candidates).toEqual([])
  })
})

describe('the worker’s answers', () => {
  it('records a confirmed contact and order', async () => {
    const draftId = await seed()
    const [first] = await labelIds('org_1', draftId)

    await confirmReturnIntakeLabel('org_1', draftId, {
      labelId: first as string,
      contactRecordId: CONTACT,
      orderRecordId: ORDER,
      unidentified: false,
    })

    const view = (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view.payload.labels[0]).toMatchObject({
      confirmedContactRecordId: CONTACT,
      confirmedOrderRecordId: ORDER,
      confirmedUnidentified: false,
    })
  })

  it('🛑 unidentified is an answer, and it clears any contact that came with it', async () => {
    const draftId = await seed()
    const [first] = await labelIds('org_1', draftId)

    await confirmReturnIntakeLabel('org_1', draftId, {
      labelId: first as string,
      contactRecordId: CONTACT,
      orderRecordId: ORDER,
      unidentified: true,
    })

    const view = (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view.payload.labels[0]).toMatchObject({
      confirmedContactRecordId: null,
      confirmedOrderRecordId: null,
      confirmedUnidentified: true,
    })
  })

  it('caches the order options per contact, not per label', async () => {
    const draftId = await seed()

    await setReturnIntakeOrderOptions('org_1', draftId, CONTACT, [
      { orderRecordId: ORDER, orderNumber: 'SO-9', lastFulfilledAt: null },
    ])

    const view = (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view.payload.orderOptions[CONTACT]).toHaveLength(1)
  })
})

describe('the lifecycle', () => {
  it('ready clears an earlier failure and opens the review', async () => {
    const draftId = await seed()
    await failReturnIntakeDraft('org_1', draftId, 'the model could not see')
    await markReturnIntakeDraftReady('org_1', draftId)

    const view = (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view.status).toBe('ready')
    expect(view.phase).toBe('ready')
    expect(view.failureReason).toBeNull()
  })

  it('a failure is shown verbatim on the dialog', async () => {
    const draftId = await seed()
    await failReturnIntakeDraft('org_1', draftId, 'Pick another default model.')

    const view = (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view.status).toBe('failed')
    expect(view.failureReason).toBe('Pick another default model.')
  })

  it('🛑 a partial commit removes only the labels that worked', async () => {
    const draftId = await seed()
    const [first, second] = await labelIds('org_1', draftId)
    await markReturnIntakeDraftReady('org_1', draftId)

    await recordReturnIntakeCommit('org_1', draftId, [first as string])

    const view = (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap()
    // The failed group's label is still here to retry; the committed one is not,
    // which is what stops a second press minting a second RMA for it.
    expect(view.payload.labels.map((label) => label.id)).toEqual([second])
    expect(view.status).toBe('ready')
  })

  it('goes committed only once nothing is left to commit', async () => {
    const draftId = await seed()
    const ids = await labelIds('org_1', draftId)
    await markReturnIntakeDraftReady('org_1', draftId)

    await recordReturnIntakeCommit('org_1', draftId, ids)

    const view = (await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap()
    expect(view.status).toBe('committed')
    expect(view.payload.labels).toEqual([])
  })

  it('🛑 refuses to write over a committed draft', async () => {
    const draftId = await seed()
    const ids = await labelIds('org_1', draftId)
    await markReturnIntakeDraftReady('org_1', draftId)
    await recordReturnIntakeCommit('org_1', draftId, ids)

    const late = await setReturnIntakeDraftPhase('org_1', draftId, 'matching')
    expect(late._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
    expect((await getReturnIntakeDraft('org_1', draftId))._unsafeUnwrap().status).toBe('committed')
  })

  it('🛑 commit never deletes the key — the TTL reaps it', async () => {
    const draftId = await seed()
    const ids = await labelIds('org_1', draftId)
    await markReturnIntakeDraftReady('org_1', draftId)
    await recordReturnIntakeCommit('org_1', draftId, ids)

    // A delete that failed would leave an editable draft over real RMAs, and a
    // retry would raise duplicates for goods already booked in.
    expect(h.deletes).toEqual([])
    expect((await getReturnIntakeDraft('org_1', draftId)).isOk()).toBe(true)
  })

  it('discard deletes the key, and required: true rides on the delete too', async () => {
    const draftId = await seed()
    await discardReturnIntakeDraft('org_1', draftId)

    expect(h.deletes).toEqual([{ key: `return-intake:org_1:${draftId}`, required: true }])
    expect((await getReturnIntakeDraft('org_1', draftId)).isErr()).toBe(true)
  })

  it('an expired key and one that never existed give the same answer', async () => {
    const draftId = await seed()
    h.store.clear() // what the TTL does

    const expired = await getReturnIntakeDraft('org_1', draftId)
    const never = await getReturnIntakeDraft('org_1', 'nope')
    expect(expired._unsafeUnwrapErr().message).toBe(never._unsafeUnwrapErr().message)
  })
})
