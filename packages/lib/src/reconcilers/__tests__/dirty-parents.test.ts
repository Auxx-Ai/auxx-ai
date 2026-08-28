// packages/lib/src/reconcilers/__tests__/dirty-parents.test.ts
//
// Plan 08 phase 2. What these pin is COALESCING and the two exits — behaviour no
// consumer's own tests can see, because a consumer passes just as well when its
// reconciler runs 40 times as when it runs once.

import { beforeEach, describe, expect, it } from 'vitest'
import { createTxWriteScope } from '../../resources/crud/tx-write-scope'
import type { WriteSession } from '../../resources/crud/write-origin'
import { runWithWriteSession } from '../../resources/crud/write-session-als'
import {
  __resetReconcilersForTest,
  drainDeferredDirtyParents,
  MAX_DIRTY_PARENTS_PER_KEY,
  markParentDirty,
  registerReconciler,
  runWithDirtyParents,
} from '../dirty-parents'

const ORG = 'org_1'
const USER = 'usr_1'

/** Ids handed to the drain for `key`, per call. */
function spyReconciler(key: string) {
  const calls: string[][] = []
  registerReconciler(key, async ({ parentInstanceIds }) => {
    calls.push(parentInstanceIds)
  })
  return calls
}

beforeEach(() => {
  __resetReconcilersForTest()
})

describe('coalescing', () => {
  it('collapses many marks of one parent into a single drain', async () => {
    const calls = spyReconciler('k')

    await runWithDirtyParents(ORG, USER, async () => {
      // The shape of a 20-line paste: two trigger attributes per line, every one
      // of them resolving to the same document.
      for (let i = 0; i < 40; i++) markParentDirty('k', 'doc-1')
    })

    expect(calls).toEqual([['doc-1']])
  })

  it('keeps distinct parents, in first-marked order', async () => {
    const calls = spyReconciler('k')

    await runWithDirtyParents(ORG, USER, async () => {
      markParentDirty('k', 'b')
      markParentDirty('k', 'a')
      markParentDirty('k', 'b')
    })

    expect(calls).toEqual([['b', 'a']])
  })

  it('drains each key with its own batch', async () => {
    const lines = spyReconciler('lines')
    const docs = spyReconciler('docs')

    await runWithDirtyParents(ORG, USER, async () => {
      markParentDirty('lines', 'li-1')
      markParentDirty('docs', 'q-1')
      markParentDirty('lines', 'li-2')
    })

    expect(lines).toEqual([['li-1', 'li-2']])
    expect(docs).toEqual([['q-1']])
  })

  it('does not drain a key nothing marked', async () => {
    const calls = spyReconciler('k')
    await runWithDirtyParents(ORG, USER, async () => {})
    expect(calls).toEqual([])
  })
})

describe('nesting joins', () => {
  it('produces ONE drain however deep the writes nest', async () => {
    const calls = spyReconciler('k')

    await runWithDirtyParents(ORG, USER, async () => {
      markParentDirty('k', 'doc-1')
      // A hook that constructs its own handler mid-write.
      await runWithDirtyParents(ORG, USER, async () => {
        markParentDirty('k', 'doc-1')
        await runWithDirtyParents(ORG, USER, async () => markParentDirty('k', 'doc-2'))
      })
    })

    expect(calls).toEqual([['doc-1', 'doc-2']])
  })

  it('an inner scope does not drain on its own way out', async () => {
    const seen: number[] = []
    registerReconciler('k', async ({ parentInstanceIds }) => {
      seen.push(parentInstanceIds.length)
    })

    await runWithDirtyParents(ORG, USER, async () => {
      await runWithDirtyParents(ORG, USER, async () => markParentDirty('k', 'a'))
      // If the inner scope had drained, this mark would land in a second batch.
      markParentDirty('k', 'b')
    })

    expect(seen).toEqual([2])
  })
})

describe('the unscoped fallback', () => {
  it('reports false with no ambient scope, so the caller does the work inline', () => {
    spyReconciler('k')
    expect(markParentDirty('k', 'doc-1')).toBe(false)
  })

  it('reports true inside a scope', async () => {
    spyReconciler('k')
    await runWithDirtyParents(ORG, USER, async () => {
      expect(markParentDirty('k', 'doc-1')).toBe(true)
    })
  })

  it('reports true for an empty id rather than sending the caller off to recompute nothing', () => {
    expect(markParentDirty('k', '')).toBe(true)
  })
})

describe('failure isolation', () => {
  it('does not drain at all when the write threw', async () => {
    const calls = spyReconciler('k')

    await expect(
      runWithDirtyParents(ORG, USER, async () => {
        markParentDirty('k', 'doc-1')
        throw new Error('write failed')
      })
    ).rejects.toThrow('write failed')

    expect(calls).toEqual([])
  })

  it('one reconciler throwing does not lose another reconciler batch', async () => {
    registerReconciler('bad', async () => {
      throw new Error('boom')
    })
    const good = spyReconciler('good')

    await runWithDirtyParents(ORG, USER, async () => {
      markParentDirty('bad', 'x')
      markParentDirty('good', 'y')
    })

    expect(good).toEqual([['y']])
  })

  it('never surfaces a reconciler failure to the writer', async () => {
    registerReconciler('bad', async () => {
      throw new Error('boom')
    })

    await expect(
      runWithDirtyParents(ORG, USER, async () => {
        markParentDirty('bad', 'x')
      })
    ).resolves.toBeUndefined()
  })

  it('a key with no registered reconciler is logged, not thrown', async () => {
    await expect(
      runWithDirtyParents(ORG, USER, async () => {
        markParentDirty('nobody', 'x')
      })
    ).resolves.toBeUndefined()
  })
})

describe('one pass, ever', () => {
  it('drops a mark made BY the drain, and reports it handled', async () => {
    const calls: string[][] = []
    registerReconciler('k', async ({ parentInstanceIds }) => {
      calls.push(parentInstanceIds)
      // A reconciler that writes; its write re-enters the hook chain.
      expect(markParentDirty('k', 'doc-1')).toBe(true)
    })

    await runWithDirtyParents(ORG, USER, async () => markParentDirty('k', 'doc-1'))

    expect(calls).toEqual([['doc-1']])
  })
})

describe('the cap', () => {
  it('buffers up to the cap and drops beyond it, still reporting handled', async () => {
    const calls = spyReconciler('k')

    await runWithDirtyParents(ORG, USER, async () => {
      for (let i = 0; i < MAX_DIRTY_PARENTS_PER_KEY + 5; i++) {
        expect(markParentDirty('k', `doc-${i}`)).toBe(true)
      }
    })

    expect(calls[0]).toHaveLength(MAX_DIRTY_PARENTS_PER_KEY)
  })

  it('still accepts a parent already buffered once the cap is reached', async () => {
    const calls = spyReconciler('k')

    await runWithDirtyParents(ORG, USER, async () => {
      for (let i = 0; i < MAX_DIRTY_PARENTS_PER_KEY; i++) markParentDirty('k', `doc-${i}`)
      markParentDirty('k', 'doc-0')
    })

    expect(calls[0]).toHaveLength(MAX_DIRTY_PARENTS_PER_KEY)
  })
})

describe('the transaction exit', () => {
  function buffered(scope: ReturnType<typeof createTxWriteScope>): WriteSession {
    return {
      origin: { kind: 'interactive', userId: USER },
      depth: 0,
      mode: { kind: 'buffered', scope },
    } as WriteSession
  }

  it('hands the batch to the TxWriteScope instead of draining mid-transaction', async () => {
    const calls = spyReconciler('k')
    const tx = createTxWriteScope(ORG, USER)

    await runWithWriteSession(buffered(tx), () =>
      runWithDirtyParents(ORG, USER, async () => {
        markParentDirty('k', 'doc-1')
        markParentDirty('k', 'doc-2')
      })
    )

    // Nothing ran yet — the transaction has not committed.
    expect(calls).toEqual([])
    expect([...(tx.dirtyParents.get('k') ?? [])]).toEqual(['doc-1', 'doc-2'])
  })

  it('drains what the transaction carried, once it commits', async () => {
    const calls = spyReconciler('k')
    const tx = createTxWriteScope(ORG, USER)

    await runWithWriteSession(buffered(tx), () =>
      runWithDirtyParents(ORG, USER, async () => markParentDirty('k', 'doc-1'))
    )
    await drainDeferredDirtyParents({
      organizationId: ORG,
      userId: USER,
      dirty: tx.dirtyParents,
    })

    expect(calls).toEqual([['doc-1']])
  })

  it('unions two write methods inside one transaction into a single batch', async () => {
    const calls = spyReconciler('k')
    const tx = createTxWriteScope(ORG, USER)

    await runWithWriteSession(buffered(tx), async () => {
      await runWithDirtyParents(ORG, USER, async () => markParentDirty('k', 'doc-1'))
      await runWithDirtyParents(ORG, USER, async () => markParentDirty('k', 'doc-2'))
    })
    await drainDeferredDirtyParents({
      organizationId: ORG,
      userId: USER,
      dirty: tx.dirtyParents,
    })

    expect(calls).toEqual([['doc-1', 'doc-2']])
  })

  it('the buffer it carries is still structured-cloneable — T-4 holds', () => {
    const tx = createTxWriteScope(ORG, USER)
    tx.dirtyParents.set('k', new Set(['doc-1']))
    expect(() => structuredClone(tx)).not.toThrow()
  })
})
