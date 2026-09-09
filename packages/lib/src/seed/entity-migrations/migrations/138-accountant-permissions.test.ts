// packages/lib/src/seed/entity-migrations/migrations/138-accountant-permissions.test.ts

import { describe, expect, it } from 'vitest'
import { Area, Level } from '../../../permissions/capabilities/registry'
import {
  FIELD_TECH_BASELINE_LEVELS,
  MEMBER_BASELINE_LEVELS,
  SEAT_CEILINGS,
} from '../../../permissions/capabilities/seat-policy'
import { baselineAdditions, isNoopMerge, mergeBaseline } from './138-accountant-permissions'

describe('baselineAdditions', () => {
  it('reads the level from the seed rather than hard-coding it', () => {
    expect(baselineAdditions({ [Area.tasks]: Level.Read }, [Area.tasks])).toEqual({
      [Area.tasks]: Level.Read,
    })
    expect(baselineAdditions({ [Area.tasks]: Level.Full }, [Area.tasks])).toEqual({
      [Area.tasks]: Level.Full,
    })
  })

  it('picks up exactly what MEMBER_BASELINE_LEVELS declares today', () => {
    // The migration is only correct if the registry actually opens both areas
    // for member; if task 12 §10's entries were missing this would silently
    // become a no-op.
    expect(MEMBER_BASELINE_LEVELS[Area.tasks]).toBe(Level.Full)
    expect(MEMBER_BASELINE_LEVELS[Area.calls]).toBe(Level.Full)
    expect(baselineAdditions(MEMBER_BASELINE_LEVELS, [Area.tasks, Area.calls])).toEqual({
      [Area.tasks]: Level.Full,
      [Area.calls]: Level.Full,
    })
  })

  it('picks up exactly what FIELD_TECH_BASELINE_LEVELS declares today', () => {
    expect(FIELD_TECH_BASELINE_LEVELS[Area.tasks]).toBe(Level.Full)
    expect(baselineAdditions(FIELD_TECH_BASELINE_LEVELS, [Area.tasks])).toEqual({
      [Area.tasks]: Level.Full,
    })
  })

  // `Level.None` is 0. A truthiness guard would drop it, turning "the registry
  // deliberately closed this area" into "the registry never mentioned it" — two
  // states that compose differently.
  it('keeps an explicit Level.None instead of treating 0 as absent', () => {
    expect(baselineAdditions({ [Area.tasks]: Level.None }, [Area.tasks])).toEqual({
      [Area.tasks]: Level.None,
    })
  })

  it('returns nothing when the seed does not mention the requested areas', () => {
    expect(baselineAdditions({ [Area.records]: Level.Full }, [Area.tasks, Area.calls])).toEqual({})
    expect(baselineAdditions(undefined, [Area.tasks, Area.calls])).toEqual({})
    expect(baselineAdditions(null, [Area.tasks, Area.calls])).toEqual({})
  })

  it('ignores every area other than the ones passed in', () => {
    expect(
      baselineAdditions({ [Area.tasks]: Level.Full, [Area.channels]: Level.Full }, [Area.tasks])
    ).toEqual({
      [Area.tasks]: Level.Full,
    })
  })

  it('only asks for calls on the member set, never on field_tech', () => {
    // field_tech's call site passes [Area.tasks] only — Area.calls is absent
    // from WORKER_AREAS, so asking for it here would be a lie in the data even
    // if the seed happened to carry it.
    expect(baselineAdditions({ [Area.calls]: Level.Full }, [Area.tasks])).toEqual({})
  })
})

describe('mergeBaseline', () => {
  const additions = { [Area.tasks]: Level.Full, [Area.calls]: Level.Full }

  it('gives an untouched org the baseline Full on both areas', () => {
    const existing = { [Area.records]: Level.Full }
    expect(mergeBaseline(additions, existing)).toEqual({
      [Area.tasks]: Level.Full,
      [Area.calls]: Level.Full,
      [Area.records]: Level.Full,
    })
  })

  // An admin who already narrowed one of the areas keeps their choice — the
  // merge is `{ ...additions, ...existing }`, so the stored row always wins.
  it("keeps an admin's explicit narrowing", () => {
    const existing = { [Area.tasks]: Level.None, [Area.records]: Level.Read }
    expect(mergeBaseline(additions, existing)[Area.tasks]).toBe(Level.None)
  })

  it("keeps an admin's explicit widening", () => {
    const existing = { [Area.calls]: Level.Read }
    expect(mergeBaseline(additions, existing)[Area.calls]).toBe(Level.Read)
  })

  it('never drops an unrelated area the row already carried', () => {
    const existing = {
      [Area.records]: Level.Full,
      [Area.knowledgeBase]: Level.Edit,
      [Area.signatures]: Level.Full,
    }
    expect(mergeBaseline(additions, existing)).toMatchObject(existing)
  })
})

describe('isNoopMerge', () => {
  const areas = [Area.tasks, Area.calls]

  it('detects the second run — the merge changed nothing', () => {
    const existing = {
      [Area.tasks]: Level.Full,
      [Area.calls]: Level.Full,
      [Area.records]: Level.Full,
    }
    const merged = mergeBaseline({ [Area.tasks]: Level.Full, [Area.calls]: Level.Full }, existing)
    expect(isNoopMerge(merged, existing, areas)).toBe(true)
  })

  it('detects the first run — both areas were absent', () => {
    const existing = { [Area.records]: Level.Full }
    const merged = mergeBaseline({ [Area.tasks]: Level.Full, [Area.calls]: Level.Full }, existing)
    expect(isNoopMerge(merged, existing, areas)).toBe(false)
  })

  it('detects a partial first run — only one of the two areas was absent', () => {
    const existing = { [Area.tasks]: Level.Full }
    const merged = mergeBaseline({ [Area.tasks]: Level.Full, [Area.calls]: Level.Full }, existing)
    expect(isNoopMerge(merged, existing, areas)).toBe(false)
  })

  it('treats an admin-narrowed row as already settled', () => {
    const existing = { [Area.tasks]: Level.None, [Area.calls]: Level.None }
    const merged = mergeBaseline({ [Area.tasks]: Level.Full, [Area.calls]: Level.Full }, existing)
    expect(isNoopMerge(merged, existing, areas)).toBe(true)
  })

  it('checks only the requested area list for field_tech', () => {
    const existing = { [Area.tasks]: Level.Full }
    const merged = mergeBaseline({ [Area.tasks]: Level.Full }, existing)
    expect(isNoopMerge(merged, existing, [Area.tasks])).toBe(true)
  })
})

/**
 * `field_tech` never receives `Area.calls`. `Area.calls` is absent from
 * `WORKER_AREAS`, so `SEAT_CEILINGS.worker` clamps it to `None` for a worker
 * seat no matter what the profile row says — writing it would be a lie in the
 * data that changes nothing in the composition. Same reasoning migration 061
 * gives for leaving `field_tech` untouched on `Area.inboxes`.
 */
describe('field_tech never receives Area.calls', () => {
  it('clamps a worker seat to None on Area.calls regardless of the profile', () => {
    // The observable consequence of `Area.calls` being absent from
    // `WORKER_AREAS` — this is what makes writing a field_tech calls row
    // pointless.
    expect(SEAT_CEILINGS.worker[Area.calls]).toBe(Level.None)
    expect(SEAT_CEILINGS.full[Area.calls]).toBe(Level.Full)
  })

  it('opens Area.tasks (but not Area.calls) for a worker seat', () => {
    expect(SEAT_CEILINGS.worker[Area.tasks]).toBe(Level.Full)
    expect(SEAT_CEILINGS.worker[Area.calls]).toBe(Level.None)
  })

  it('leaves Area.calls out of the field tech baseline', () => {
    expect(FIELD_TECH_BASELINE_LEVELS[Area.calls]).toBeUndefined()
  })
})
