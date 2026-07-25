// packages/lib/src/permissions/profiles/escalation-guard.test.ts

import type { ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { ForbiddenError } from '../../errors'
import { Area, buildAreaLevels, Level } from '../capabilities/registry'
import type { EffectiveState } from './effective-state'
import {
  type ActorAuthority,
  assertNoEscalation,
  assertProfileMapNoEscalation,
} from './escalation-guard'

/**
 * The §6.1 escalation guard, tested as the pure algorithm it is — the states it
 * compares are produced by `computeEffectiveStatesUncached` (see
 * `profile-save.test.ts`, which proves the composition half and the cache bypass).
 */

const HR_DEF = 'def_hr_000000000000000000000'

/** An effective state: every area at `base`, plus explicit per-area overrides. */
function state(input: {
  userId?: string
  base?: Level
  areas?: Partial<Record<Area, Level>>
  defs?: Record<string, ResourcePermission>
  instances?: Record<string, ResourcePermission>
}): EffectiveState {
  const areas = buildAreaLevels((area) => input.areas?.[area] ?? input.base ?? Level.None)
  return {
    userId: input.userId ?? 'u_holder',
    areas,
    defs: input.defs ?? {},
    instances: input.instances ?? {},
  }
}

function actorAt(input: Parameters<typeof state>[0] & { role?: OrganizationRole }): ActorAuthority {
  return {
    userId: 'u_actor',
    role: input.role ?? 'USER',
    state: state({ ...input, userId: 'u_actor' }),
  }
}

function run(input: {
  actor: ActorAuthority
  before: EffectiveState
  after: EffectiveState
}): void {
  assertNoEscalation({
    actor: input.actor,
    before: new Map([[input.before.userId, input.before]]),
    after: new Map([[input.after.userId, input.after]]),
  })
}

describe('assertNoEscalation — §6.1.2 delta gating', () => {
  it('PERMITS a decrease, even below an actor whose own access was narrowed', () => {
    // Property 1: removal only tightens, so it never needs authority. Without
    // this, an admin who was narrowed could not clean up a profile at all.
    expect(() =>
      run({
        actor: actorAt({ areas: { [Area.records]: Level.Read } }),
        before: state({ areas: { [Area.records]: Level.Full } }),
        after: state({ areas: { [Area.records]: Level.Edit } }),
      })
    ).not.toThrow()
  })

  it('DENIES a raise above the actor’s own level', () => {
    expect(() =>
      run({
        actor: actorAt({ areas: { [Area.records]: Level.Edit } }),
        before: state({ areas: { [Area.records]: Level.Read } }),
        after: state({ areas: { [Area.records]: Level.Full } }),
      })
    ).toThrow(ForbiddenError)
  })

  it('PERMITS a raise that stays at or below the actor’s own level', () => {
    expect(() =>
      run({
        actor: actorAt({ areas: { [Area.records]: Level.Edit } }),
        before: state({ areas: { [Area.records]: Level.Read } }),
        after: state({ areas: { [Area.records]: Level.Edit } }),
      })
    ).not.toThrow()
  })

  it('leaves a holder who ALREADY sits above the actor alone (gate is on the delta)', () => {
    // The holder keeps `records: Full` the actor does not hold; an unrelated,
    // in-authority change must still go through.
    expect(() =>
      run({
        actor: actorAt({ areas: { [Area.records]: Level.Read, [Area.files]: Level.Full } }),
        before: state({ areas: { [Area.records]: Level.Full, [Area.files]: Level.None } }),
        after: state({ areas: { [Area.records]: Level.Full, [Area.files]: Level.Full } }),
      })
    ).not.toThrow()
  })

  it('DENIES surfacing a PRE-EXISTING grant the actor never authored (§6.1 mode 1)', () => {
    // Raising the definition ceiling exposes a group grant the holder already
    // had. The actor wrote no grant here — only the ceiling moved — but the
    // holder's resulting state rises above the actor's own def access.
    expect(() =>
      run({
        actor: actorAt({ base: Level.Full, defs: { [HR_DEF]: 'view' } }),
        before: state({ base: Level.Full, defs: {} }),
        after: state({ base: Level.Full, defs: { [HR_DEF]: 'admin' } }),
      })
    ).toThrow(ForbiddenError)
  })

  it('PERMITS the same ceiling raise when the actor holds that def access outright', () => {
    expect(() =>
      run({
        actor: actorAt({ base: Level.Full, defs: { [HR_DEF]: 'admin' } }),
        before: state({ base: Level.Full, defs: {} }),
        after: state({ base: Level.Full, defs: { [HR_DEF]: 'admin' } }),
      })
    ).not.toThrow()
  })

  it('DENIES an instance-level raise above the actor’s own instance access', () => {
    expect(() =>
      run({
        actor: actorAt({ base: Level.Full, instances: { ds_1: 'view' } }),
        before: state({ base: Level.Full, instances: { ds_1: 'view' } }),
        after: state({ base: Level.Full, instances: { ds_1: 'admin' } }),
      })
    ).toThrow(ForbiddenError)
  })

  it('OWNER short-circuits to pass — the §0.10 recovery guarantee', () => {
    // An owner whose composed state were (impossibly) empty must still be able
    // to fix a mis-shaped profile, or the org can lock itself out.
    expect(() =>
      run({
        actor: actorAt({ role: 'OWNER', base: Level.None }),
        before: state({ base: Level.None }),
        after: state({ base: Level.Full, defs: { [HR_DEF]: 'admin' } }),
      })
    ).not.toThrow()
  })

  it('checks EVERY holder, not just the first', () => {
    const actor = actorAt({ areas: { [Area.records]: Level.Read } })
    const before = new Map<string, EffectiveState>([
      ['u_1', state({ userId: 'u_1', areas: { [Area.records]: Level.Read } })],
      ['u_2', state({ userId: 'u_2', areas: { [Area.records]: Level.Read } })],
    ])
    const after = new Map<string, EffectiveState>([
      ['u_1', state({ userId: 'u_1', areas: { [Area.records]: Level.Read } })],
      ['u_2', state({ userId: 'u_2', areas: { [Area.records]: Level.Full } })],
    ])
    expect(() => assertNoEscalation({ actor, before, after })).toThrow(ForbiddenError)
  })

  it('treats a holder with no BEFORE state as starting from None', () => {
    const actor = actorAt({ areas: { [Area.records]: Level.Read } })
    expect(() =>
      assertNoEscalation({
        actor,
        before: new Map(),
        after: new Map([['u_1', state({ userId: 'u_1', areas: { [Area.records]: Level.Full } })]]),
      })
    ).toThrow(ForbiddenError)
  })
})

describe('assertProfileMapNoEscalation — the >500-holder strict fallback (§6.1.3)', () => {
  const NO_DEFS: string[] = []

  it('DENIES an area the profile newly sets above the actor’s own level', () => {
    expect(() =>
      assertProfileMapNoEscalation({
        actor: actorAt({ areas: { [Area.records]: Level.Read } }),
        before: { levels: {}, baseLevel: null, ceiling: null },
        after: { levels: { [Area.records]: Level.Full }, baseLevel: null, ceiling: null },
        defIds: NO_DEFS,
      })
    ).toThrow(ForbiddenError)
  })

  it('PERMITS lowering an area the actor does not hold', () => {
    expect(() =>
      assertProfileMapNoEscalation({
        actor: actorAt({ areas: { [Area.records]: Level.None } }),
        before: { levels: { [Area.records]: Level.Full }, baseLevel: null, ceiling: null },
        after: { levels: { [Area.records]: Level.Read }, baseLevel: null, ceiling: null },
        defIds: NO_DEFS,
      })
    ).not.toThrow()
  })

  it('DENIES loosening an area ceiling beyond the actor’s own level', () => {
    // Conservative by design: a group grant could carry any holder up to the new
    // cap, and this mode cannot look at holders to find out.
    expect(() =>
      assertProfileMapNoEscalation({
        actor: actorAt({ areas: { [Area.files]: Level.Read } }),
        before: { levels: {}, baseLevel: null, ceiling: { areas: { [Area.files]: Level.Read } } },
        after: { levels: {}, baseLevel: null, ceiling: { areas: { [Area.files]: Level.Full } } },
        defIds: NO_DEFS,
      })
    ).toThrow(ForbiddenError)
  })

  it('PERMITS tightening an area ceiling', () => {
    expect(() =>
      assertProfileMapNoEscalation({
        actor: actorAt({ areas: { [Area.files]: Level.None } }),
        before: { levels: {}, baseLevel: null, ceiling: null },
        after: { levels: {}, baseLevel: null, ceiling: { areas: { [Area.files]: Level.Read } } },
        defIds: NO_DEFS,
      })
    ).not.toThrow()
  })

  it('DENIES widening the definition ceiling onto a def the actor does not administer', () => {
    expect(() =>
      assertProfileMapNoEscalation({
        actor: actorAt({ base: Level.Full, defs: { [HR_DEF]: 'edit' } }),
        before: { levels: {}, baseLevel: null, ceiling: { defs: { mode: 'only', slugs: [] } } },
        after: { levels: {}, baseLevel: null, ceiling: null },
        defIds: [HR_DEF],
        toDefinitionId: (key) => key,
      })
    ).toThrow(ForbiddenError)
  })

  it('PERMITS widening the definition ceiling when the actor administers the def', () => {
    expect(() =>
      assertProfileMapNoEscalation({
        actor: actorAt({ base: Level.Full, defs: { [HR_DEF]: 'admin' } }),
        before: { levels: {}, baseLevel: null, ceiling: { defs: { mode: 'only', slugs: [] } } },
        after: { levels: {}, baseLevel: null, ceiling: null },
        defIds: [HR_DEF],
        toDefinitionId: (key) => key,
      })
    ).not.toThrow()
  })

  it('resolves the ceiling’s apiSlugs into the def keyspace before comparing', () => {
    // `hr` is the apiSlug; `defs`/`defIds` speak entityDefinitionIds. Without the
    // resolver the "only: [hr]" ceiling would look like it admits nothing and the
    // widening would go unnoticed.
    const toDefinitionId = (key: string) => (key === 'hr' ? HR_DEF : key)
    expect(() =>
      assertProfileMapNoEscalation({
        actor: actorAt({ base: Level.Full, defs: { [HR_DEF]: 'view' } }),
        before: { levels: {}, baseLevel: null, ceiling: { defs: { mode: 'only', slugs: [] } } },
        after: { levels: {}, baseLevel: null, ceiling: { defs: { mode: 'only', slugs: ['hr'] } } },
        defIds: [HR_DEF],
        toDefinitionId,
      })
    ).toThrow(ForbiddenError)
  })

  it('OWNER short-circuits here too', () => {
    expect(() =>
      assertProfileMapNoEscalation({
        actor: actorAt({ role: 'OWNER', base: Level.None }),
        before: { levels: {}, baseLevel: null, ceiling: null },
        after: { levels: { [Area.records]: Level.Full }, baseLevel: Level.Full, ceiling: null },
        defIds: [HR_DEF],
      })
    ).not.toThrow()
  })
})
