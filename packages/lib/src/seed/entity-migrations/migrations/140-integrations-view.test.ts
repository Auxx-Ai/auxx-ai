// packages/lib/src/seed/entity-migrations/migrations/140-integrations-view.test.ts

import { describe, expect, it } from 'vitest'
import {
  Area,
  Level,
  PERMISSION_AREAS,
  PermissionKey,
} from '../../../permissions/capabilities/registry'
import {
  FIELD_TECH_BASELINE_LEVELS,
  MEMBER_BASELINE_LEVELS,
  SEAT_CEILINGS,
} from '../../../permissions/capabilities/seat-policy'
import { SYSTEM_PROFILE_SEEDS } from '../../../permissions/profiles/system-profiles'
import {
  integrationsBaselineAdditions,
  isNoopIntegrationsMerge,
  mergeIntegrationsBaseline,
} from './140-integrations-view'

describe('integrationsBaselineAdditions', () => {
  it('reads the level from the seed rather than hard-coding it', () => {
    expect(
      integrationsBaselineAdditions({ [Area.integrations]: Level.Read }, [Area.integrations])
    ).toEqual({ [Area.integrations]: Level.Read })
    expect(
      integrationsBaselineAdditions({ [Area.integrations]: Level.Full }, [Area.integrations])
    ).toEqual({ [Area.integrations]: Level.Full })
  })

  it('picks up exactly what MEMBER_BASELINE_LEVELS declares today', () => {
    // The migration is only correct if the seed actually opens the area for
    // `member`. Were this entry missing, the backfill would silently become a
    // no-op and every member on an existing org would lose the connection
    // picker with nothing in the code saying so.
    expect(MEMBER_BASELINE_LEVELS[Area.integrations]).toBe(Level.Read)
    expect(integrationsBaselineAdditions(MEMBER_BASELINE_LEVELS, [Area.integrations])).toEqual({
      [Area.integrations]: Level.Read,
    })
  })

  // `Level.None` is 0. A truthiness guard would drop it, turning "the registry
  // deliberately closed this area" into "the registry never mentioned it" — two
  // states that compose differently.
  it('keeps an explicit Level.None instead of treating 0 as absent', () => {
    expect(
      integrationsBaselineAdditions({ [Area.integrations]: Level.None }, [Area.integrations])
    ).toEqual({ [Area.integrations]: Level.None })
  })

  it('returns nothing when the seed does not mention the area', () => {
    expect(
      integrationsBaselineAdditions({ [Area.records]: Level.Full }, [Area.integrations])
    ).toEqual({})
    expect(integrationsBaselineAdditions(undefined, [Area.integrations])).toEqual({})
    expect(integrationsBaselineAdditions(null, [Area.integrations])).toEqual({})
  })

  it('ignores every area other than the one passed in', () => {
    expect(
      integrationsBaselineAdditions(
        { [Area.integrations]: Level.Read, [Area.channels]: Level.Full },
        [Area.integrations]
      )
    ).toEqual({ [Area.integrations]: Level.Read })
  })
})

describe('mergeIntegrationsBaseline', () => {
  const additions = { [Area.integrations]: Level.Read }

  it('gives an untouched org the baseline Read', () => {
    const existing = { [Area.records]: Level.Full }
    expect(mergeIntegrationsBaseline(additions, existing)).toEqual({
      [Area.integrations]: Level.Read,
      [Area.records]: Level.Full,
    })
  })

  it("keeps an admin's explicit narrowing", () => {
    const existing = { [Area.integrations]: Level.None, [Area.records]: Level.Read }
    expect(mergeIntegrationsBaseline(additions, existing)[Area.integrations]).toBe(Level.None)
  })

  it("keeps an admin's explicit widening to Full", () => {
    // An org that deliberately gave every member `integrationsManage` keeps it.
    const existing = { [Area.integrations]: Level.Full }
    expect(mergeIntegrationsBaseline(additions, existing)[Area.integrations]).toBe(Level.Full)
  })

  it('never drops an unrelated area the row already carried', () => {
    const existing = {
      [Area.records]: Level.Full,
      [Area.knowledgeBase]: Level.Edit,
      [Area.inboxes]: Level.Read,
    }
    expect(mergeIntegrationsBaseline(additions, existing)).toMatchObject(existing)
  })

  it('never raises the row to the manage rung on its own', () => {
    // The whole point of backfilling `Read` and not `Full`: the write rung stays
    // an explicit admin decision.
    const merged = mergeIntegrationsBaseline(additions, {})
    expect(merged[Area.integrations]).not.toBe(Level.Full)
    expect(merged[Area.integrations]).toBe(Level.Read)
  })
})

describe('isNoopIntegrationsMerge', () => {
  const areas = [Area.integrations]

  it('detects the second run — the merge changed nothing', () => {
    const existing = { [Area.integrations]: Level.Read, [Area.records]: Level.Full }
    const merged = mergeIntegrationsBaseline({ [Area.integrations]: Level.Read }, existing)
    expect(isNoopIntegrationsMerge(merged, existing, areas)).toBe(true)
  })

  it('detects the first run — the area was absent', () => {
    const existing = { [Area.records]: Level.Full }
    const merged = mergeIntegrationsBaseline({ [Area.integrations]: Level.Read }, existing)
    expect(isNoopIntegrationsMerge(merged, existing, areas)).toBe(false)
  })

  it('treats an admin-narrowed row as already settled', () => {
    const existing = { [Area.integrations]: Level.None }
    const merged = mergeIntegrationsBaseline({ [Area.integrations]: Level.Read }, existing)
    expect(isNoopIntegrationsMerge(merged, existing, areas)).toBe(true)
  })
})

/**
 * The migration touches the `member` grant row and nothing else. These pin the
 * three reasons, so a later "it should backfill X too" has to argue with a
 * failing test rather than an absent one.
 */
describe('what the backfill deliberately leaves alone', () => {
  it('never writes Area.integrations onto field_tech — a worker seat is clamped to None', () => {
    // `Area.integrations` is absent from `WORKER_AREAS`, so the seat ceiling
    // closes it for a worker regardless of the profile row. Writing it would be
    // a lie in the data that changes nothing in the composition — the same
    // reasoning 138 gives for `Area.calls` and 061 for `Area.inboxes`.
    expect(SEAT_CEILINGS.worker[Area.integrations]).toBe(Level.None)
    expect(SEAT_CEILINGS.full[Area.integrations]).toBe(Level.Full)
    expect(FIELD_TECH_BASELINE_LEVELS[Area.integrations]).toBeUndefined()
  })

  it('leaves the accountant and bookkeeper seeds closed on Area.integrations', () => {
    // An outside CPA has no business reading the workspace's connected
    // accounts, and a bookkeeper does the books, not the integrations. Both
    // seeds carry an explicit `levels` map, so an OMITTED area composes to
    // `None` off `ROLE_DEFAULTS.USER` — which is the deny this whole change
    // exists to make expressible.
    for (const slug of ['accountant', 'bookkeeper'] as const) {
      const seed = SYSTEM_PROFILE_SEEDS.find((s) => s.slug === slug)
      expect(seed, slug).toBeDefined()
      expect(seed?.levels?.[Area.integrations], slug).toBeUndefined()
    }
  })

  it('leaves the nine other org-administration areas out of the member baseline', () => {
    // `integrations: Read` is a deliberate single exception, not the start of a
    // pattern. If a later change opens one of these it must say so here.
    for (const area of [
      Area.settings,
      Area.permissions,
      Area.billing,
      Area.members,
      Area.aiConfig,
      Area.automationRules,
      Area.auditLog,
      Area.connectors,
      Area.channels,
    ] as const) {
      expect(MEMBER_BASELINE_LEVELS[area], area).toBeUndefined()
    }
  })
})

/**
 * The rung the backfill exists to make inert. Pinned here rather than in a
 * registry test because the migration is meaningless without it: `Read` on this
 * area must expand to the view key and NOT the manage key, or the backfill
 * hands every member in every org the ability to connect and delete the
 * workspace's connections.
 */
describe('the Area.integrations ladder the backfill assumes', () => {
  it('is Read/Full, in that order, with no Edit rung', () => {
    expect(PERMISSION_AREAS[Area.integrations].rungs.map((r) => r.level)).toEqual([
      Level.Read,
      Level.Full,
    ])
  })

  it('puts integrations.view on Read and integrations.manage on Full', () => {
    const [read, full] = PERMISSION_AREAS[Area.integrations].rungs
    expect(read?.keys).toEqual([PermissionKey.integrationsView])
    expect(full?.keys).toEqual([PermissionKey.integrationsManage])
  })
})
