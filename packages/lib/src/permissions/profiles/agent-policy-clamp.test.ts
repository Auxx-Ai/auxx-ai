// packages/lib/src/permissions/profiles/agent-policy-clamp.test.ts

import type { PublishedAgentPermissionPolicy } from '@auxx/database'
import { ResourcePermission } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import type { CapabilityView } from '../capabilities/capability-view'
import type { InstanceAccessKey } from '../capabilities/instance-access'
import { Area, Level, type PermissionKey } from '../capabilities/registry'
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
  defs?: Record<string, 'none' | 'read' | 'read_write' | 'full'>
  /**
   * The publisher's posture toward a def they hold no explicit grant on — what an
   * unrestricted def (and any def created after publish) resolves to. This is
   * exactly what the clamp's sentinel probe reads.
   */
  defDefault?: 'none' | 'read' | 'read_write' | 'full'
  /** Per-instance rung; absent = `instanceDefault`. */
  instances?: Record<string, 'none' | 'read' | 'read_write' | 'full'>
  instanceDefault?: 'none' | 'read' | 'read_write' | 'full'
}

const RANK = { none: 0, read: 1, read_write: 2, full: 3 } as const

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
    canEditEntity: (id) => RANK[defRung(id)] >= RANK.read_write,
    assertEditEntity: notNeeded,
    filterEditableDefIds: notNeeded,
    canViewEntity: (id) => RANK[defRung(id)] >= RANK.read,
    assertViewEntity: notNeeded,
    filterViewableDefIds: notNeeded,
    viewAccessFor: () => ResourcePermission.view,
    canAdministerDef: (id) => defRung(id) === 'full',
    assertAdministerDef: notNeeded,
    canViewInstance: (_k: InstanceAccessKey, id: string) => RANK[instRung(id)] >= RANK.read,
    canEditInstance: (_k, id) => RANK[instRung(id)] >= RANK.read_write,
    canAdminInstance: (_k, id) => instRung(id) === 'full',
    assertViewInstance: notNeeded,
    assertEditInstance: notNeeded,
    assertAdminInstance: notNeeded,
  } satisfies CapabilityView
}

/** An OWNER/ADMIN: every gate open, every area Full. */
const ADMIN = publisher({
  areas: Object.fromEntries(Object.values(Area).map((a) => [a, Level.Full])) as Partial<
    Record<Area, Level>
  >,
  defDefault: 'full',
  instanceDefault: 'full',
})

/**
 * The §9.1 subject: holds `agentsManage` (so the router lets them publish) and
 * `records: Read`, nothing else. Their def posture is view-only.
 */
const MEMBER_RECORDS_READ = publisher({
  areas: { [Area.agents]: Level.Full, [Area.records]: Level.Read },
  defDefault: 'read',
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
    expect(policy.areas.overrides[Area.records]).toBe('read')
    expect(policy.areas.overrides[Area.billing]).toBe('none')
    expect(policy.areas.overrides[Area.agents]).toBe('full')

    // Definitions: view-only, so record WRITES through this agent are denied.
    expect(policy.definitions.overrides.deals).toBe('read')
    expect(policy.definitions.overrides.contacts).toBe('read')
    // …and a def created after publication is bounded the same way.
    expect(policy.definitions.default).toBe('read')

    // Resource instances: the member holds nothing, so neither does the agent.
    expect(policy.resources.kb?.default).toBe('none')
    expect(policy.resources.dataset?.default).toBe('none')
    expect(policy.resourceDefault).toBe('none')

    // The clamp is reported, never silent (§13).
    expect(reductions.length).toBeGreaterThan(0)
    expect(reductions).toEqual(
      expect.arrayContaining([
        { domain: 'definition', key: 'deals', from: 'full', to: 'read' },
        { domain: 'area', key: Area.records, from: 'full', to: 'read' },
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
    expect(policy.areas.overrides[Area.records]).toBe('full')
    expect(policy.definitions.default).toBe('full')
    expect(policy.definitions.overrides.deals).toBe('full')
    expect(policy.resourceDefault).toBe('full')
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
    expect(v1.definitions.overrides.deals).toBe('full')

    // The author is demoted to records:Read, then republishes the SAME profile.
    const v2 = clampAgentPolicyToPublisher({
      resolved: allFullResolved(),
      publisher: MEMBER_RECORDS_READ,
      publisherUserId: 'u-author',
      definitions: DEFS,
    }).policy

    expect(v2.definitions.overrides.deals).toBe('read')
    expect(v2.areas.overrides[Area.records]).toBe('read')
    // The OLD snapshot is untouched — a demotion must not silently break a running
    // automation; drift is bounded by the next publish, which is this one (§2.4a).
    expect(v1.definitions.overrides.deals).toBe('full')
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
    expect(policy.resourceDefault).toBe('none')
    expect(reductions).toEqual([])
  })

  it('clamps per definition, so one def can be reduced while another is not', () => {
    const mixed = publisher({
      areas: { [Area.records]: Level.Full },
      defs: { 'def-deals': 'read', 'def-contacts': 'full' },
      defDefault: 'read',
    })
    const { policy, reductions } = clampAgentPolicyToPublisher({
      resolved: allFullResolved(),
      publisher: mixed,
      publisherUserId: 'u-mixed',
      definitions: DEFS,
    })
    expect(policy.definitions.overrides.deals).toBe('read')
    expect(policy.definitions.overrides.contacts).toBe('full')
    expect(reductions).toEqual(
      expect.arrayContaining([{ domain: 'definition', key: 'deals', from: 'full', to: 'read' }])
    )
    expect(reductions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'contacts' })])
    )
  })

  it('clamps a named instance override by that instance, not by the type default', () => {
    const kbHolder = publisher({
      areas: { [Area.knowledgeBase]: Level.Full },
      instances: { 'kb-mine': 'full', 'kb-theirs': 'read' },
      instanceDefault: 'none',
    })
    const { policy } = clampAgentPolicyToPublisher({
      resolved: {
        ...allFullResolved(),
        resources: {
          kb: { default: 'full', overrides: { 'kb-mine': 'full', 'kb-theirs': 'full' } },
        },
      },
      publisher: kbHolder,
      publisherUserId: 'u-kb',
      definitions: DEFS,
    })
    expect(policy.resources.kb?.overrides['kb-mine']).toBe('full')
    expect(policy.resources.kb?.overrides['kb-theirs']).toBe('read')
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
    // None on most areas, so the conservative floor is None.
    expect(policy.areas.default).toBe('none')
    expect(policy.definitions.default).toBe('read')
    expect(policy.resourceDefault).toBe('none')
  })

  it('carries a dangling definition override (archived def) instead of dropping it', () => {
    const { policy } = clampAgentPolicyToPublisher({
      resolved: {
        ...allFullResolved(),
        definitions: { default: 'full', overrides: { 'archived-thing': 'full' } },
      },
      publisher: ADMIN,
      publisherUserId: 'u-admin',
      // `archived-thing` is deliberately NOT in the current definition list.
      definitions: DEFS,
    })
    // §3's slug lifecycle: a dangling override must survive archive/restore.
    expect(policy.definitions.overrides['archived-thing']).toBe('full')
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
    expect(policy.areas.default).toBe('full')
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
    expect(policy.definitions.overrides.deals).toBe('read_write')
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
    expect(policy.areas.overrides[Area.records]).toBe('read')
  })
})
