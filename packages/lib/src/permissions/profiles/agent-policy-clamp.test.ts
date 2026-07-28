// packages/lib/src/permissions/profiles/agent-policy-clamp.test.ts

import type { PublishedAgentPermissionPolicy } from '@auxx/database'
import { ResourcePermission } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import type { CapabilityView } from '../capabilities/capability-view'
import type { InstanceAccessKey } from '../capabilities/instance-access'
import { Area, areaCeilingLevel, Level, type PermissionKey } from '../capabilities/registry'
import { emptyAgentPolicy, legacyFullAgentPolicy } from './agent-policy'
import { type ClampDefinition, clampAgentPolicyToPublisher } from './agent-policy-clamp'

/**
 * The **author clamp** (plan 19 §2.4a) — the security core of step 3, and the
 * §9.1 verification case: a member holding only `agentsManage` must not be able to
 * mint an all-`Full` non-human principal off the permissive `agent` system profile.
 */

interface PublisherSpec {
  /** Per-area rung; absent = None. */
  areas?: Partial<Record<Area, Level>>
  /** Per-def rung as the human gates would answer it; absent = the `defDefault`. */
  defs?: Record<string, 'none' | 'view' | 'edit' | 'admin'>
  /**
   * The publisher's posture toward a def they hold no explicit grant on — what an
   * unrestricted def (and any def created after publish) resolves to. This is
   * exactly what the clamp's sentinel probe reads.
   */
  defDefault?: 'none' | 'view' | 'edit' | 'admin'
  /** Per-instance rung; absent = `instanceDefault`. */
  instances?: Record<string, 'none' | 'view' | 'edit' | 'admin'>
  instanceDefault?: 'none' | 'view' | 'edit' | 'admin'
}

const RANK = { none: 0, view: 1, edit: 2, admin: 3 } as const

/**
 * A stub publisher whose gates answer from a rung table — deliberately shaped like
 * the real `CapabilitySet` contract (descending probes: admin → edit → view) so the
 * clamp is exercised through the same interface it uses in production.
 */
function publisher(spec: PublisherSpec): CapabilityView {
  const defRung = (id: string) => spec.defs?.[id] ?? spec.defDefault ?? 'none'
  const instRung = (id: string) => spec.instances?.[id] ?? spec.instanceDefault ?? 'none'
  const notNeeded = (): never => {
    throw new Error('gate not exercised by the clamp')
  }
  return {
    can: notNeeded,
    has: notNeeded,
    assert: notNeeded,
    areaLevel: (area) => spec.areas?.[area] ?? Level.None,
    canWriteEntity: notNeeded,
    assertWriteEntity: notNeeded,
    canEditEntity: (id) => RANK[defRung(id)] >= RANK.edit,
    assertEditEntity: notNeeded,
    filterEditableDefIds: notNeeded,
    canViewEntity: (id) => RANK[defRung(id)] >= RANK.view,
    assertViewEntity: notNeeded,
    filterViewableDefIds: notNeeded,
    viewAccessFor: () => ResourcePermission.view,
    canAdministerDef: (id) => defRung(id) === 'admin',
    assertAdministerDef: notNeeded,
    canViewInstance: (_k: InstanceAccessKey, id: string) => RANK[instRung(id)] >= RANK.view,
    canEditInstance: (_k, id) => RANK[instRung(id)] >= RANK.edit,
    canAdminInstance: (_k, id) => instRung(id) === 'admin',
    assertViewInstance: notNeeded,
    assertEditInstance: notNeeded,
    assertAdminInstance: notNeeded,
  } satisfies CapabilityView
}

/**
 * An OWNER/ADMIN: every gate open, every area at its CEILING.
 *
 * Not `Level.Full` everywhere — that is not what an owner composes.
 * `CapabilitySet.areaLevel` recovers the rung from the held keys, so it can never
 * exceed the area's own ladder: an owner reads `Read` on `auditLog`, whose only
 * rung is `Read`. The stub used to say `Full` there, which is why the clamp's
 * ladder mismatch (an all-`admin` policy reading as "reduced" for an owner)
 * survived this suite.
 */
const ADMIN = publisher({
  areas: Object.fromEntries(Object.values(Area).map((a) => [a, areaCeilingLevel(a)])) as Partial<
    Record<Area, Level>
  >,
  defDefault: 'admin',
  instanceDefault: 'admin',
})

/**
 * The §9.1 subject: holds `agentsManage` (so the router lets them publish) and
 * `records: Read`, nothing else. Their def posture is view-only.
 */
const MEMBER_RECORDS_READ = publisher({
  areas: { [Area.agents]: Level.Full, [Area.records]: Level.Read },
  defDefault: 'view',
  instanceDefault: 'none',
})

const DEFS: ClampDefinition[] = [
  { apiSlug: 'deals', entityDefinitionId: 'def-deals' },
  { apiSlug: 'contacts', entityDefinitionId: 'def-contacts' },
]

/** The seeded `agent` system profile, resolved: all-`full` (§5.1). */
function allFullResolved(): PublishedAgentPermissionPolicy {
  return { ...legacyFullAgentPolicy(), sourceProfileId: 'p-agent' }
}

describe('the §9.1 author-clamp case', () => {
  it('clamps an all-Full profile down to a records:Read member who publishes it', () => {
    const { policy, reductions } = clampAgentPolicyToPublisher({
      resolved: allFullResolved(),
      publisher: MEMBER_RECORDS_READ,
      publisherUserId: 'u-member',
      definitions: DEFS,
    })

    // Areas: only what the member holds.
    expect(policy.areas.overrides[Area.records]).toBe('view')
    expect(policy.areas.overrides[Area.billing]).toBe('none')
    expect(policy.areas.overrides[Area.agents]).toBe('admin')

    // Definitions: view-only, so record WRITES through this agent are denied.
    expect(policy.definitions.overrides.deals).toBe('view')
    expect(policy.definitions.overrides.contacts).toBe('view')
    // …and a def created after publication is bounded the same way.
    expect(policy.definitions.default).toBe('view')

    // Resource instances: the member holds nothing, so neither does the agent.
    expect(policy.resources.kb?.default).toBe('none')
    expect(policy.resources.dataset?.default).toBe('none')
    expect(policy.resources.dashboard?.default).toBe('none')
    // There is no separate resource default left to bound — a resource type a
    // future deploy adds reads through `areas.default`, floored just below.
    expect(policy.areas.default).toBe('none')

    // The clamp is reported, never silent (§13).
    expect(reductions.length).toBeGreaterThan(0)
    expect(reductions).toEqual(
      expect.arrayContaining([
        { domain: 'definition', key: 'deals', from: 'admin', to: 'view' },
        { domain: 'area', key: Area.records, from: 'admin', to: 'view' },
      ])
    )
    expect(policy.clamp).toEqual(reductions)
    expect(policy.publishedByUserId).toBe('u-member')
  })

  it('leaves the same publish untouched when an ADMIN performs it — the intended escape hatch', () => {
    const { policy, reductions } = clampAgentPolicyToPublisher({
      resolved: allFullResolved(),
      publisher: ADMIN,
      publisherUserId: 'u-admin',
      definitions: DEFS,
    })

    expect(reductions).toEqual([])
    expect(policy.clamp).toEqual([])
    expect(policy.areas.overrides[Area.records]).toBe('admin')
    expect(policy.definitions.default).toBe('admin')
    expect(policy.definitions.overrides.deals).toBe('admin')
    // Every registered type is materialized at the rung it fell through to.
    expect(policy.resources.kb?.default).toBe('admin')
    expect(policy.resources.dashboard?.default).toBe('admin')
    expect(policy.publishedByUserId).toBe('u-admin')
  })

  it('re-clamps downward when the same profile is republished after a demotion', () => {
    // v1: published by an admin — Full.
    const v1 = clampAgentPolicyToPublisher({
      resolved: allFullResolved(),
      publisher: ADMIN,
      publisherUserId: 'u-author',
      definitions: DEFS,
    }).policy
    expect(v1.definitions.overrides.deals).toBe('admin')

    // The author is demoted to records:Read, then republishes the SAME profile.
    const v2 = clampAgentPolicyToPublisher({
      resolved: allFullResolved(),
      publisher: MEMBER_RECORDS_READ,
      publisherUserId: 'u-author',
      definitions: DEFS,
    }).policy

    expect(v2.definitions.overrides.deals).toBe('view')
    expect(v2.areas.overrides[Area.records]).toBe('view')
    // The OLD snapshot is untouched — a demotion must not silently break a running
    // automation; drift is bounded by the next publish, which is this one (§2.4a).
    expect(v1.definitions.overrides.deals).toBe('admin')
  })
})

describe('an area whose ladder is shorter than the policy vocabulary', () => {
  /**
   * `Area.auditLog` offers ONE rung (`Read`). An all-`admin` policy therefore asks
   * for a rung the area cannot express, and an owner composes `Read` — the
   * ceiling. Comparing the two raw spellings announced *"Account activity reduced
   * from Full to Read"* to an OWNER, for a publish that changes no enforcement:
   * `expandLevelsToKeys` maps both to exactly `auditLogView`.
   */
  it('reports no reduction when the publisher sits at the area ceiling', () => {
    const { policy, reductions } = clampAgentPolicyToPublisher({
      resolved: allFullResolved(),
      publisher: ADMIN,
      publisherUserId: 'u-owner',
      definitions: DEFS,
    })

    expect(reductions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ key: Area.auditLog })])
    )
    // The snapshot states the rung the agent actually composes, not the one the
    // flat vocabulary let the author type.
    expect(policy.areas.overrides[Area.auditLog]).toBe('view')
  })

  it('does not let a short ladder cap the retained default for an owner', () => {
    // `areas.default` answers for an area a FUTURE deploy adds. An owner who is at
    // the ceiling everywhere is unbounded, so the §2.4a escape hatch must survive
    // the existence of one Read-only area.
    const { policy } = clampAgentPolicyToPublisher({
      resolved: allFullResolved(),
      publisher: ADMIN,
      publisherUserId: 'u-owner',
      definitions: DEFS,
    })
    expect(policy.areas.default).toBe('admin')
  })

  it('still reports a real reduction on the same area', () => {
    // Someone who holds NOTHING on `auditLog` is genuinely reduced there.
    const noAudit = publisher({
      areas: Object.fromEntries(
        Object.values(Area).map((a) => [a, a === Area.auditLog ? Level.None : areaCeilingLevel(a)])
      ) as Partial<Record<Area, Level>>,
      defDefault: 'admin',
      instanceDefault: 'admin',
    })
    const { policy, reductions } = clampAgentPolicyToPublisher({
      resolved: allFullResolved(),
      publisher: noAudit,
      publisherUserId: 'u-member',
      definitions: DEFS,
    })
    expect(policy.areas.overrides[Area.auditLog]).toBe('none')
    // Reported at the rung the area can express — `view`, never a phantom `admin`.
    expect(reductions).toEqual(
      expect.arrayContaining([{ domain: 'area', key: Area.auditLog, from: 'view', to: 'none' }])
    )
    // One area held below its ceiling DOES floor the retained default.
    expect(policy.areas.default).toBe('none')
  })
})

describe('clamp mechanics', () => {
  it('never RAISES a restrictive profile toward a powerful publisher', () => {
    const { policy, reductions } = clampAgentPolicyToPublisher({
      resolved: { ...emptyAgentPolicy(), sourceProfileId: 'p-chat' },
      publisher: ADMIN,
      publisherUserId: 'u-admin',
      definitions: DEFS,
    })
    // `min`, not `max`: the fail-closed chat_agent profile stays fail-closed even
    // when an owner publishes it.
    expect(policy.areas.overrides[Area.records]).toBe('none')
    expect(policy.definitions.default).toBe('none')
    expect(policy.resources.kb?.default).toBe('none')
    expect(reductions).toEqual([])
  })

  it('clamps per definition, so one def can be reduced while another is not', () => {
    const mixed = publisher({
      areas: { [Area.records]: Level.Full },
      defs: { 'def-deals': 'view', 'def-contacts': 'admin' },
      defDefault: 'view',
    })
    const { policy, reductions } = clampAgentPolicyToPublisher({
      resolved: allFullResolved(),
      publisher: mixed,
      publisherUserId: 'u-mixed',
      definitions: DEFS,
    })
    expect(policy.definitions.overrides.deals).toBe('view')
    expect(policy.definitions.overrides.contacts).toBe('admin')
    expect(reductions).toEqual(
      expect.arrayContaining([{ domain: 'definition', key: 'deals', from: 'admin', to: 'view' }])
    )
    expect(reductions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'contacts' })])
    )
  })

  it('clamps a named instance override by that instance, not by the type default', () => {
    const kbHolder = publisher({
      areas: { [Area.knowledgeBase]: Level.Full },
      instances: { 'kb-mine': 'admin', 'kb-theirs': 'view' },
      instanceDefault: 'none',
    })
    const { policy } = clampAgentPolicyToPublisher({
      resolved: {
        ...allFullResolved(),
        resources: {
          kb: { default: 'admin', overrides: { 'kb-mine': 'admin', 'kb-theirs': 'admin' } },
        },
      },
      publisher: kbHolder,
      publisherUserId: 'u-kb',
      definitions: DEFS,
    })
    expect(policy.resources.kb?.overrides['kb-mine']).toBe('admin')
    expect(policy.resources.kb?.overrides['kb-theirs']).toBe('view')
    // An instance the publisher has never seen → their unknown-target posture.
    expect(policy.resources.kb?.default).toBe('none')
  })

  it('floors the retained defaults so a FUTURE area/def/type cannot exceed the publisher', () => {
    const { policy } = clampAgentPolicyToPublisher({
      resolved: allFullResolved(),
      publisher: MEMBER_RECORDS_READ,
      publisherUserId: 'u-member',
      definitions: DEFS,
    })
    // areas.default answers only for an area a future deploy adds; the member holds
    // None on most areas, so the conservative floor is None. A future resource TYPE
    // arrives with a new area and reads through that same floor — which is why the
    // retired `resourceDefault` needed no replacement of its own.
    expect(policy.areas.default).toBe('none')
    expect(policy.definitions.default).toBe('view')
  })

  it('materializes a type the profile left to fall through, bounded by the publisher', () => {
    // The publisher holds the `dashboards` AREA outright but nothing on any
    // dashboard instance — the `baselineAtCreate: true` shape. The profile names
    // no `dashboard` rule, so it would fall through to that Full area at run time;
    // materializing the entry is what stops the snapshot exceeding its publisher.
    const areaButNoInstances = publisher({
      areas: { [Area.dashboards]: Level.Full },
      defDefault: 'admin',
      instanceDefault: 'none',
    })
    const { policy, reductions } = clampAgentPolicyToPublisher({
      resolved: allFullResolved(),
      publisher: areaButNoInstances,
      publisherUserId: 'u-dash',
      definitions: DEFS,
    })

    expect(policy.areas.overrides[Area.dashboards]).toBe('admin')
    expect(policy.resources.dashboard).toEqual({ default: 'none', overrides: {} })
    expect(reductions).toEqual(
      expect.arrayContaining([{ domain: 'resource', key: 'dashboard', from: 'admin', to: 'none' }])
    )
  })

  it('clamps a rule naming a resource type this deploy does not register', () => {
    const { policy } = clampAgentPolicyToPublisher({
      resolved: {
        ...allFullResolved(),
        resources: { retired_kind: { default: 'admin', overrides: { 'x-1': 'admin' } } },
      },
      publisher: MEMBER_RECORDS_READ,
      publisherUserId: 'u-member',
      definitions: DEFS,
    })
    // Kept (the type may come back) but floored by the publisher's weakest
    // instance bound — there is no gate to probe for an unregistered type.
    expect(policy.resources.retired_kind).toEqual({
      default: 'none',
      overrides: { 'x-1': 'none' },
    })
  })

  it('carries a dangling definition override (archived def) instead of dropping it', () => {
    const { policy } = clampAgentPolicyToPublisher({
      resolved: {
        ...allFullResolved(),
        definitions: { default: 'admin', overrides: { 'archived-thing': 'admin' } },
      },
      publisher: ADMIN,
      publisherUserId: 'u-admin',
      // `archived-thing` is deliberately NOT in the current definition list.
      definitions: DEFS,
    })
    // §3's slug lifecycle: a dangling override must survive archive/restore.
    expect(policy.definitions.overrides['archived-thing']).toBe('admin')
  })

  it('applies no clamp for a system publish, and records no publisher', () => {
    const { policy, reductions } = clampAgentPolicyToPublisher({
      resolved: allFullResolved(),
      publisher: null,
      publisherUserId: null,
      definitions: DEFS,
    })
    expect(reductions).toEqual([])
    expect(policy.publishedByUserId).toBeNull()
    expect(policy.areas.default).toBe('admin')
  })

  it('preserves the source profile audit metadata through the clamp', () => {
    const { policy } = clampAgentPolicyToPublisher({
      resolved: { ...allFullResolved(), sourceProfileUpdatedAt: '2026-07-01T00:00:00.000Z' },
      publisher: MEMBER_RECORDS_READ,
      publisherUserId: 'u-member',
      definitions: DEFS,
    })
    expect(policy.sourceProfileId).toBe('p-agent')
    expect(policy.sourceProfileUpdatedAt).toBe('2026-07-01T00:00:00.000Z')
  })
})

describe('the clamp reuses the human gates rather than reimplementing them', () => {
  it('reads the definition rung by probing admin → edit → view in order', () => {
    const calls: string[] = []
    const probe: CapabilityView = {
      ...ADMIN,
      canAdministerDef: (id) => {
        calls.push(`admin:${id}`)
        return false
      },
      canEditEntity: (id) => {
        calls.push(`edit:${id}`)
        return true
      },
      canViewEntity: (id) => {
        calls.push(`view:${id}`)
        return true
      },
    }
    const { policy } = clampAgentPolicyToPublisher({
      resolved: allFullResolved(),
      publisher: probe,
      publisherUserId: 'u',
      definitions: [{ apiSlug: 'deals', entityDefinitionId: 'def-deals' }],
    })
    // Stopped at `edit` — `view` was never consulted for that def.
    expect(policy.definitions.overrides.deals).toBe('edit')
    expect(calls).toContain('admin:def-deals')
    expect(calls).toContain('edit:def-deals')
    expect(calls).not.toContain('view:def-deals')
  })

  it('reads area rungs through CapabilityView.areaLevel, not a private key set', () => {
    const seen: Area[] = []
    const probe: CapabilityView = {
      ...ADMIN,
      areaLevel: (area) => {
        seen.push(area)
        return Level.Read
      },
    }
    const { policy } = clampAgentPolicyToPublisher({
      resolved: allFullResolved(),
      publisher: probe,
      publisherUserId: 'u',
      definitions: DEFS,
    })
    expect(seen).toContain(Area.records)
    expect(seen).toContain(Area.billing)
    expect(policy.areas.overrides[Area.records]).toBe('view')
  })
})
