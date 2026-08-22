// packages/lib/src/record-rules/sync-manifest-collector.test.ts

import { describe, expect, it } from 'vitest'
import type { SyncRuleSubscriptions } from './subscriptions'
import {
  createManifestCollector,
  MAX_DELTA_RECORDS,
  MAX_TOUCHED_RECORDS,
  mergeManifests,
  TOUCHED_KEYS_BYTE_BUDGET,
  upgradeManifestV1,
} from './sync-manifest-collector'
import type { SyncChangeManifest, SyncChangeManifestV1 } from './sync-manifest-types'

const RID = (s: string) => s as unknown as import('@auxx/types/resource').RecordId

function subs(overrides: SyncRuleSubscriptions = {}): SyncRuleSubscriptions {
  return {
    def_1: { fieldIds: new Set(['fld_a', 'fld_b']), lifecycle: { created: true, deleted: true } },
    ...overrides,
  }
}

describe('createManifestCollector', () => {
  it('exports the plan 07 cap defaults', () => {
    expect(MAX_TOUCHED_RECORDS).toBe(50_000)
    expect(TOUCHED_KEYS_BYTE_BUDGET).toBe(2_000_000)
    expect(MAX_DELTA_RECORDS).toBe(5_000)
  })

  // Plan 07 H-1: the NOOP-when-no-subscriptions gate is gone. Tier-1 membership is
  // unconditional; zero subscriptions only means tier-2 never captures (the engine
  // seams gate on `subscriptionsFor`).
  it('is always real: zero subscriptions still capture touched + lifecycle, zero deltas', () => {
    const c = createManifestCollector({})
    expect(c.subscriptionsFor('def_1')).toBeUndefined()
    c.recordTouched(RID('def_1:i1'), ['fld_a'])
    c.recordCreated(RID('def_1:i2'))
    c.recordArchived(RID('def_1:i3'))
    const m = c.toJson()!
    expect(m.version).toBe(2)
    expect(m.touched).toEqual({ 'def_1:i1': ['fld_a'] })
    expect(m.createdRecordIds).toEqual(['def_1:i2'])
    expect(m.archivedRecordIds).toEqual(['def_1:i3'])
    expect(m.deltas).toEqual({})
    expect(m.detailTruncated).toBe(false)
    expect(m.membershipTruncated).toBe(false)
  })

  it('toJson is null when literally nothing was captured', () => {
    const c = createManifestCollector(subs())
    expect(c.toJson()).toBeNull()
  })

  it('recordTouched merges keys per record (set union)', () => {
    const c = createManifestCollector(subs())
    c.recordTouched(RID('def_1:i1'), ['fld_a', 'fld_b'])
    c.recordTouched(RID('def_1:i1'), ['fld_b', 'fld_c'])
    const m = c.toJson()!
    expect(m.touched[RID('def_1:i1')]).toEqual(['fld_a', 'fld_b', 'fld_c'])
  })

  it('captures deltas keyed by RecordId → outputKey', () => {
    const c = createManifestCollector(subs())
    c.recordChange(RID('def_1:i1'), { fld_a: { o: 1, n: 2 }, fld_b: { n: 'x' } })
    const m = c.toJson()!
    expect(m.deltas[RID('def_1:i1')]).toEqual({ fld_a: { o: 1, n: 2 }, fld_b: { n: 'x' } })
  })

  it('recordChange implies touched membership with the delta keys', () => {
    const c = createManifestCollector(subs())
    c.recordChange(RID('def_1:i1'), { fld_a: { o: 1, n: 2 }, fld_b: { n: 'x' } })
    const m = c.toJson()!
    expect(m.touched[RID('def_1:i1')]).toEqual(['fld_a', 'fld_b'])
  })

  it('merges repeated writes: union keys, first o wins, last n wins', () => {
    const c = createManifestCollector(subs())
    c.recordChange(RID('def_1:i1'), { fld_a: { o: 1, n: 2 } })
    c.recordChange(RID('def_1:i1'), { fld_a: { o: 99, n: 3 }, fld_b: { n: 'y' } })
    const m = c.toJson()!
    expect(m.deltas[RID('def_1:i1')]).toEqual({ fld_a: { o: 1, n: 3 }, fld_b: { n: 'y' } })
  })

  // F6: `o`-absence marks "created this run" — a later update in the same slice must
  // not graft its pre-read `o` (the values the create just wrote) onto the entry, or a
  // `set` rule (isEmpty(o)) would never fire for created-then-updated records.
  it('create-then-update keeps o absent (created-this-run stays a set transition)', () => {
    const c = createManifestCollector(subs())
    c.recordChange(RID('def_1:i1'), { fld_a: { n: 'v' } }) // create capture — no o
    c.recordChange(RID('def_1:i1'), { fld_a: { o: 'v', n: 'v2' } }) // update capture
    const m = c.toJson()!
    expect(m.deltas[RID('def_1:i1')]).toEqual({ fld_a: { n: 'v2' } })
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

  // The dual-keyspace trap (plan 04 §11.2): producers key RecordIds by slug for imports
  // and by canonical EntityDefinition CUID elsewhere. Identity is the entity INSTANCE
  // id — the same instance under two RecordId forms folds to ONE entry, first-seen
  // RecordId form wins as the emitted key.
  it('dedupes touched on the instance id across the two RecordId keyspaces', () => {
    const c = createManifestCollector(subs())
    c.recordTouched(RID('contact:inst1'), ['fld_a'])
    c.recordTouched(RID('cuid_def_x:inst1'), ['fld_b'])
    const m = c.toJson()!
    expect(Object.keys(m.touched)).toEqual(['contact:inst1'])
    expect(m.touched[RID('contact:inst1')]).toEqual(['fld_a', 'fld_b'])
  })

  it('dedupes deltas and lifecycle on the instance id across keyspaces', () => {
    const c = createManifestCollector(subs())
    c.recordChange(RID('contact:inst1'), { fld_a: { o: 1, n: 2 } })
    c.recordChange(RID('cuid_def_x:inst1'), { fld_a: { o: 99, n: 3 } })
    c.recordCreated(RID('contact:inst2'))
    c.recordCreated(RID('cuid_def_x:inst2'))
    const m = c.toJson()!
    expect(Object.keys(m.deltas)).toEqual(['contact:inst1'])
    expect(m.deltas[RID('contact:inst1')]).toEqual({ fld_a: { o: 1, n: 3 } })
    expect(m.createdRecordIds).toEqual(['contact:inst2'])
  })

  it('delta cap sets detailTruncated ONLY — membership stays complete', () => {
    const c = createManifestCollector(subs(), { maxDeltaRecords: 3 })
    for (let i = 0; i < 5; i++) c.recordChange(RID(`def_1:i${i}`), { fld_a: { n: i } })
    const m = c.toJson()!
    expect(Object.keys(m.deltas).length).toBe(3)
    expect(m.detailTruncated).toBe(true)
    expect(m.membershipTruncated).toBe(false)
    // Every record still made tier-1 membership, keys intact.
    expect(Object.keys(m.touched).length).toBe(5)
    expect(m.touched[RID('def_1:i4')]).toEqual(['fld_a'])
  })

  it('membership cap sets membershipTruncated while captured deltas stay intact', () => {
    const c = createManifestCollector(subs(), { maxTouchedRecords: 2 })
    c.recordTouched(RID('def_1:i1'), ['fld_a'])
    c.recordTouched(RID('def_1:i2'), ['fld_a'])
    c.recordTouched(RID('def_1:i3'), ['fld_a']) // over the cap
    c.recordCreated(RID('def_1:i4')) // membership union — also capped
    // Deltas have their own cap; a membership-capped record still captures detail.
    c.recordChange(RID('def_1:i5'), { fld_a: { o: 1, n: 2 } })
    const m = c.toJson()!
    expect(m.membershipTruncated).toBe(true)
    expect(Object.keys(m.touched).sort()).toEqual(['def_1:i1', 'def_1:i2'])
    expect(m.createdRecordIds).toEqual([])
    expect(m.deltas[RID('def_1:i5')]).toEqual({ fld_a: { o: 1, n: 2 } })
    expect(m.detailTruncated).toBe(false)
  })

  it('membership cap spans touched ∪ created ∪ archived, an existing member is free', () => {
    const c = createManifestCollector(subs(), { maxTouchedRecords: 2 })
    c.recordCreated(RID('def_1:i1'))
    c.recordArchived(RID('def_1:i2'))
    // i1 is already a member — touching it again is free, no truncation.
    c.recordTouched(RID('def_1:i1'), ['fld_a'])
    expect(c.toJson()!.membershipTruncated).toBe(false)
    c.recordTouched(RID('def_1:i3'), ['fld_a'])
    const m = c.toJson()!
    expect(m.membershipTruncated).toBe(true)
    expect(m.touched[RID('def_1:i1')]).toEqual(['fld_a'])
  })

  it('byte budget degrades NEW touched entries to ids-only; existing entries keep keys', () => {
    const c = createManifestCollector(subs(), { touchedKeysByteBudget: 10 })
    c.recordTouched(RID('def_1:i1'), ['abcdef']) // 6 bytes — under budget
    c.recordTouched(RID('def_1:i2'), ['ghijkl']) // entry created at 6 < 10, now 12
    c.recordTouched(RID('def_1:i3'), ['mn']) // 12 >= 10 — new entry goes ids-only
    c.recordTouched(RID('def_1:i1'), ['op']) // existing entry keeps merging keys
    const m = c.toJson()!
    expect(m.touched[RID('def_1:i1')]).toEqual(['abcdef', 'op'])
    expect(m.touched[RID('def_1:i2')]).toEqual(['ghijkl'])
    expect(m.touched[RID('def_1:i3')]).toBe(1)
    // Degradation is not truncation — membership is still complete.
    expect(m.membershipTruncated).toBe(false)
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
    version: 2,
    detailTruncated: false,
    membershipTruncated: false,
    touched: {},
    deltas: {},
    createdRecordIds: [],
    archivedRecordIds: [],
    ...over,
  }
}

function manifestV1(over: Partial<SyncChangeManifestV1> = {}): SyncChangeManifestV1 {
  return {
    version: 1,
    truncated: false,
    changes: {},
    createdRecordIds: [],
    archivedRecordIds: [],
    ...over,
  }
}

describe('upgradeManifestV1', () => {
  it('derives v2: touched from changes keys, deltas = changes, flags mapped', () => {
    const v1 = manifestV1({
      truncated: true,
      changes: {
        'd:1': { fa: { o: 1, n: 2 }, fb: { n: 'x' } },
        'd:2': { fc: { n: 5 } },
      } as never,
      createdRecordIds: [RID('d:3')],
      archivedRecordIds: [RID('d:4')],
      createdValues: { [RID('d:3')]: { company_domain: 'a.com' } },
    })
    const v2 = upgradeManifestV1(v1)
    expect(v2).toEqual({
      version: 2,
      detailTruncated: true,
      membershipTruncated: false,
      touched: { 'd:1': ['fa', 'fb'], 'd:2': ['fc'] },
      deltas: v1.changes,
      createdRecordIds: ['d:3'],
      archivedRecordIds: ['d:4'],
      createdValues: { 'd:3': { company_domain: 'a.com' } },
    })
  })

  it('omits createdValues when the v1 manifest had none', () => {
    expect(upgradeManifestV1(manifestV1()).createdValues).toBeUndefined()
  })
})

describe('mergeManifests', () => {
  it('returns the other side when one is null (v2 passes through by reference)', () => {
    const m = manifest({ createdRecordIds: [RID('d:1')] })
    expect(mergeManifests(null, m)).toBe(m)
    expect(mergeManifests(m, null)).toBe(m)
    expect(mergeManifests(null, null)).toBeNull()
  })

  it('upgrades a lone v1 side to v2', () => {
    const v1 = manifestV1({ changes: { 'd:1': { fa: { n: 2 } } } as never })
    const merged = mergeManifests(v1, null)!
    expect(merged.version).toBe(2)
    expect(merged.touched).toEqual({ 'd:1': ['fa'] })
    expect(merged.deltas).toEqual(v1.changes)
  })

  it('folds touched with key-set union', () => {
    const base = manifest({ touched: { 'd:1': ['fa'], 'd:2': ['fb'] } as never })
    const add = manifest({ touched: { 'd:1': ['fb', 'fc'], 'd:3': ['fd'] } as never })
    const merged = mergeManifests(base, add)!
    expect(merged.touched).toEqual({
      'd:1': ['fa', 'fb', 'fc'],
      'd:2': ['fb'],
      'd:3': ['fd'],
    })
  })

  it('folds touched with 1 winning downward — once ids-only, stays ids-only', () => {
    const base = manifest({ touched: { 'd:1': ['fa'], 'd:2': 1 } as never })
    const add = manifest({ touched: { 'd:1': 1, 'd:2': ['fb'] } as never })
    const merged = mergeManifests(base, add)!
    expect(merged.touched[RID('d:1')]).toBe(1)
    expect(merged.touched[RID('d:2')]).toBe(1)
  })

  it('dedupes touched on the instance id across keyspaces through the fold', () => {
    const base = manifest({ touched: { 'contact:inst1': ['fa'] } as never })
    const add = manifest({ touched: { 'cuid_def_x:inst1': ['fb'] } as never })
    const merged = mergeManifests(base, add)!
    expect(Object.keys(merged.touched)).toEqual(['contact:inst1'])
    expect(merged.touched[RID('contact:inst1')]).toEqual(['fa', 'fb'])
  })

  it('deep-merges deltas: first o wins, last n wins, union keys/records', () => {
    const base = manifest({
      deltas: { 'd:1': { fa: { o: 1, n: 2 } } } as never,
    })
    const add = manifest({
      deltas: { 'd:1': { fa: { o: 99, n: 3 }, fb: { n: 'x' } }, 'd:2': { fc: { n: 5 } } } as never,
    })
    const merged = mergeManifests(base, add)!
    expect(merged.deltas['d:1' as never]).toEqual({ fa: { o: 1, n: 3 }, fb: { n: 'x' } })
    expect(merged.deltas['d:2' as never]).toEqual({ fc: { n: 5 } })
  })

  // F6 across slices: create in slice 1, update in slice 2 — the fold preserves the
  // create's o-absence exactly like the in-slice merge.
  it('cross-slice create-then-update keeps o absent through the fold', () => {
    const base = manifest({ deltas: { 'd:1': { fa: { n: 'v' } } } as never })
    const add = manifest({ deltas: { 'd:1': { fa: { o: 'v', n: 'v2' } } } as never })
    const merged = mergeManifests(base, add)!
    expect(merged.deltas['d:1' as never]).toEqual({ fa: { n: 'v2' } })
  })

  it('unions lifecycle ids and ORs both truncation flags', () => {
    const base = manifest({ createdRecordIds: [RID('d:1')], detailTruncated: true })
    const add = manifest({
      createdRecordIds: [RID('d:1'), RID('d:2')],
      membershipTruncated: true,
    })
    const merged = mergeManifests(base, add)!
    expect(merged.createdRecordIds.sort()).toEqual(['d:1', 'd:2'])
    expect(merged.detailTruncated).toBe(true)
    expect(merged.membershipTruncated).toBe(true)
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

  it('folds a v1 base with a v2 add (mixed run row Just Works)', () => {
    const base = manifestV1({
      truncated: true,
      changes: { 'd:1': { fa: { o: 1, n: 2 } } } as never,
      createdRecordIds: [RID('d:2')],
    })
    const add = manifest({
      touched: { 'd:1': ['fb'], 'd:3': ['fc'] } as never,
      deltas: { 'd:1': { fa: { o: 99, n: 3 } } } as never,
      archivedRecordIds: [RID('d:4')],
    })
    const merged = mergeManifests(base, add)!
    expect(merged.version).toBe(2)
    expect(merged.touched).toEqual({ 'd:1': ['fa', 'fb'], 'd:3': ['fc'] })
    expect(merged.deltas['d:1' as never]).toEqual({ fa: { o: 1, n: 3 } })
    expect(merged.createdRecordIds).toEqual(['d:2'])
    expect(merged.archivedRecordIds).toEqual(['d:4'])
    expect(merged.detailTruncated).toBe(true) // v1's truncated maps to detail
    expect(merged.membershipTruncated).toBe(false)
  })

  it('enforces the delta cap across the fold — detail only, membership complete', () => {
    const deltasFor = (start: number, count: number) => {
      const deltas: Record<string, { fa: { n: number } }> = {}
      for (let i = start; i < start + count; i++) deltas[`d:${i}`] = { fa: { n: i } }
      return deltas as never
    }
    const base = manifest({ deltas: deltasFor(0, 3), touched: {} })
    const add = manifest({ deltas: deltasFor(3, 3), touched: {} })
    const merged = mergeManifests(base, add, { maxDeltaRecords: 5 })!
    expect(Object.keys(merged.deltas).length).toBe(5)
    expect(merged.detailTruncated).toBe(true)
    expect(merged.membershipTruncated).toBe(false)
    // Every record kept tier-1 membership (a delta implies touched).
    expect(Object.keys(merged.touched).length).toBe(6)
  })

  it('enforces the membership cap across the fold', () => {
    const base = manifest({ touched: { 'd:1': ['fa'], 'd:2': ['fa'] } as never })
    const add = manifest({ touched: { 'd:3': ['fa'] } as never, createdRecordIds: [RID('d:4')] })
    const merged = mergeManifests(base, add, { maxTouchedRecords: 2 })!
    expect(Object.keys(merged.touched).sort()).toEqual(['d:1', 'd:2'])
    expect(merged.createdRecordIds).toEqual([])
    expect(merged.membershipTruncated).toBe(true)
  })

  it('re-touching an already-present record past the delta cap is free', () => {
    const deltas: Record<string, { fa: { n: number } }> = {}
    for (let i = 0; i < 3; i++) deltas[`d:${i}`] = { fa: { n: i } }
    const base = manifest({ deltas: deltas as never })
    // `add` re-touches an existing record (no new key) — must merge, not truncate.
    const add = manifest({ deltas: { 'd:0': { fa: { n: 999 } } } as never })
    const merged = mergeManifests(base, add, { maxDeltaRecords: 3 })!
    expect(Object.keys(merged.deltas).length).toBe(3)
    expect(merged.detailTruncated).toBe(false)
    expect(merged.deltas['d:0' as never]).toEqual({ fa: { n: 999 } })
  })
})
