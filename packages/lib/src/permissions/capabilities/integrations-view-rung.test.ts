// packages/lib/src/permissions/capabilities/integrations-view-rung.test.ts

import { describe, expect, it } from 'vitest'
import { CapabilitySet } from './capability-set'
import {
  Area,
  areaLevelFromKeys,
  expandLevelsToKeys,
  Level,
  PERMISSION_REGISTRY_MAP,
  PermissionKey,
} from './registry'
import { MEMBER_BASELINE_LEVELS, ROLE_DEFAULTS, SEAT_CEILINGS } from './seat-policy'

/**
 * `Area.integrations` gained a `Level.Read` rung on 2026-09-09 (the Connections
 * permission gate). Until then the area was `Full`-only, so the whole connection
 * READ path had no key to gate on: `connections.list` was a bare
 * `protectedProcedure` handing every member `ownedByOrOrgScoped`, i.e. their own
 * connections plus **every org-scoped one**. Any seat enumerated the workspace's
 * OAuth connections — names, provider types and creators; secrets were masked
 * then as now.
 *
 * These pin the ladder itself and the three defaults that decide who lands on
 * which rung. The router-side behaviour (the ownership carve-out, the scope
 * degradation) lives in `apps/web`'s `connections-permissions.test.ts`.
 */
describe('the Area.integrations Read rung', () => {
  it('expands Read to the view key and NOTHING else', () => {
    // The one assertion the whole change rests on: `Read` must not reach the
    // manage key, or the member baseline below hands every member in every org
    // the ability to connect, rotate and delete workspace connections.
    expect(expandLevelsToKeys({ [Area.integrations]: Level.Read })).toEqual([
      PermissionKey.integrationsView,
    ])
  })

  it('expands Full to both keys, so no existing Full holder loses anything', () => {
    // `expandLevelsToKeys` unions every rung at or below the level, so a stored
    // `integrations: Full` grant picks the new key up at compose time with no
    // data migration. That is why the backfill (entity migration 140) targets
    // only the rows that OMIT the area.
    expect(expandLevelsToKeys({ [Area.integrations]: Level.Full })).toEqual([
      PermissionKey.integrationsView,
      PermissionKey.integrationsManage,
    ])
  })

  it('expands None to nothing', () => {
    expect(expandLevelsToKeys({ [Area.integrations]: Level.None })).toEqual([])
  })

  it('has no Edit rung, so Edit composes down to Read', () => {
    // A partial ladder, like `billing`, `channels` and `inboxes`. There is no
    // authority between "see that the workspace has a Stripe connection" and
    // "connect, rotate or delete one".
    expect(expandLevelsToKeys({ [Area.integrations]: Level.Edit })).toEqual([
      PermissionKey.integrationsView,
    ])
    expect(areaLevelFromKeys(new Set([PermissionKey.integrationsView]), Area.integrations)).toBe(
      Level.Read
    )
  })

  it('registers integrations.view with no featureKey, so no plan gate runs on it', () => {
    // `permissionProcedure` runs the Layer-1 plan gate off `featureKey`. There
    // is no plan on which a member should be unable to see the connection their
    // own workflow binds, and the write rung beside it carries none either.
    const meta = PERMISSION_REGISTRY_MAP.get(PermissionKey.integrationsView)
    expect(meta).toBeDefined()
    expect(meta?.group).toBe('Integrations')
    expect(meta?.featureKey).toBeUndefined()
    expect(
      PERMISSION_REGISTRY_MAP.get(PermissionKey.integrationsManage)?.featureKey
    ).toBeUndefined()
  })
})

describe('who lands on the Read rung by default', () => {
  it('opens it for the seeded Member profile — the rung ships INERT', () => {
    // Today's behaviour written down. `connections.list` was ungated before the
    // rung existed, and members hold `workflows: Full` / `agents: Full` on this
    // same baseline, so the connection picker (`orgScopedOnly: true`) would
    // compose empty for every ordinary member if this entry were missing. Same
    // move plan 40 §7 made for `inboxes: Read`.
    expect(MEMBER_BASELINE_LEVELS[Area.integrations]).toBe(Level.Read)
    expect(
      new CapabilitySet(
        new Set(expandLevelsToKeys(MEMBER_BASELINE_LEVELS)),
        {},
        'USER',
        'full'
      ).can(PermissionKey.integrationsView)
    ).toBe(true)
  })

  it('does NOT open the manage rung for the seeded Member profile', () => {
    expect(MEMBER_BASELINE_LEVELS[Area.integrations]).not.toBe(Level.Full)
    expect(
      new CapabilitySet(
        new Set(expandLevelsToKeys(MEMBER_BASELINE_LEVELS)),
        {},
        'USER',
        'full'
      ).can(PermissionKey.integrationsManage)
    ).toBe(false)
  })

  it('closes it for a custom USER-rank profile that never mentions the area', () => {
    // THE lever. `ROLE_DEFAULTS.USER` is the `None` floor apart from
    // signatures/snippets/dashboards, so a locked-down contractor profile — and
    // the `accountant` / `bookkeeper` seeds, which carry explicit `levels` maps
    // that omit the area — composes `None` and is refused.
    expect(ROLE_DEFAULTS.USER[Area.integrations]).toBe(Level.None)
    expect(
      new CapabilitySet(new Set(expandLevelsToKeys(ROLE_DEFAULTS.USER)), {}, 'USER', 'full').can(
        PermissionKey.integrationsView
      )
    ).toBe(false)
  })

  it('clamps a worker seat to None whatever the profile says', () => {
    // `Area.integrations` is absent from `WORKER_AREAS`, which is why entity
    // migration 140 leaves the `field_tech` grant row alone.
    expect(SEAT_CEILINGS.worker[Area.integrations]).toBe(Level.None)
    expect(SEAT_CEILINGS.full[Area.integrations]).toBe(Level.Full)
  })
})
