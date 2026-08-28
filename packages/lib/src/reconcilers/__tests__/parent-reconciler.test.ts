// packages/lib/src/reconcilers/__tests__/parent-reconciler.test.ts
//
// Plan 08 phase 3. `dirty-parents.test.ts` pins the BUFFER — when work runs.
// This pins the layer above it: how a marked id becomes a deduped set of parents,
// and what happens when nothing is there to drain into.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetReconcilersForTest, runWithDirtyParents } from '../dirty-parents'
import { defineParentReconciler } from '../parent-reconciler'

const ORG = 'org_1'
const USER = 'usr_1'

beforeEach(() => {
  __resetReconcilersForTest()
})

describe('the self case — the marked record IS the parent', () => {
  it('passes marked ids straight through as parents', async () => {
    const rebuild = vi.fn(async (_org: string, _user: string, _parent: unknown) => {})
    const r = defineParentReconciler<string>({ key: 'k', rebuild })
    r.register()

    await runWithDirtyParents(ORG, USER, async () => {
      await r.mark(ORG, USER, 'p-1')
      await r.mark(ORG, USER, 'p-2')
    })

    expect(rebuild.mock.calls.map((c) => c[2])).toEqual(['p-1', 'p-2'])
  })

  it('coalesces repeated marks of one parent into a single rebuild', async () => {
    const rebuild = vi.fn(async (_org: string, _user: string, _parent: unknown) => {})
    const r = defineParentReconciler<string>({ key: 'k', rebuild })
    r.register()

    await runWithDirtyParents(ORG, USER, async () => {
      for (let i = 0; i < 20; i++) await r.mark(ORG, USER, 'p-1')
    })

    expect(rebuild).toHaveBeenCalledTimes(1)
  })
})

describe('the child case — the marked record is resolved to a parent', () => {
  it('calls resolve ONCE with the whole batch, not once per child', async () => {
    const resolve = vi.fn(async (_org: string, _ids: string[]) => ['doc-1'])
    const rebuild = vi.fn(async (_org: string, _user: string, _parent: unknown) => {})
    const r = defineParentReconciler<string>({ key: 'k', resolve, rebuild })
    r.register()

    await runWithDirtyParents(ORG, USER, async () => {
      for (const id of ['c-1', 'c-2', 'c-3']) await r.mark(ORG, USER, id)
    })

    // The entire point of the drain: one resolution query for the batch.
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolve.mock.calls[0]![1]).toEqual(['c-1', 'c-2', 'c-3'])
    expect(rebuild).toHaveBeenCalledTimes(1)
  })

  it('rebuilds nothing when every child is orphaned', async () => {
    const rebuild = vi.fn(async (_org: string, _user: string, _parent: unknown) => {})
    const r = defineParentReconciler<string>({
      key: 'k',
      resolve: async () => [],
      rebuild,
    })
    r.register()

    await runWithDirtyParents(ORG, USER, async () => {
      await r.mark(ORG, USER, 'c-1')
    })

    expect(rebuild).not.toHaveBeenCalled()
  })

  it('collapses many children of one parent into a single rebuild', async () => {
    const rebuild = vi.fn(async (_org: string, _user: string, _parent: unknown) => {})
    const r = defineParentReconciler<string>({
      key: 'k',
      resolve: async (_org, ids) => ids.map(() => 'doc-1'),
      rebuild,
    })
    r.register()

    await runWithDirtyParents(ORG, USER, async () => {
      for (const id of ['c-1', 'c-2', 'c-3']) await r.mark(ORG, USER, id)
    })

    expect(rebuild).toHaveBeenCalledTimes(1)
  })
})

describe('dedupeKey', () => {
  interface Doc {
    documentType: string
    documentInstanceId: string
  }

  it('treats a composite parent as one parent only when BOTH halves match', async () => {
    const rebuild = vi.fn(async (_org: string, _user: string, _parent: unknown) => {})
    const r = defineParentReconciler<Doc>({
      key: 'k',
      resolve: async () => [
        { documentType: 'quote', documentInstanceId: 'x' },
        { documentType: 'invoice', documentInstanceId: 'x' }, // same id, other type
        { documentType: 'quote', documentInstanceId: 'x' }, // a real duplicate
      ],
      dedupeKey: (p) => `${p.documentType}:${p.documentInstanceId}`,
      rebuild,
    })
    r.register()

    await runWithDirtyParents(ORG, USER, async () => {
      await r.mark(ORG, USER, 'c-1')
    })

    // Without the composite key the invoice would be swallowed by the quote,
    // which is money's exact failure mode: two documents share an id keyspace.
    expect(rebuild.mock.calls.map((c) => (c[2] as Doc).documentType)).toEqual(['quote', 'invoice'])
  })

  it('falls back to the parent itself when no dedupeKey is given', async () => {
    const rebuild = vi.fn(async (_org: string, _user: string, _parent: unknown) => {})
    const r = defineParentReconciler<string>({
      key: 'k',
      resolve: async () => ['a', 'b', 'a'],
      rebuild,
    })
    r.register()

    await runWithDirtyParents(ORG, USER, async () => {
      await r.mark(ORG, USER, 'c-1')
    })

    expect(rebuild.mock.calls.map((c) => c[2])).toEqual(['a', 'b'])
  })
})

describe('the unscoped inline fallback', () => {
  it('does the work immediately when no write method opened a scope', async () => {
    const rebuild = vi.fn(async (_org: string, _user: string, _parent: unknown) => {})
    const r = defineParentReconciler<string>({ key: 'k', rebuild })
    r.register()

    // No `runWithDirtyParents` — the shape of a caller that reached the hook
    // chain through an exported `field-value-mutations` function.
    await r.mark(ORG, USER, 'p-1')

    expect(rebuild).toHaveBeenCalledTimes(1)
    expect(rebuild.mock.calls[0]![2]).toBe('p-1')
  })

  it('resolves the parent inline too, for a child mark', async () => {
    const rebuild = vi.fn(async (_org: string, _user: string, _parent: unknown) => {})
    const r = defineParentReconciler<string>({
      key: 'k',
      resolve: async () => ['doc-1'],
      rebuild,
    })
    r.register()

    await r.mark(ORG, USER, 'c-1')

    expect(rebuild.mock.calls[0]![2]).toBe('doc-1')
  })

  it('still works when register() was never called — the inline path skips the registry', async () => {
    const rebuild = vi.fn(async (_org: string, _user: string, _parent: unknown) => {})
    const r = defineParentReconciler<string>({ key: 'k', rebuild })

    await r.mark(ORG, USER, 'p-1')

    expect(rebuild).toHaveBeenCalledTimes(1)
  })
})

describe('rebuildBatch', () => {
  it('receives the whole deduped batch once, for a consumer with per-batch setup', async () => {
    const rebuildBatch = vi.fn(async (_org: string, _user: string, _parents: unknown[]) => {})
    const r = defineParentReconciler<string>({
      key: 'k',
      resolve: async () => ['o-1', 'o-2', 'o-1'],
      rebuildBatch,
    })
    r.register()

    await runWithDirtyParents(ORG, USER, async () => {
      await r.mark(ORG, USER, 'c-1')
    })

    expect(rebuildBatch).toHaveBeenCalledTimes(1)
    expect(rebuildBatch.mock.calls[0]![2]).toEqual(['o-1', 'o-2'])
  })

  it('is not called at all for an empty batch', async () => {
    const rebuildBatch = vi.fn(async (_org: string, _user: string, _parents: unknown[]) => {})
    const r = defineParentReconciler<string>({
      key: 'k',
      resolve: async () => [],
      rebuildBatch,
    })
    r.register()

    await runWithDirtyParents(ORG, USER, async () => {
      await r.mark(ORG, USER, 'c-1')
    })

    expect(rebuildBatch).not.toHaveBeenCalled()
  })
})

describe('register', () => {
  it('is idempotent — a repeated bootstrap does not install two drains', async () => {
    const rebuild = vi.fn(async (_org: string, _user: string, _parent: unknown) => {})
    const r = defineParentReconciler<string>({ key: 'k', rebuild })
    r.register()
    r.register()
    r.register()

    await runWithDirtyParents(ORG, USER, async () => {
      await r.mark(ORG, USER, 'p-1')
    })

    expect(rebuild).toHaveBeenCalledTimes(1)
  })
})

describe('failure isolation is per PARENT', () => {
  it('a throwing parent does not lose the parents after it', async () => {
    const rebuild = vi.fn(async (_org: string, _user: string, parent: string) => {
      if (parent === 'b') throw new Error('boom')
    })
    const r = defineParentReconciler<string>({
      key: 'k',
      resolve: async () => ['a', 'b', 'c'],
      rebuild,
    })
    r.register()

    // A drain batch is several UNRELATED user documents, so one failing must not
    // decide the fate of the rest. This inverts what #1959 pinned: that test
    // recorded the shipped behaviour (a mid-batch throw abandoned `c`), which
    // contradicted the doc comments three consumers carried and the isolation
    // `builds/drift-reconciler.ts` had actually implemented. Plan 08 §6.3.
    await expect(
      runWithDirtyParents(ORG, USER, async () => {
        await r.mark(ORG, USER, 'c-1')
      })
    ).resolves.toBeUndefined()

    expect(rebuild.mock.calls.map((c) => c[2])).toEqual(['a', 'b', 'c'])
  })

  it('isolates every failure, not just the first', async () => {
    const rebuild = vi.fn(async (_org: string, _user: string, parent: string) => {
      if (parent !== 'c') throw new Error('boom')
    })
    const r = defineParentReconciler<string>({
      key: 'k',
      resolve: async () => ['a', 'b', 'c'],
      rebuild,
    })
    r.register()

    await runWithDirtyParents(ORG, USER, async () => {
      await r.mark(ORG, USER, 'c-1')
    })

    expect(rebuild).toHaveBeenCalledTimes(3)
  })

  it('still never surfaces a failure to the writer — the write already committed', async () => {
    const r = defineParentReconciler<string>({
      key: 'k',
      resolve: async () => ['a'],
      rebuild: async () => {
        throw new Error('boom')
      },
    })
    r.register()

    await expect(
      runWithDirtyParents(ORG, USER, async () => {
        await r.mark(ORG, USER, 'c-1')
      })
    ).resolves.toBeUndefined()
  })

  it('another key still drains after one key throws', async () => {
    const good = vi.fn(async (_org: string, _user: string, _parent: unknown) => {})
    const bad = defineParentReconciler<string>({
      key: 'bad',
      rebuild: async () => {
        throw new Error('boom')
      },
    })
    const ok = defineParentReconciler<string>({ key: 'good', rebuild: good })
    bad.register()
    ok.register()

    await runWithDirtyParents(ORG, USER, async () => {
      await bad.mark(ORG, USER, 'x')
      await ok.mark(ORG, USER, 'y')
    })

    expect(good).toHaveBeenCalledTimes(1)
  })
})
