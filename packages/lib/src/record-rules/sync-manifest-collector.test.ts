// packages/lib/src/record-rules/sync-manifest-collector.test.ts

import { describe, expect, it } from 'vitest'
import type { SyncRuleSubscriptions } from './subscriptions'
import { createManifestCollector, mergeManifests } from './sync-manifest-collector'
import type { SyncChangeManifest } from './sync-manifest-types'

const RID = (s: string) => s as unknown as import('@auxx/types/resource').RecordId

function subs(overrides: SyncRuleSubscriptions = {}): SyncRuleSubscriptions {
  return {
    def_1: { fieldIds: new Set(['fld_a', 'fld_b']), lifecycle: { created: true, deleted: true } },
    ...overrides,
  }
}

describe('createManifestCollector', () => {
  it('returns a zero-cost no-op stub when no subscriptions', () => {
    const c = createManifestCollector({})
    expect(c.enabled).toBe(false)
    c.recordChange(RID('def_1:i1'), { fld_a: { n: 1 } })
    c.recordCreated(RID('def_1:i1'))
    expect(c.toJson()).toBeNull()
    expect(c.subscriptionsFor('def_1')).toBeUndefined()
  })

  it('captures field changes keyed by RecordId → outputKey', () => {
    const c = createManifestCollector(subs())
    c.recordChange(RID('def_1:i1'), { fld_a: { o: 1, n: 2 }, fld_b: { n: 'x' } })
    const m = c.toJson()
    expect(m).not.toBeNull()
    expect(m!.changes['def_1:i1']).toEqual({ fld_a: { o: 1, n: 2 }, fld_b: { n: 'x' } })
    expect(m!.version).toBe(1)
    expect(m!.truncated).toBe(false)
  })

  it('merges repeated writes: union keys, first o wins, last n wins', () => {
    const c = createManifestCollector(subs())
    c.recordChange(RID('def_1:i1'), { fld_a: { o: 1, n: 2 } })
    c.recordChange(RID('def_1:i1'), { fld_a: { o: 99, n: 3 }, fld_b: { n: 'y' } })
    const m = c.toJson()!
    expect(m.changes['def_1:i1']).toEqual({ fld_a: { o: 1, n: 3 }, fld_b: { n: 'y' } })
  })

  // F6: `o`-absence marks "created this run" — a later update in the same slice must
  // not graft its pre-read `o` (the values the create just wrote) onto the entry, or a
  // `set` rule (isEmpty(o)) would never fire for created-then-updated records.
  it('create-then-update keeps o absent (created-this-run stays a set transition)', () => {
    const c = createManifestCollector(subs())
    c.recordChange(RID('def_1:i1'), { fld_a: { n: 'v' } }) // create capture — no o
    c.recordChange(RID('def_1:i1'), { fld_a: { o: 'v', n: 'v2' } }) // update capture
    const m = c.toJson()!
    expect(m.changes['def_1:i1']).toEqual({ fld_a: { n: 'v2' } })
  })

  it('records created/archived lifecycle ids, dedup', () => {
    const c = createManifestCollector(subs())
    c.recordCreated(RID('def_1:i1'))
    c.recordCreated(RID('def_1:i1'))
    c.recordArchived(RID('def_1:i2'))
    const m = c.toJson()!
    expect(m.createdRecordIds).toEqual(['def_1:i1'])
    expect(m.archivedRecordIds).toEqual(['def_1:i2'])
  })

  it('enforces the changed-records cap + sets truncated', () => {
    const c = createManifestCollector(subs())
    for (let i = 0; i < 5001; i++) c.recordChange(RID(`def_1:i${i}`), { fld_a: { n: i } })
    const m = c.toJson()!
    expect(Object.keys(m.changes).length).toBe(5000)
    expect(m.truncated).toBe(true)
  })

  it('empty recordChange entries are ignored', () => {
    const c = createManifestCollector(subs())
    c.recordChange(RID('def_1:i1'), {})
    expect(c.toJson()).toBeNull()
  })

  // Phase 9 / Option A: created raw values threaded for native entity-trigger handlers.
  it('stashes created values keyed by RecordId', () => {
    const c = createManifestCollector(subs())
    c.recordCreated(RID('def_1:i1'), { company_domain: 'a.com' })
    c.recordCreated(RID('def_1:i2')) // no values
    const m = c.toJson()!
    expect(m.createdValues).toEqual({ 'def_1:i1': { company_domain: 'a.com' } })
    expect(m.createdRecordIds).toEqual(['def_1:i1', 'def_1:i2'])
  })

  it('omits createdValues entirely when none were provided', () => {
    const c = createManifestCollector(subs())
    c.recordCreated(RID('def_1:i1'))
    expect(c.toJson()!.createdValues).toBeUndefined()
  })

  it('does not stash values for a duplicate created id', () => {
    const c = createManifestCollector(subs())
    c.recordCreated(RID('def_1:i1'), { company_domain: 'first.com' })
    c.recordCreated(RID('def_1:i1'), { company_domain: 'second.com' })
    expect(c.toJson()!.createdValues).toEqual({ 'def_1:i1': { company_domain: 'first.com' } })
  })
})

function manifest(over: Partial<SyncChangeManifest> = {}): SyncChangeManifest {
  return {
    version: 1,
    truncated: false,
    changes: {},
    createdRecordIds: [],
    archivedRecordIds: [],
    ...over,
  }
}

describe('mergeManifests', () => {
  it('returns the other side when one is null', () => {
    const m = manifest({ createdRecordIds: [RID('d:1')] })
    expect(mergeManifests(null, m)).toBe(m)
    expect(mergeManifests(m, null)).toBe(m)
    expect(mergeManifests(null, null)).toBeNull()
  })

  it('deep-merges changes: first o wins, last n wins, union keys/records', () => {
    const base = manifest({
      changes: { 'd:1': { fa: { o: 1, n: 2 } } } as never,
    })
    const add = manifest({
      changes: { 'd:1': { fa: { o: 99, n: 3 }, fb: { n: 'x' } }, 'd:2': { fc: { n: 5 } } } as never,
    })
    const merged = mergeManifests(base, add)!
    expect(merged.changes['d:1' as never]).toEqual({ fa: { o: 1, n: 3 }, fb: { n: 'x' } })
    expect(merged.changes['d:2' as never]).toEqual({ fc: { n: 5 } })
  })

  // F6 across slices: create in slice 1, update in slice 2 — the fold preserves the
  // create's o-absence exactly like the in-slice merge.
  it('cross-slice create-then-update keeps o absent through the fold', () => {
    const base = manifest({ changes: { 'd:1': { fa: { n: 'v' } } } as never })
    const add = manifest({ changes: { 'd:1': { fa: { o: 'v', n: 'v2' } } } as never })
    const merged = mergeManifests(base, add)!
    expect(merged.changes['d:1' as never]).toEqual({ fa: { n: 'v2' } })
  })

  it('unions lifecycle ids and ORs truncated', () => {
    const base = manifest({ createdRecordIds: [RID('d:1')], truncated: false })
    const add = manifest({ createdRecordIds: [RID('d:1'), RID('d:2')], truncated: true })
    const merged = mergeManifests(base, add)!
    expect(merged.createdRecordIds.sort()).toEqual(['d:1', 'd:2'])
    expect(merged.truncated).toBe(true)
  })

  it('unions createdValues, base wins on a duplicate id', () => {
    const base = manifest({
      createdRecordIds: [RID('d:1')],
      createdValues: { [RID('d:1')]: { company_domain: 'base.com' } },
    })
    const add = manifest({
      createdRecordIds: [RID('d:1'), RID('d:2')],
      createdValues: {
        [RID('d:1')]: { company_domain: 'add.com' },
        [RID('d:2')]: { company_domain: 'two.com' },
      },
    })
    const merged = mergeManifests(base, add)!
    expect(merged.createdValues).toEqual({
      'd:1': { company_domain: 'base.com' },
      'd:2': { company_domain: 'two.com' },
    })
  })

  it('enforces the run-level changed-records cap across the fold', () => {
    // Two slices each below the per-slice cap still overflow the run when folded.
    const changesFor = (start: number, count: number) => {
      const changes: Record<string, { fa: { n: number } }> = {}
      for (let i = start; i < start + count; i++) changes[`d:${i}`] = { fa: { n: i } }
      return changes as never
    }
    const base = manifest({ changes: changesFor(0, 3000) })
    const add = manifest({ changes: changesFor(3000, 3000) })
    const merged = mergeManifests(base, add)!
    expect(Object.keys(merged.changes).length).toBe(5000)
    expect(merged.truncated).toBe(true)
  })

  it('updating an already-present record past the cap is free', () => {
    const changes: Record<string, { fa: { n: number } }> = {}
    for (let i = 0; i < 5000; i++) changes[`d:${i}`] = { fa: { n: i } }
    const base = manifest({ changes: changes as never })
    // `add` re-touches an existing record (no new key) — must merge, not truncate.
    const add = manifest({ changes: { 'd:0': { fa: { n: 999 } } } as never })
    const merged = mergeManifests(base, add)!
    expect(Object.keys(merged.changes).length).toBe(5000)
    expect(merged.truncated).toBe(false)
    expect(merged.changes['d:0' as never]).toEqual({ fa: { n: 999 } })
  })
})
