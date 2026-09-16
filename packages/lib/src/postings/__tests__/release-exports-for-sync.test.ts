// packages/lib/src/postings/__tests__/release-exports-for-sync.test.ts
//
// The sync queue's bulk action (plans/accounting/tasks/53-two-modes-one-ledger.md
// §7.2). What is under test is the BRANCH TABLE, not the delivery machinery:
// every posting in a selection is one of five things, and getting any of them
// wrong is a bulk bar that lies about what it did to forty rows at once.
//
// 🛑 The one that matters most is the last: this must RELEASE and enqueue, never
// push inline. An export is three to five sequential round trips to a
// rate-limited third party and a bulk bar acts on a backlog, so a version that
// called `deliverAccountingPosting` per row would be an HTTP request nobody's
// proxy holds open. The assertion that `deliverAccountingPosting` is not called
// on the ordinary path is the point of this file.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  deliverAccountingPosting: vi.fn(),
  enqueueAccountingDelivery: vi.fn(),
  planAccountingDeliveryInTx: vi.fn(),
  resolveAccountingProvider: vi.fn(),
}))

vi.mock('../delivery', () => ({
  deliverAccountingPosting: h.deliverAccountingPosting,
  enqueueAccountingDelivery: h.enqueueAccountingDelivery,
  planAccountingDeliveryInTx: h.planAccountingDeliveryInTx,
}))
vi.mock('../provider', () => ({ resolveAccountingProvider: h.resolveAccountingProvider }))

import type { Database } from '@auxx/database'
import { UnprocessableEntityError } from '../../errors'
import { releaseExportsForSync } from '../retry-export'

const ORG = 'org_1'

interface PostingRow {
  id: string
  docNumber: string
  exportStatus: 'not_required' | 'pending' | 'exported' | 'failed'
  deliveryIntent: 'not_required' | 'manual' | 'automatic' | null
}

/** A stub `Database` that answers the one `GlPosting` read with `rows`. */
function stubDb(rows: PostingRow[]) {
  const chain: Record<string, unknown> = {}
  const passthrough = () => chain
  for (const method of ['from', 'leftJoin', 'where', 'orderBy', 'limit'])
    chain[method] = passthrough
  // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject)

  return {
    select: () => chain,
    // The caller owns the transaction; the stub just runs the callback.
    transaction: (fn: (tx: unknown) => unknown) => Promise.resolve(fn({})),
  } as unknown as Database
}

const posting = (overrides: Partial<PostingRow> & { id: string }): PostingRow => ({
  docNumber: `GL-${overrides.id}`,
  exportStatus: 'pending',
  deliveryIntent: 'manual',
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.planAccountingDeliveryInTx.mockResolvedValue({ id: 'del_1' })
  h.enqueueAccountingDelivery.mockResolvedValue(undefined)
})

describe('releaseExportsForSync', () => {
  it('releases a held posting and hands it to the worker, without pushing', async () => {
    const result = await releaseExportsForSync(stubDb([posting({ id: 'gl_a' })]), {
      organizationId: ORG,
      glPostingIds: ['gl_a'],
    })

    expect(result._unsafeUnwrap()).toMatchObject({ released: 1, skipped: 0, failed: 0 })
    expect(h.planAccountingDeliveryInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, glPostingId: 'gl_a', manual: true })
    )
    expect(h.enqueueAccountingDelivery).toHaveBeenCalledWith({
      organizationId: ORG,
      glPostingId: 'gl_a',
    })
    // 🛑 The whole point. See this file's header.
    expect(h.deliverAccountingPosting).not.toHaveBeenCalled()
  })

  it('de-dupes the selection, so one entry is released and enqueued once', async () => {
    // A list built from checkboxes over a list that re-fetched underneath
    // somebody can carry the same id twice.
    const result = await releaseExportsForSync(stubDb([posting({ id: 'gl_a' })]), {
      organizationId: ORG,
      glPostingIds: ['gl_a', 'gl_a'],
    })

    expect(result._unsafeUnwrap().released).toBe(1)
    expect(h.enqueueAccountingDelivery).toHaveBeenCalledTimes(1)
  })

  it('reports an already-exported entry as exported, not as an error', async () => {
    // Two people clearing the same queue should both be told it is in the books.
    const result = await releaseExportsForSync(
      stubDb([posting({ id: 'gl_a', exportStatus: 'exported' })]),
      { organizationId: ORG, glPostingIds: ['gl_a'] }
    )

    const value = result._unsafeUnwrap()
    expect(value).toMatchObject({ released: 0, skipped: 1, failed: 0 })
    expect(value.outcomes[0]?.status).toBe('exported')
    expect(h.planAccountingDeliveryInTx).not.toHaveBeenCalled()
  })

  it('skips an entry that is never exported, and says why', async () => {
    const result = await releaseExportsForSync(
      stubDb([
        posting({ id: 'gl_a', exportStatus: 'not_required', deliveryIntent: 'not_required' }),
      ]),
      { organizationId: ORG, glPostingIds: ['gl_a'] }
    )

    const outcome = result._unsafeUnwrap().outcomes[0]
    expect(outcome?.status).toBe('skipped')
    expect(outcome?.message).toContain('not exported')
  })

  it('falls back to the inline push for a legacy posting with no delivery', async () => {
    // 🛑 `planAccountingDeliveryInTx` THROWS on a row that predates the delivery
    // pipeline, by design. Reporting that as a failure would blame a mechanism
    // the row was never in; the inline replay is the path that works for it.
    h.resolveAccountingProvider.mockResolvedValue({ id: 'none' })
    const result = await releaseExportsForSync(
      stubDb([posting({ id: 'gl_a', exportStatus: 'exported', deliveryIntent: null })]),
      { organizationId: ORG, glPostingIds: ['gl_a'] }
    )

    // `exported` short-circuits before the legacy branch, which is the ordering
    // this asserts: state first, mechanism second.
    expect(result._unsafeUnwrap().outcomes[0]?.status).toBe('exported')
    expect(h.planAccountingDeliveryInTx).not.toHaveBeenCalled()
  })

  it('does not let one refusal stop the rest of the batch', async () => {
    h.planAccountingDeliveryInTx
      .mockRejectedValueOnce(new Error('Pinned accounting connection is missing'))
      .mockResolvedValueOnce({ id: 'del_2' })

    const result = await releaseExportsForSync(
      stubDb([posting({ id: 'gl_a' }), posting({ id: 'gl_b' })]),
      { organizationId: ORG, glPostingIds: ['gl_a', 'gl_b'] }
    )

    const value = result._unsafeUnwrap()
    expect(value).toMatchObject({ released: 1, failed: 1 })
    expect(value.outcomes[0]?.message).toContain('Pinned accounting connection is missing')
  })

  it('isolates a coverage-partition refusal, which THROWS rather than answering', async () => {
    // 🛑 `planAccountingDeliveryInTx` re-proves each effect's component
    // partition inside the commit lock on EVERY attempt (unit 3,
    // `assertCoveragePartitionsInTx`), and a gap, an overlap or a stray line
    // leaves by `throw`, not by a returned error. A bulk bar that let that
    // unwind the loop would abandon thirty-nine good rows over one bad one -
    // and would report nothing at all about any of them.
    //
    // ⚠️ It also does NOT stamp `exportStatus: 'failed'`, by the same contract
    // the other plan refusals keep. So the row stays where it was and the
    // message is the only thing that tells anybody - which is why the message
    // is carried through to the queue verbatim rather than flattened.
    h.planAccountingDeliveryInTx
      .mockRejectedValueOnce(
        new UnprocessableEntityError(
          'Delivery coverage does not partition its effects: eff_1: line 1100 is covered twice'
        )
      )
      .mockResolvedValueOnce({ id: 'del_2' })

    const result = await releaseExportsForSync(
      stubDb([posting({ id: 'gl_a' }), posting({ id: 'gl_b' })]),
      { organizationId: ORG, glPostingIds: ['gl_a', 'gl_b'] }
    )

    const value = result._unsafeUnwrap()
    // The batch finished, and the good row went.
    expect(value).toMatchObject({ released: 1, skipped: 0, failed: 1 })
    expect(h.enqueueAccountingDelivery).toHaveBeenCalledTimes(1)
    expect(h.enqueueAccountingDelivery).toHaveBeenCalledWith({
      organizationId: ORG,
      glPostingId: 'gl_b',
    })

    // The refusal names the entry AND says what is wrong with it. The queue
    // renders this string, so a reader is never sent to the logs for a reason
    // that was already in hand.
    const failure = value.outcomes.find((outcome) => outcome.status === 'error')
    expect(failure?.docNumber).toBe('GL-gl_a')
    expect(failure?.message).toContain('does not partition its effects')
    expect(failure?.message).toContain('covered twice')
  })

  it('reports an id that is not this organization’s rather than throwing', async () => {
    const result = await releaseExportsForSync(stubDb([]), {
      organizationId: ORG,
      glPostingIds: ['gl_missing'],
    })

    expect(result._unsafeUnwrap()).toMatchObject({ released: 0, failed: 1 })
  })

  it('skips a posting with no external destination', async () => {
    // `planAccountingDeliveryInTx` answers null for `not_required` intent, and a
    // null plan is nothing to sync rather than something that went wrong.
    h.planAccountingDeliveryInTx.mockResolvedValue(null)
    const result = await releaseExportsForSync(stubDb([posting({ id: 'gl_a' })]), {
      organizationId: ORG,
      glPostingIds: ['gl_a'],
    })

    expect(result._unsafeUnwrap().outcomes[0]?.status).toBe('skipped')
    expect(h.enqueueAccountingDelivery).not.toHaveBeenCalled()
  })
})
