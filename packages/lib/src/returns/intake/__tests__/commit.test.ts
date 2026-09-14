// packages/lib/src/returns/intake/__tests__/commit.test.ts
//
// What the commit writes, and what it does when one group refuses.
// `createReturn` is a spy, so what is pinned is the CONTRACT §6.3 states:
//
//   🛑 the header ONLY, no `return_line` rows
//   🛑 through `createReturn`, so the RecordSequence hook mints the RMA
//   🛑 per group, in its OWN transaction — and the headline test of this file is
//      that a failing second group leaves the first one a real RMA and leaves
//      only its own labels in the draft
//   ⚠️ every tracking number in the group, as a multi-value array (§8.1)

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  draft: null as Record<string, unknown> | null,
  /** Every `createReturn` call, in order. */
  created: [] as Record<string, unknown>[],
  /** Every post-create `UnifiedCrudHandler.update`, in order. */
  updates: [] as { recordId: string; values: Record<string, unknown> }[],
  converted: [] as { assetId: string; kind: string }[],
  /** What `recordReturnIntakeCommit` was told worked. */
  recorded: [] as { draftId: string; labelIds: string[] }[],
  /** 🛑 Every read must be keyed by the CALLER's org id, never the draft's. */
  reads: [] as { organizationId: string; draftId: string }[],
  /** Transactions opened, and whether each committed. */
  transactions: [] as { committed: boolean }[],
  /** Group ids whose `createReturn` should refuse. */
  failGroupsWithContact: new Set<string | null>(),
  failConvert: false,
}))

vi.mock('../../writes', async () => {
  const { err, ok } = await import('neverthrow')
  const { UnprocessableEntityError } = await import('../../../errors')
  return {
    createReturn: vi.fn(async (_db, _org, _user, input: Record<string, unknown>) => {
      h.created.push(input)
      if (h.failGroupsWithContact.has((input.contactId as string | null) ?? null)) {
        return err(new UnprocessableEntityError('that order is closed'))
      }
      const index = h.created.length
      return ok({
        returnId: `ret_${index}`,
        recordId: `def_return:ret_${index}`,
        number: `RMA-000${index}`,
        lines: [],
      })
    }),
  }
})

vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async update(recordId: string, values: Record<string, unknown>) {
      h.updates.push({ recordId, values })
    }
  },
}))

vi.mock('../../../files/assets/asset-mutations', async () => {
  const { ok } = await import('neverthrow')
  return {
    convertTempAssetToPermanent: vi.fn(async (_ctx, assetId: string, kind: string) => {
      if (h.failConvert) throw new Error('s3 unavailable')
      h.converted.push({ assetId, kind })
      return ok(undefined)
    }),
  }
})

vi.mock('../draft-mutations', async () => {
  const { ok } = await import('neverthrow')
  return {
    recordReturnIntakeCommit: vi.fn(async (_org, draftId: string, labelIds: string[]) => {
      h.recorded.push({ draftId, labelIds })
      return ok(undefined)
    }),
  }
})

vi.mock('../draft-queries', () => ({
  readStoredReturnIntakeDraft: vi.fn(async (organizationId: string, draftId: string) => {
    h.reads.push({ organizationId, draftId })
    return h.draft
  }),
}))

import type { Database } from '@auxx/database'
import type { RecordId } from '@auxx/types/resource'
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../../errors'
import { EMPTY_TRANSCRIBED_LABEL, type ReturnIntakeLabel, type TranscribedLabel } from '../client'
import { commitReturnIntakeDraft } from '../commit'
import { groupLabels } from '../group'

/**
 * A `db` whose `transaction` runs the body and records whether it committed.
 *
 * 🛑 One transaction PER GROUP is the property under test, so this has to be a
 * real boundary and not a pass-through: a body that throws must leave
 * `committed: false` and the loop must carry on to the next group.
 */
const db = {
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
    const entry = { committed: false }
    h.transactions.push(entry)
    await fn(db)
    entry.committed = true
  }),
} as unknown as Database

function transcription(partial: Partial<TranscribedLabel> = {}): TranscribedLabel {
  return { ...EMPTY_TRANSCRIBED_LABEL, legible: true, ...partial }
}

function label(id: string, partial: Partial<ReturnIntakeLabel> = {}): ReturnIntakeLabel {
  return {
    id,
    fileRef: `asset:media_${id}`,
    fileName: `${id}.jpg`,
    transcription: transcription(),
    error: null,
    candidates: [],
    bestTier: 'none',
    looksOutbound: false,
    confirmedContactRecordId: null,
    confirmedOrderRecordId: null,
    confirmedUnidentified: true,
    ...partial,
  }
}

const CONTACT_A = 'def_contact:contact_a' as RecordId
const CONTACT_B = 'def_contact:contact_b' as RecordId
const ORDER_A = 'def_order:order_a' as RecordId

function seedDraft(labels: ReturnIntakeLabel[], status = 'ready') {
  h.draft = {
    id: 'draft_1',
    organizationId: 'org_1',
    createdById: 'user_1',
    status,
    phase: 'ready',
    labelsRead: labels.length,
    labelsTotal: labels.length,
    failureReason: null,
    payload: { labels, orderOptions: {} },
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
  }
  return groupLabels(labels)
}

beforeEach(() => {
  h.draft = null
  h.created = []
  h.updates = []
  h.converted = []
  h.recorded = []
  h.reads = []
  h.transactions = []
  h.failGroupsWithContact = new Set()
  h.failConvert = false
})

describe('what it refuses', () => {
  it('🛑 reads the draft under the CALLER’s org id, never the draft’s own', async () => {
    seedDraft([label('l1', { confirmedContactRecordId: CONTACT_A, confirmedUnidentified: false })])
    await commitReturnIntakeDraft(db, 'org_1', 'user_1', { draftId: 'draft_1', groupIds: [] })
    expect(h.reads).toEqual([{ organizationId: 'org_1', draftId: 'draft_1' }])
  })

  it('a draft that is gone', async () => {
    h.draft = null
    const result = await commitReturnIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      groupIds: ['g'],
    })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })

  it('🛑 a draft that already became returns — never a second RMA', async () => {
    seedDraft([label('l1')], 'committed')
    const result = await commitReturnIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      groupIds: ['g'],
    })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
    expect(h.created).toEqual([])
  })

  it('a draft that has not been read yet', async () => {
    seedDraft([label('l1')], 'reading')
    const result = await commitReturnIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      groupIds: ['g'],
    })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
  })

  it('names a group whose labels are gone rather than throwing for the rest', async () => {
    seedDraft([label('l1')])
    const result = await commitReturnIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      groupIds: ['stale_group'],
    })
    const [entry] = result._unsafeUnwrap()
    expect(entry).toMatchObject({ groupId: 'stale_group', returnRecordId: null })
    expect(entry?.error).toBeTruthy()
    expect(h.created).toEqual([])
  })
})

describe('the header it writes', () => {
  it('goes through createReturn, so the RecordSequence hook mints the RMA', async () => {
    const groups = seedDraft([
      label('l1', {
        confirmedContactRecordId: CONTACT_A,
        confirmedOrderRecordId: ORDER_A,
        confirmedUnidentified: false,
        transcription: transcription({
          senderName: 'Jane Doe',
          senderStreet1: '12 Dock Road',
          senderCity: 'Leeds',
          senderPostalCode: 'LS1 1AA',
          carrier: 'ups',
          trackingNumber: '1Z111',
        }),
      }),
    ])

    const result = await commitReturnIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      groupIds: groups.map((group) => group.id),
    })

    expect(result._unsafeUnwrap()[0]).toMatchObject({
      returnRecordId: 'def_return:ret_1',
      returnNumber: 'RMA-0001',
      error: null,
    })
    expect(h.created[0]).toMatchObject({
      senderNameRaw: 'Jane Doe',
      senderAddressRaw: '12 Dock Road\nLeeds LS1 1AA',
      inboundCarrier: 'ups',
      inboundTracking: ['1Z111'],
      // Relationship inputs are INSTANCE ids, which is what `createReturn` takes.
      contactId: 'contact_a',
      orderId: 'order_a',
      origin: 'dock',
      status: 'received',
    })
    expect(h.created[0]?.receivedAt).toBeInstanceOf(Date)
  })

  it('🛑 enters at `received`, never the definition default', async () => {
    // `RETURN_ENTRY_STATUSES` is ['requested', 'received'] and `return-hooks.ts`
    // names this case: a dock surprise enters at `received` because the pallet
    // is on the floor before anyone knows whose it is.
    //
    // This is pinned on its own because the failure is SILENT and one-way:
    // entering at `requested` claims somebody asked about a return that nobody
    // asked about, and the physical graph only reaches `received` through
    // `approved -> in_transit`. A dock return left at `requested` cannot be
    // moved to where it already physically is without walking two transitions
    // that never happened.
    const groups = seedDraft([
      label('l1', { confirmedContactRecordId: CONTACT_A, confirmedUnidentified: false }),
    ])
    await commitReturnIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      groupIds: groups.map((group) => group.id),
    })
    expect(h.created[0]?.status).toBe('received')
  })

  it('an unidentified dock pallet still enters at `received`', async () => {
    // The 15% case: no customer matched, `contact` null, goods on the floor.
    // The status must not soften just because the sender is unknown - that is
    // precisely the return the hook's comment was written about.
    const groups = seedDraft([label('l1', { confirmedUnidentified: true })])
    await commitReturnIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      groupIds: groups.map((group) => group.id),
    })
    expect(h.created[0]).toMatchObject({ status: 'received', contactId: null })
  })

  it('🛑 writes NO return_line rows — the lines card owns what is in the box', async () => {
    const groups = seedDraft([
      label('l1', { confirmedContactRecordId: CONTACT_A, confirmedUnidentified: false }),
    ])
    await commitReturnIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      groupIds: groups.map((group) => group.id),
    })

    expect(h.created).toHaveLength(1)
    // The only other write is the photo link on the return itself.
    expect(h.updates.map((update) => Object.keys(update.values))).toEqual([['return_photos']])
  })

  it('⚠️ carries EVERY tracking number in the group, de-duplicated, in label order', async () => {
    const groups = seedDraft([
      label('l1', {
        confirmedContactRecordId: CONTACT_A,
        confirmedUnidentified: false,
        transcription: transcription({ trackingNumber: '1Z111' }),
      }),
      label('l2', {
        confirmedContactRecordId: CONTACT_A,
        confirmedUnidentified: false,
        transcription: transcription({ trackingNumber: '1Z222' }),
      }),
      label('l3', {
        confirmedContactRecordId: CONTACT_A,
        confirmedUnidentified: false,
        transcription: transcription({ trackingNumber: '1Z222' }),
      }),
    ])

    expect(groups).toHaveLength(1)
    await commitReturnIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      groupIds: groups.map((group) => group.id),
    })

    expect(h.created[0]?.inboundTracking).toEqual(['1Z111', '1Z222'])
  })

  it('links every photo in the group to return.photos and takes them off the fuse', async () => {
    const groups = seedDraft([
      label('l1', { confirmedContactRecordId: CONTACT_A, confirmedUnidentified: false }),
      label('l2', { confirmedContactRecordId: CONTACT_A, confirmedUnidentified: false }),
    ])

    await commitReturnIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      groupIds: groups.map((group) => group.id),
    })

    expect(h.updates[0]?.values.return_photos).toEqual([
      { ref: 'asset:media_l1' },
      { ref: 'asset:media_l2' },
    ])
    expect(h.converted).toEqual([
      { assetId: 'media_l1', kind: 'DOCUMENT' },
      { assetId: 'media_l2', kind: 'DOCUMENT' },
    ])
  })

  it('⚠️ a photo that will not convert does not fail a return that exists', async () => {
    h.failConvert = true
    const groups = seedDraft([
      label('l1', { confirmedContactRecordId: CONTACT_A, confirmedUnidentified: false }),
    ])

    const result = await commitReturnIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      groupIds: groups.map((group) => group.id),
    })

    expect(result._unsafeUnwrap()[0]?.returnNumber).toBe('RMA-0001')
    expect(h.recorded[0]?.labelIds).toEqual(['l1'])
  })
})

describe('🛑 partial failure', () => {
  it('leaves the successful groups created and the failed group in the draft', async () => {
    // Three groups: two customers plus one unidentified pallet. The MIDDLE one
    // refuses, which is the case a single transaction would get wrong.
    const groups = seedDraft([
      label('l1', { confirmedContactRecordId: CONTACT_A, confirmedUnidentified: false }),
      label('l2', { confirmedContactRecordId: CONTACT_B, confirmedUnidentified: false }),
      label('l3'),
    ])
    expect(groups).toHaveLength(3)
    h.failGroupsWithContact.add('contact_b')

    const result = await commitReturnIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      groupIds: groups.map((group) => group.id),
    })

    const results = result._unsafeUnwrap()
    expect(results).toHaveLength(3)
    // The first is a real RMA and STAYS one.
    expect(results[0]).toMatchObject({ returnNumber: 'RMA-0001', error: null })
    // The second refuses, carrying the reason a person can act on.
    expect(results[1]).toMatchObject({ returnRecordId: null, returnNumber: null })
    expect(results[1]?.error).toBe('that order is closed')
    // 🛑 And the THIRD still runs. A loop that aborted would strand it.
    expect(results[2]).toMatchObject({ returnNumber: 'RMA-0003', error: null })

    // Only the labels that worked leave the draft, so a retry aims at l2 alone
    // and cannot mint a second RMA for l1 or l3.
    expect(h.recorded).toEqual([{ draftId: 'draft_1', labelIds: ['l1', 'l3'] }])
  })

  it('🛑 opens one transaction per group, and the failed one does not commit', async () => {
    const groups = seedDraft([
      label('l1', { confirmedContactRecordId: CONTACT_A, confirmedUnidentified: false }),
      label('l2', { confirmedContactRecordId: CONTACT_B, confirmedUnidentified: false }),
    ])
    h.failGroupsWithContact.add('contact_b')

    await commitReturnIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      groupIds: groups.map((group) => group.id),
    })

    // Two boundaries, not one: the second rolling back must not take the first
    // return with it.
    expect(h.transactions).toEqual([{ committed: true }, { committed: false }])
  })

  it('records nothing when every group refused, so the whole drop is retryable', async () => {
    const groups = seedDraft([
      label('l1', { confirmedContactRecordId: CONTACT_A, confirmedUnidentified: false }),
    ])
    h.failGroupsWithContact.add('contact_a')

    const result = await commitReturnIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      groupIds: groups.map((group) => group.id),
    })

    expect(result._unsafeUnwrap()[0]?.error).toBe('that order is closed')
    expect(h.recorded).toEqual([])
  })

  it('commits only the groups it was asked for, leaving the rest in the draft', async () => {
    const groups = seedDraft([
      label('l1', { confirmedContactRecordId: CONTACT_A, confirmedUnidentified: false }),
      label('l2', { confirmedContactRecordId: CONTACT_B, confirmedUnidentified: false }),
    ])

    await commitReturnIntakeDraft(db, 'org_1', 'user_1', {
      draftId: 'draft_1',
      groupIds: [groups[0]?.id as string],
    })

    expect(h.created).toHaveLength(1)
    expect(h.recorded).toEqual([{ draftId: 'draft_1', labelIds: ['l1'] }])
  })
})
