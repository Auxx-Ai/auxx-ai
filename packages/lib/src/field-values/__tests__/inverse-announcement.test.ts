// packages/lib/src/field-values/__tests__/inverse-announcement.test.ts
//
// Decision D-11 / defect B-9: the inverse side of a relationship write is a real
// write to a real record and must be announced like one.
//
// Before this, `relationship-sync` rewrote the mirror array in raw SQL and told
// nobody — every screen holding the parent kept rendering its load-time list
// (the client never re-requests a key it already holds, so not even a remount
// repaired it), and record rules subscribing to a relationship field never fired
// on the inverse side at all. The diff was already computed and thrown away.
//
// These drive `syncInverseRelationships` through the same scripted fake db
// `inverse-repoint-fallback.test.ts` uses, and assert on the frame that comes
// out the other side.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const publishFieldValueUpdates = vi.fn(async () => {})
const getRealtimeService = vi.fn(() => ({}) as never)
const getAmbientTxWriteScope = vi.fn<() => unknown>(() => undefined)
const recordTxWriteChange = vi.fn()

vi.mock('../../realtime', () => ({
  publishFieldValueUpdates: (...args: unknown[]) => publishFieldValueUpdates(...(args as [])),
  getRealtimeService: () => getRealtimeService(),
}))

vi.mock('../../resources/crud/tx-write-scope', () => ({
  getAmbientTxWriteScope: () => getAmbientTxWriteScope(),
  recordTxWriteChange: (...args: unknown[]) => recordTxWriteChange(...args),
}))

import { syncInverseRelationships } from '../relationship-sync'

/** Thenable statement-builder stub: every method chains, awaiting resolves `result`. */
function chain(result: unknown): Record<string, unknown> {
  const c: Record<string, unknown> = {}
  for (const m of ['from', 'where', 'orderBy', 'groupBy', 'limit', 'set', 'returning']) {
    c[m] = () => c
  }
  c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown): Promise<unknown> =>
    Promise.resolve(result).then(resolve, reject)
  return c
}

/**
 * A db whose `select` answers a scripted sequence. The multi-value add path
 * runs two selects (existing links, then max sortKeys) before the D-11 re-read,
 * so the third scripted answer is the array being announced.
 */
function fakeDb(selectResults: unknown[][]) {
  let call = 0
  return {
    select: () => chain(selectResults[call++] ?? []),
    delete: () => chain([]),
    insert: () => ({ values: () => Promise.resolve() }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => await fn(undefined),
  } as never
}

/** A stored FieldValue row as `rowToTypedValue` expects to receive it. */
function row(id: string, entityId: string, relatedEntityId: string, sortKey: string) {
  return {
    id,
    entityId,
    fieldId: 'field-inv',
    relatedEntityId,
    relatedEntityDefinitionId: 'def-line',
    sortKey,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  }
}

/** An order gaining a line: the LINE is written, the ORDER's array is the mirror. */
const HAS_MANY_INVERSE = {
  inverseFieldId: 'field-inv',
  inverseRelationshipType: 'has_many' as const,
  sourceEntityDefinitionId: 'def-line',
  targetEntityDefinitionId: 'def-order',
  sourceFieldId: 'field-src',
}

beforeEach(() => {
  vi.clearAllMocks()
  getAmbientTxWriteScope.mockReturnValue(undefined)
  publishFieldValueUpdates.mockResolvedValue(undefined)
})

describe('D-11 — the inverse write announces itself', () => {
  it('publishes the parent’s new array when a child is linked to it', async () => {
    await syncInverseRelationships(
      {
        db: fakeDb([
          [],
          [],
          [row('r1', 'order-1', 'line-A', 'a0'), row('r2', 'order-1', 'line-B', 'a1')],
        ]),
        organizationId: 'org-1',
      },
      {
        entityId: 'line-B',
        oldRelatedIds: [],
        newRelatedIds: ['order-1'],
        inverseInfo: HAS_MANY_INVERSE,
      }
    )

    expect(publishFieldValueUpdates).toHaveBeenCalledTimes(1)
    const [, organizationId, entries] = publishFieldValueUpdates.mock.calls[0] as unknown as [
      unknown,
      string,
      Array<{ key: string; value: unknown }>,
    ]
    expect(organizationId).toBe('org-1')
    expect(entries).toHaveLength(1)
    // Keyed on the ORDER — the record at the other end of the link, whose array
    // moved. The line's own field was published by whoever wrote it.
    expect(entries[0]!.key).toBe('def-order:order-1:def-order:field-inv')
    expect(entries[0]!.value).toEqual([
      expect.objectContaining({ type: 'relationship', recordId: 'def-line:line-A' }),
      expect.objectContaining({ type: 'relationship', recordId: 'def-line:line-B' }),
    ])
  })

  it('does NOT exclude the acting socket', async () => {
    // 🛑 The load-bearing assertion. Every ordinary publish suppresses the echo
    // to the tab that made the change. Here the announced record is a DIFFERENT
    // record from the one the user edited, so to that tab it is news — and
    // excluding it reinstates the original bug for the person most likely to be
    // looking at the screen.
    await syncInverseRelationships(
      { db: fakeDb([[], [], [row('r1', 'order-1', 'line-A', 'a0')]]), organizationId: 'org-1' },
      {
        entityId: 'line-A',
        oldRelatedIds: [],
        newRelatedIds: ['order-1'],
        inverseInfo: HAS_MANY_INVERSE,
      }
    )

    const call = publishFieldValueUpdates.mock.calls[0] as unknown as unknown[]
    expect(call[3]).toBeUndefined()
  })

  it('publishes an EMPTY array when the last link is removed', async () => {
    // "This list is now empty" is the news. Skipping the frame leaves the last
    // non-empty answer on screen forever.
    await syncInverseRelationships(
      { db: fakeDb([[]]), organizationId: 'org-1' },
      {
        entityId: 'line-A',
        oldRelatedIds: ['order-1'],
        newRelatedIds: [],
        inverseInfo: HAS_MANY_INVERSE,
      }
    )

    const [, , entries] = publishFieldValueUpdates.mock.calls[0] as unknown as [
      unknown,
      string,
      Array<{ key: string; value: unknown }>,
    ]
    expect(entries).toEqual([{ key: 'def-order:order-1:def-order:field-inv', value: [] }])
  })

  it('buffers instead of publishing while a write scope is open', async () => {
    // Announcing before COMMIT is worse than silence: the subscriber re-reads on
    // another connection, cannot see uncommitted rows, and caches the PRE-write
    // value as fresh.
    const scope = { marker: 'buffered' }
    getAmbientTxWriteScope.mockReturnValue(scope)

    await syncInverseRelationships(
      { db: fakeDb([[], [], [row('r1', 'order-1', 'line-A', 'a0')]]), organizationId: 'org-1' },
      {
        entityId: 'line-A',
        oldRelatedIds: [],
        newRelatedIds: ['order-1'],
        inverseInfo: HAS_MANY_INVERSE,
      }
    )

    expect(publishFieldValueUpdates).not.toHaveBeenCalled()
    expect(recordTxWriteChange).toHaveBeenCalledTimes(1)
    const [passedScope, args] = recordTxWriteChange.mock.calls[0] as [
      unknown,
      { recordId: string; outputKey: string; entry: { key: string } },
    ]
    expect(passedScope).toBe(scope)
    expect(args.recordId).toBe('def-order:order-1')
    expect(args.outputKey).toBe('field-inv')
    // The buffered frame must be the one the inline lane would have sent, or the
    // flush replays something the client has never seen the shape of.
    expect(args.entry.key).toBe('def-order:order-1:def-order:field-inv')
  })

  it('a failed publish never fails the write', async () => {
    // The rows are already durable by the time we get here. A realtime hiccup
    // leaves the client exactly as stale as it was before D-11, never worse.
    publishFieldValueUpdates.mockRejectedValue(new Error('pusher down'))

    await expect(
      syncInverseRelationships(
        { db: fakeDb([[], [], [row('r1', 'order-1', 'line-A', 'a0')]]), organizationId: 'org-1' },
        {
          entityId: 'line-A',
          oldRelatedIds: [],
          newRelatedIds: ['order-1'],
          inverseInfo: HAS_MANY_INVERSE,
        }
      )
    ).resolves.toEqual({ removedFrom: [], addedTo: ['order-1'] })
  })

  it('says nothing when nothing changed', async () => {
    await syncInverseRelationships(
      { db: fakeDb([]), organizationId: 'org-1' },
      {
        entityId: 'line-A',
        oldRelatedIds: ['order-1'],
        newRelatedIds: ['order-1'],
        inverseInfo: HAS_MANY_INVERSE,
      }
    )

    expect(publishFieldValueUpdates).not.toHaveBeenCalled()
    expect(recordTxWriteChange).not.toHaveBeenCalled()
  })
})
