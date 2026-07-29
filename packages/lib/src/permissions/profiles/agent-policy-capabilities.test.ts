// packages/lib/src/permissions/profiles/agent-policy-capabilities.test.ts

import type { PublishedAgentPermissionPolicy } from '@auxx/database'
import { ResourcePermission } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { ForbiddenError } from '../../errors'
import type { CapabilityView } from '../capabilities/capability-view'
import { intersectCapabilities } from '../capabilities/capability-view'
import type { InstanceAccessKey } from '../capabilities/instance-access'
import { Area, Level, PermissionKey } from '../capabilities/registry'
import { emptyAgentPolicy, legacyFullAgentPolicy } from './agent-policy'
import {
  AgentPolicyCapabilities,
  buildDefIdToApiSlug,
  buildDefIdToEntitySlug,
  type PolicyResourceRef,
} from './agent-policy-capabilities'

/**
 * `AgentPolicyCapabilities` — the runtime enforcement face of a published policy.
 *
 * Covers plan 19 §9.1's *"Four exact levels, all domains"* bullet (`None` denies
 * discovery/use, `Read` denies mutation, `Edit` denies administration,
 * `Full` reaches administration) plus the *"run-as cannot widen"* property.
 */

const RESOURCES: PolicyResourceRef[] = [
  { id: 'r-deals', apiSlug: 'deals', entityDefinitionId: 'def-deals', entityType: undefined },
  { id: 'r-contacts', apiSlug: 'contacts', entityDefinitionId: 'def-contacts' },
  { id: 'snippet', apiSlug: 'snippets', entityDefinitionId: 'def-snippet', entityType: 'snippet' },
]

function view(policy: PublishedAgentPermissionPolicy): AgentPolicyCapabilities {
  return new AgentPolicyCapabilities(
    policy,
    buildDefIdToApiSlug(RESOURCES),
    buildDefIdToEntitySlug(RESOURCES)
  )
}

/** A policy where `deals` sits at exactly one rung and everything else is none. */
function dealsAt(level: ResourcePermission): PublishedAgentPermissionPolicy {
  return {
    ...emptyAgentPolicy(),
    areas: { default: 'none', overrides: { [Area.records]: 'admin' } },
    definitions: { default: 'none', overrides: { deals: level } },
  }
}

/** A policy where one KB instance sits at exactly one rung. */
function kbAt(level: ResourcePermission): PublishedAgentPermissionPolicy {
  return {
    ...emptyAgentPolicy(),
    areas: { default: 'none', overrides: { [Area.knowledgeBase]: 'admin' } },
    resources: { kb: { default: 'none', overrides: { 'kb-1': level } } },
  }
}

describe('the four exact levels — AREAS (§9.1)', () => {
  it('expands each area rung into the same key set a human at that Level holds', () => {
    const at = (level: ResourcePermission) =>
      view({
        ...emptyAgentPolicy(),
        areas: { default: 'none', overrides: { [Area.records]: level } },
      })

    // None: no discovery, no use.
    expect(at('none').can(PermissionKey.recordsView)).toBe(false)
    expect(at('none').areaLevel(Area.records)).toBe(Level.None)

    // Read: list/read, no mutation.
    expect(at('view').can(PermissionKey.recordsView)).toBe(true)
    expect(at('view').can(PermissionKey.recordsEdit)).toBe(false)
    expect(at('view').areaLevel(Area.records)).toBe(Level.Read)

    // Edit: mutation, no administration rung.
    expect(at('edit').can(PermissionKey.recordsEdit)).toBe(true)
    expect(at('edit').can(PermissionKey.recordsDelete)).toBe(false)
    expect(at('edit').areaLevel(Area.records)).toBe(Level.Edit)

    // Full: the whole ladder.
    expect(at('admin').can(PermissionKey.recordsDelete)).toBe(true)
    expect(at('admin').can(PermissionKey.recordsImport)).toBe(true)
    expect(at('admin').areaLevel(Area.records)).toBe(Level.Full)
  })

  it('holds NOTHING on an area the policy sets to none, even at Full elsewhere', () => {
    const caps = view({
      ...emptyAgentPolicy(),
      areas: { default: 'none', overrides: { [Area.records]: 'admin' } },
    })
    expect(caps.can(PermissionKey.recordsDelete)).toBe(true)
    expect(caps.can(PermissionKey.billingManage)).toBe(false)
    expect(caps.can(PermissionKey.membersManage)).toBe(false)
    expect(caps.can(PermissionKey.settingsManage)).toBe(false)
    expect(() => caps.assert(PermissionKey.billingManage)).toThrow(ForbiddenError)
  })
})

describe('the four exact levels — ENTITY DEFINITIONS (§9.1)', () => {
  it('None denies discovery and use', () => {
    const caps = view(dealsAt('none'))
    expect(caps.canViewEntity('deals')).toBe(false)
    expect(caps.canEditEntity('deals')).toBe(false)
    expect(caps.canAdministerDef('deals')).toBe(false)
    expect(caps.viewAccessFor('deals')).toBeUndefined()
    expect(() => caps.assertViewEntity('deals')).toThrow(ForbiddenError)
  })

  it('Read denies mutation', () => {
    const caps = view(dealsAt('view'))
    expect(caps.canViewEntity('deals')).toBe(true)
    expect(caps.canEditEntity('deals')).toBe(false)
    expect(caps.canAdministerDef('deals')).toBe(false)
    expect(caps.viewAccessFor('deals')).toBe(ResourcePermission.view)
    expect(() => caps.assertEditEntity('deals')).toThrow(ForbiddenError)
  })

  it('Edit denies administration', () => {
    const caps = view(dealsAt('edit'))
    expect(caps.canEditEntity('deals')).toBe(true)
    expect(caps.canAdministerDef('deals')).toBe(false)
    expect(caps.viewAccessFor('deals')).toBe(ResourcePermission.edit)
    expect(() => caps.assertAdministerDef('deals')).toThrow(ForbiddenError)
  })

  it('Full reaches administration', () => {
    const caps = view(dealsAt('admin'))
    expect(caps.canAdministerDef('deals')).toBe(true)
    expect(caps.viewAccessFor('deals')).toBe(ResourcePermission.admin)
  })

  it('resolves every def form — apiSlug, resource id, and definition CUID — to one rule', () => {
    const caps = view(dealsAt('view'))
    for (const form of ['deals', 'r-deals', 'def-deals']) {
      expect(caps.canViewEntity(form)).toBe(true)
      expect(caps.canEditEntity(form)).toBe(false)
    }
  })

  it('filters def lists by the exact policy', () => {
    const caps = view({
      ...emptyAgentPolicy(),
      areas: { default: 'admin', overrides: {} },
      definitions: { default: 'none', overrides: { deals: 'view', contacts: 'edit' } },
    })
    expect(caps.filterViewableDefIds(['deals', 'contacts', 'unknown'])).toEqual([
      'deals',
      'contacts',
    ])
    expect(caps.filterEditableDefIds(['deals', 'contacts', 'unknown'])).toEqual(['contacts'])
  })

  it('bypasses the definitions map for mail-infra defs, exactly like CapabilitySet', () => {
    const caps = view({
      ...emptyAgentPolicy(),
      definitions: { default: 'none', overrides: {} },
      areas: { default: 'none', overrides: {} },
    })
    // Visibility of mail infrastructure is the mail visibility system's job, not
    // the record-def keyspace — a `definitions: none` policy must not break it.
    // (`snippet` used to stand in here; it left `NON_RECORD_DEF_SLUGS` in plan
    // 36 §7.6 when it became an instance-access resource, so `thread` — which
    // is genuinely mail infrastructure — carries the case now.)
    expect(caps.canViewEntity('thread')).toBe(true)
    // Writing it still needs the mail-area verb, which this policy does not grant.
    expect(caps.canEditEntity('thread')).toBe(false)
    expect(caps.canAdministerDef('thread')).toBe(false)
  })

  it('snippet/signature no longer take the mail-infra bypass (plan 36 §7.6)', () => {
    const caps = view({
      ...emptyAgentPolicy(),
      definitions: { default: 'none', overrides: {} },
      areas: { default: 'none', overrides: {} },
    })
    // They are instance-access resources now: a `definitions: none` agent policy
    // no longer waves them through the def keyspace, and per-instance rules are
    // the only thing that can open them.
    expect(caps.canViewEntity('snippet')).toBe(false)
    expect(caps.canViewEntity('signature')).toBe(false)
  })
})

describe('the four exact levels — RESOURCE INSTANCES (§9.1)', () => {
  it('walks None → Read → Edit → Full on one KB instance', () => {
    expect(view(kbAt('none')).canViewInstance('kb', 'kb-1')).toBe(false)

    const read = view(kbAt('view'))
    expect(read.canViewInstance('kb', 'kb-1')).toBe(true)
    expect(read.canEditInstance('kb', 'kb-1')).toBe(false)

    const write = view(kbAt('edit'))
    expect(write.canEditInstance('kb', 'kb-1')).toBe(true)
    expect(write.canAdminInstance('kb', 'kb-1')).toBe(false)

    const full = view(kbAt('admin'))
    expect(full.canAdminInstance('kb', 'kb-1')).toBe(true)
  })

  it('answers an unlisted instance from the type default, and an unlisted type from its area', () => {
    const caps = view({
      ...legacyFullAgentPolicy(),
      resources: { kb: { default: 'view', overrides: { 'kb-1': 'admin' } } },
    })
    expect(caps.canAdminInstance('kb', 'kb-1')).toBe(true)
    expect(caps.canViewInstance('kb', 'kb-never-seen')).toBe(true)
    expect(caps.canEditInstance('kb', 'kb-never-seen')).toBe(false)
    // `dataset` has no entry → the `datasets` area answers ('admin' here).
    expect(caps.canAdminInstance('dataset', 'ds-1')).toBe(true)
  })

  it('falls a type with no rule through to ITS OWN area, not to a sibling type', () => {
    const caps = view({
      ...emptyAgentPolicy(),
      areas: {
        default: 'none',
        overrides: { [Area.datasets]: 'edit', [Area.knowledgeBase]: 'view' },
      },
      // Nothing named at all — every type reads through the area map above.
      resources: {},
    })
    expect(caps.canEditInstance('dataset', 'ds-1')).toBe(true)
    expect(caps.canAdminInstance('dataset', 'ds-1')).toBe(false)
    expect(caps.canViewInstance('kb', 'kb-1')).toBe(true)
    expect(caps.canEditInstance('kb', 'kb-1')).toBe(false)
    // `dashboards` is not in the map → `areas.default`, which is `none`.
    expect(caps.canViewInstance('dashboard', 'dash-1')).toBe(false)
  })

  it('intersects the instance rule with its coarse L2 area gate', () => {
    const caps = view({
      ...emptyAgentPolicy(),
      // Area closed, but a stale instance override says Full.
      areas: { default: 'none', overrides: { [Area.knowledgeBase]: 'none' } },
      resources: { kb: { default: 'none', overrides: { 'kb-1': 'admin' } } },
    })
    // The area rule wins downward — an agent must not route around its own policy.
    expect(caps.canViewInstance('kb', 'kb-1')).toBe(false)
    expect(() => caps.assertViewInstance('kb', 'kb-1')).toThrow(ForbiddenError)
  })
})

describe('run-as is delegation, never replacement (§0.15/§2.3)', () => {
  /** A stand-in for an OWNER's CapabilitySet: every gate open. */
  const ownerRunAs: CapabilityView = {
    can: () => true,
    has: () => true,
    assert: () => {},
    areaLevel: () => Level.Full,
    canWriteEntity: () => true,
    assertWriteEntity: () => {},
    canEditEntity: () => true,
    assertEditEntity: () => {},
    filterEditableDefIds: (ids) => ids,
    canViewEntity: () => true,
    assertViewEntity: () => {},
    filterViewableDefIds: (ids) => ids,
    viewAccessFor: () => ResourcePermission.admin,
    canAdministerDef: () => true,
    assertAdministerDef: () => {},
    canViewInstance: () => true,
    canEditInstance: () => true,
    canAdminInstance: () => true,
    assertViewInstance: () => {},
    assertEditInstance: () => {},
    assertAdminInstance: () => {},
  }

  it('an OWNER run-as cannot widen an agent published as None', () => {
    const published = view(dealsAt('none'))
    const effective = intersectCapabilities(published, ownerRunAs)

    expect(effective.canViewEntity('deals')).toBe(false)
    expect(effective.canEditEntity('deals')).toBe(false)
    expect(effective.canAdministerDef('deals')).toBe(false)
    expect(effective.viewAccessFor('deals')).toBeUndefined()
    expect(effective.can(PermissionKey.billingManage)).toBe(false)
    expect(effective.areaLevel(Area.billing)).toBe(Level.None)
    expect(effective.filterViewableDefIds(['deals'])).toEqual([])
  })

  it('an OWNER run-as cannot widen a Read-published definition to write', () => {
    const effective = intersectCapabilities(view(dealsAt('view')), ownerRunAs)
    expect(effective.canViewEntity('deals')).toBe(true)
    expect(effective.canEditEntity('deals')).toBe(false)
    expect(effective.viewAccessFor('deals')).toBe(ResourcePermission.view)
  })

  it('an OWNER run-as cannot widen a None-published resource instance', () => {
    const effective = intersectCapabilities(view(kbAt('none')), ownerRunAs)
    expect(effective.canViewInstance('kb', 'kb-1')).toBe(false)
    expect(effective.canAdminInstance('kb', 'kb-1')).toBe(false)
  })

  it('run-as CAN narrow — the delegate is a real bound too', () => {
    const restrictedDelegate: CapabilityView = { ...ownerRunAs, canEditEntity: () => false }
    const effective = intersectCapabilities(view(dealsAt('admin')), restrictedDelegate)
    expect(effective.canViewEntity('deals')).toBe(true)
    expect(effective.canEditEntity('deals')).toBe(false)
  })
})

describe('add-then-remove definition authority (§9.1)', () => {
  const v1 = view({
    ...emptyAgentPolicy(),
    areas: { default: 'admin', overrides: {} },
    definitions: { default: 'none', overrides: { deals: 'admin' } },
  })
  const v2 = view({
    ...emptyAgentPolicy(),
    areas: { default: 'admin', overrides: {} },
    definitions: { default: 'none', overrides: { deals: 'none' } },
  })

  it('publish Deals=Full then republish Deals=None removes reads, writes, and catalog entries', () => {
    expect(v1.canViewEntity('deals')).toBe(true)
    expect(v1.canEditEntity('deals')).toBe(true)
    expect(v1.canAdministerDef('deals')).toBe(true)
    expect(v1.filterViewableDefIds(['deals'])).toEqual(['deals'])

    expect(v2.canViewEntity('deals')).toBe(false)
    expect(v2.canEditEntity('deals')).toBe(false)
    expect(v2.canAdministerDef('deals')).toBe(false)
    // The prompt-side entity catalog filters on `canViewEntity`, so the agent
    // stops even being TOLD the def exists.
    expect(v2.filterViewableDefIds(['deals', 'contacts'])).toEqual([])
  })

  it('stays removed under a run-as OWNER — the None is load-bearing, not merely absent', () => {
    const effective = intersectCapabilities(v2, ownerRunAsFixture())
    expect(effective.canViewEntity('deals')).toBe(false)
    expect(effective.canEditEntity('deals')).toBe(false)
    expect(effective.filterViewableDefIds(['deals'])).toEqual([])
  })
})

/** Local copy of the all-open delegate, for the block above. */
function ownerRunAsFixture(): CapabilityView {
  return {
    can: () => true,
    has: () => true,
    assert: () => {},
    areaLevel: () => Level.Full,
    canWriteEntity: () => true,
    assertWriteEntity: () => {},
    canEditEntity: () => true,
    assertEditEntity: () => {},
    filterEditableDefIds: (ids) => ids,
    canViewEntity: () => true,
    assertViewEntity: () => {},
    filterViewableDefIds: (ids) => ids,
    viewAccessFor: () => ResourcePermission.admin,
    canAdministerDef: () => true,
    assertAdministerDef: () => {},
    canViewInstance: (_k: InstanceAccessKey, _id: string) => true,
    canEditInstance: () => true,
    canAdminInstance: () => true,
    assertViewInstance: () => {},
    assertEditInstance: () => {},
    assertAdminInstance: () => {},
  }
}
