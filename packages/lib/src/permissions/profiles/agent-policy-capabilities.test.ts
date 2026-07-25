// packages/lib/src/permissions/profiles/agent-policy-capabilities.test.ts

import type { AgentAccessLevel, PublishedAgentPermissionPolicy } from '@auxx/database'
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
 * discovery/use, `Read` denies mutation, `Read + Write` denies administration,
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
function dealsAt(level: AgentAccessLevel): PublishedAgentPermissionPolicy {
  return {
    ...emptyAgentPolicy(),
    areas: { default: 'none', overrides: { [Area.records]: 'full' } },
    definitions: { default: 'none', overrides: { deals: level } },
  }
}

/** A policy where one KB instance sits at exactly one rung. */
function kbAt(level: AgentAccessLevel): PublishedAgentPermissionPolicy {
  return {
    ...emptyAgentPolicy(),
    areas: { default: 'none', overrides: { [Area.knowledgeBase]: 'full' } },
    resources: { kb: { default: 'none', overrides: { 'kb-1': level } } },
  }
}

describe('the four exact levels — AREAS (§9.1)', () => {
  it('expands each area rung into the same key set a human at that Level holds', () => {
    const at = (level: AgentAccessLevel) =>
      view({
        ...emptyAgentPolicy(),
        areas: { default: 'none', overrides: { [Area.records]: level } },
      })

    // None: no discovery, no use.
    expect(at('none').can(PermissionKey.recordsView)).toBe(false)
    expect(at('none').areaLevel(Area.records)).toBe(Level.None)

    // Read: list/read, no mutation.
    expect(at('read').can(PermissionKey.recordsView)).toBe(true)
    expect(at('read').can(PermissionKey.recordsEdit)).toBe(false)
    expect(at('read').areaLevel(Area.records)).toBe(Level.Read)

    // Read + Write: mutation, no administration rung.
    expect(at('read_write').can(PermissionKey.recordsEdit)).toBe(true)
    expect(at('read_write').can(PermissionKey.recordsDelete)).toBe(false)
    expect(at('read_write').areaLevel(Area.records)).toBe(Level.Edit)

    // Full: the whole ladder.
    expect(at('full').can(PermissionKey.recordsDelete)).toBe(true)
    expect(at('full').can(PermissionKey.recordsImport)).toBe(true)
    expect(at('full').areaLevel(Area.records)).toBe(Level.Full)
  })

  it('holds NOTHING on an area the policy sets to none, even at Full elsewhere', () => {
    const caps = view({
      ...emptyAgentPolicy(),
      areas: { default: 'none', overrides: { [Area.records]: 'full' } },
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
    const caps = view(dealsAt('read'))
    expect(caps.canViewEntity('deals')).toBe(true)
    expect(caps.canEditEntity('deals')).toBe(false)
    expect(caps.canAdministerDef('deals')).toBe(false)
    expect(caps.viewAccessFor('deals')).toBe(ResourcePermission.view)
    expect(() => caps.assertEditEntity('deals')).toThrow(ForbiddenError)
  })

  it('Read + Write denies administration', () => {
    const caps = view(dealsAt('read_write'))
    expect(caps.canEditEntity('deals')).toBe(true)
    expect(caps.canAdministerDef('deals')).toBe(false)
    expect(caps.viewAccessFor('deals')).toBe(ResourcePermission.edit)
    expect(() => caps.assertAdministerDef('deals')).toThrow(ForbiddenError)
  })

  it('Full reaches administration', () => {
    const caps = view(dealsAt('full'))
    expect(caps.canAdministerDef('deals')).toBe(true)
    expect(caps.viewAccessFor('deals')).toBe(ResourcePermission.admin)
  })

  it('resolves every def form — apiSlug, resource id, and definition CUID — to one rule', () => {
    const caps = view(dealsAt('read'))
    for (const form of ['deals', 'r-deals', 'def-deals']) {
      expect(caps.canViewEntity(form)).toBe(true)
      expect(caps.canEditEntity(form)).toBe(false)
    }
  })

  it('filters def lists by the exact policy', () => {
    const caps = view({
      ...emptyAgentPolicy(),
      areas: { default: 'full', overrides: {} },
      definitions: { default: 'none', overrides: { deals: 'read', contacts: 'read_write' } },
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
    expect(caps.canViewEntity('snippet')).toBe(true)
    // Writing it still needs the mail-area verb, which this policy does not grant.
    expect(caps.canEditEntity('snippet')).toBe(false)
    expect(caps.canAdministerDef('snippet')).toBe(false)
  })
})

describe('the four exact levels — RESOURCE INSTANCES (§9.1)', () => {
  it('walks None → Read → Read+Write → Full on one KB instance', () => {
    expect(view(kbAt('none')).canViewInstance('kb', 'kb-1')).toBe(false)

    const read = view(kbAt('read'))
    expect(read.canViewInstance('kb', 'kb-1')).toBe(true)
    expect(read.canEditInstance('kb', 'kb-1')).toBe(false)

    const write = view(kbAt('read_write'))
    expect(write.canEditInstance('kb', 'kb-1')).toBe(true)
    expect(write.canAdminInstance('kb', 'kb-1')).toBe(false)

    const full = view(kbAt('full'))
    expect(full.canAdminInstance('kb', 'kb-1')).toBe(true)
  })

  it('answers an unlisted instance from the type default, and an unlisted type from resourceDefault', () => {
    const caps = view({
      ...legacyFullAgentPolicy(),
      resources: { kb: { default: 'read', overrides: { 'kb-1': 'full' } } },
    })
    expect(caps.canAdminInstance('kb', 'kb-1')).toBe(true)
    expect(caps.canViewInstance('kb', 'kb-never-seen')).toBe(true)
    expect(caps.canEditInstance('kb', 'kb-never-seen')).toBe(false)
    // `dataset` has no entry → resourceDefault ('full' here).
    expect(caps.canAdminInstance('dataset', 'ds-1')).toBe(true)
  })

  it('intersects the instance rule with its coarse L2 area gate', () => {
    const caps = view({
      ...emptyAgentPolicy(),
      // Area closed, but a stale instance override says Full.
      areas: { default: 'none', overrides: { [Area.knowledgeBase]: 'none' } },
      resources: { kb: { default: 'none', overrides: { 'kb-1': 'full' } } },
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
    const effective = intersectCapabilities(view(dealsAt('read')), ownerRunAs)
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
    const effective = intersectCapabilities(view(dealsAt('full')), restrictedDelegate)
    expect(effective.canViewEntity('deals')).toBe(true)
    expect(effective.canEditEntity('deals')).toBe(false)
  })
})

describe('add-then-remove definition authority (§9.1)', () => {
  const v1 = view({
    ...emptyAgentPolicy(),
    areas: { default: 'full', overrides: {} },
    definitions: { default: 'none', overrides: { deals: 'full' } },
  })
  const v2 = view({
    ...emptyAgentPolicy(),
    areas: { default: 'full', overrides: {} },
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
