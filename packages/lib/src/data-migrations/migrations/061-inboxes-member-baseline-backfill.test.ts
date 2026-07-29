// packages/lib/src/data-migrations/migrations/061-inboxes-member-baseline-backfill.test.ts

import { describe, expect, it } from 'vitest'
import { Area, Level } from '../../permissions/capabilities/registry'
import {
  FIELD_TECH_BASELINE_LEVELS,
  MEMBER_BASELINE_LEVELS,
  SEAT_CEILINGS,
} from '../../permissions/capabilities/seat-policy'
import {
  baselineAdditions,
  isNoopMerge,
  mergeInboxesBaseline,
} from './061-inboxes-member-baseline-backfill'

describe('baselineAdditions', () => {
  it('reads the level from the seed rather than hard-coding it', () => {
    expect(baselineAdditions({ [Area.inboxes]: Level.Read })).toEqual({
      [Area.inboxes]: Level.Read,
    })
    expect(baselineAdditions({ [Area.inboxes]: Level.Full })).toEqual({
      [Area.inboxes]: Level.Full,
    })
  })

  it('picks up exactly what MEMBER_BASELINE_LEVELS declares today', () => {
    // The migration is only correct if the registry actually opens the area; if
    // plan 40 §7's entry were missing this would silently become a no-op.
    expect(MEMBER_BASELINE_LEVELS[Area.inboxes]).toBe(Level.Read)
    expect(baselineAdditions(MEMBER_BASELINE_LEVELS)).toEqual({ [Area.inboxes]: Level.Read })
  })

  // `Level.None` is 0. A truthiness guard would drop it, turning "the registry
  // deliberately closed this area" into "the registry never mentioned it" — two
  // states that compose differently.
  it('keeps an explicit Level.None instead of treating 0 as absent', () => {
    expect(baselineAdditions({ [Area.inboxes]: Level.None })).toEqual({
      [Area.inboxes]: Level.None,
    })
  })

  it('returns nothing when the seed does not mention the area', () => {
    expect(baselineAdditions({ [Area.records]: Level.Full })).toEqual({})
    expect(baselineAdditions(undefined)).toEqual({})
    expect(baselineAdditions(null)).toEqual({})
  })

  it('ignores every area other than the ones this migration opens', () => {
    expect(baselineAdditions({ [Area.inboxes]: Level.Read, [Area.channels]: Level.Full })).toEqual({
      [Area.inboxes]: Level.Read,
    })
  })
})

describe('mergeInboxesBaseline', () => {
  const additions = { [Area.inboxes]: Level.Read }

  it('gives an untouched org the baseline Read', () => {
    const existing = { [Area.records]: Level.Full }
    expect(mergeInboxesBaseline(additions, existing)).toEqual({
      [Area.inboxes]: Level.Read,
      [Area.records]: Level.Full,
    })
  })

  // An admin who already narrowed the area keeps their choice — the merge is
  // `{ ...additions, ...existing }`, so the stored row always wins.
  it('keeps an admin’s explicit narrowing', () => {
    const existing = { [Area.inboxes]: Level.None, [Area.records]: Level.Read }
    expect(mergeInboxesBaseline(additions, existing)[Area.inboxes]).toBe(Level.None)
  })

  it('keeps an admin’s explicit widening', () => {
    const existing = { [Area.inboxes]: Level.Full }
    expect(mergeInboxesBaseline(additions, existing)[Area.inboxes]).toBe(Level.Full)
  })

  it('never drops an unrelated area the row already carried', () => {
    const existing = {
      [Area.records]: Level.Full,
      [Area.knowledgeBase]: Level.Edit,
      [Area.signatures]: Level.Full,
    }
    expect(mergeInboxesBaseline(additions, existing)).toMatchObject(existing)
  })
})

describe('isNoopMerge', () => {
  it('detects the second run — the merge changed nothing', () => {
    const existing = { [Area.inboxes]: Level.Read, [Area.records]: Level.Full }
    const merged = mergeInboxesBaseline({ [Area.inboxes]: Level.Read }, existing)
    expect(isNoopMerge(merged, existing)).toBe(true)
  })

  it('detects the first run — the area was absent', () => {
    const existing = { [Area.records]: Level.Full }
    const merged = mergeInboxesBaseline({ [Area.inboxes]: Level.Read }, existing)
    expect(isNoopMerge(merged, existing)).toBe(false)
  })

  it('treats an admin-narrowed row as already settled', () => {
    const existing = { [Area.inboxes]: Level.None }
    const merged = mergeInboxesBaseline({ [Area.inboxes]: Level.Read }, existing)
    expect(isNoopMerge(merged, existing)).toBe(true)
  })
})

/**
 * `field_tech` is deliberately outside this migration's reach. `Area.inboxes` is
 * absent from `WORKER_AREAS`, so `SEAT_CEILINGS.worker` clamps it to `None` for
 * a worker seat no matter what the profile row says — writing it would be a lie
 * in the data that changes nothing in the composition.
 */
describe('field_tech is untouched by design', () => {
  it('clamps a worker seat to None on Area.inboxes regardless of the profile', () => {
    // The observable consequence of `Area.inboxes` being absent from
    // `WORKER_AREAS` — this is what makes writing a field_tech row pointless.
    expect(SEAT_CEILINGS.worker[Area.inboxes]).toBe(Level.None)
    expect(SEAT_CEILINGS.full[Area.inboxes]).toBe(Level.Full)
  })

  it('leaves Area.inboxes out of the field tech baseline', () => {
    expect(FIELD_TECH_BASELINE_LEVELS[Area.inboxes]).toBeUndefined()
  })
})
