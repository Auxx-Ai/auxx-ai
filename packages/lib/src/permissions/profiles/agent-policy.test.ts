// packages/lib/src/permissions/profiles/agent-policy.test.ts

import type { AgentPermissionPolicy, PublishedAgentPermissionPolicy } from '@auxx/database'
import { ResourcePermission } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { Area, Level } from '../capabilities/registry'
import {
  areaLevelToPermission,
  authorizationOnlyPolicy,
  emptyAgentPolicy,
  minPermission,
  parsePublishedAgentPolicy,
  permissionToAreaLevel,
  policyAreaLevel,
  policyDefinitionLevel,
  policyResourceLevel,
  resolveDraftAgentPolicy,
} from './agent-policy'
import type { CachedPermissionProfile } from './types'

/**
 * The exact-policy core (plan 19 §2.3): the four-rung ladder and its two mappings,
 * total lookups with no `inherit` tier, and draft-binding resolution.
 *
 * Pure functions only — no `@auxx/database` columns are touched, so the default
 * vitest config's schema Proxy is irrelevant here.
 */

function profile(over: Partial<CachedPermissionProfile>): CachedPermissionProfile {
  return {
    id: 'p1',
    slug: 'agent',
    name: 'Internal Agent',
    description: null,
    icon: null,
    seat: 'full',
    appliesTo: 'agent',
    role: 'USER',
    baseLevel: null,
    ceiling: null,
    agentPolicy: null,
    isSystem: true,
    updatedAt: '2026-07-24T00:00:00.000Z',
    ...over,
  }
}

function uniform(level: ResourcePermission): AgentPermissionPolicy {
  return {
    areas: { default: level, overrides: {} },
    definitions: { default: level, overrides: {} },
    resources: {},
  }
}

describe('the four exact rungs map onto the numeric area ladder (§2.3)', () => {
  it('maps every rung to its area Level', () => {
    expect(permissionToAreaLevel(ResourcePermission.none)).toBe(Level.None)
    expect(permissionToAreaLevel(ResourcePermission.view)).toBe(Level.Read)
    expect(permissionToAreaLevel(ResourcePermission.edit)).toBe(Level.Edit)
    expect(permissionToAreaLevel(ResourcePermission.admin)).toBe(Level.Full)
  })

  it('round-trips the inverse used by the publish-time clamp', () => {
    for (const level of ['none', 'view', 'edit', 'admin'] as const) {
      expect(areaLevelToPermission(permissionToAreaLevel(level))).toBe(level)
    }
  })

  it('takes the lower rung, with none as the floor', () => {
    expect(minPermission('admin', 'view')).toBe('view')
    expect(minPermission('view', 'admin')).toBe('view')
    expect(minPermission('edit', 'none')).toBe('none')
    expect(minPermission('admin', 'admin')).toBe('admin')
  })
})

describe('lookups are total — there is no run-time inherit (§2.3)', () => {
  const policy: PublishedAgentPermissionPolicy = {
    ...emptyAgentPolicy(),
    areas: { default: 'view', overrides: { [Area.records]: 'admin' } },
    definitions: { default: 'edit', overrides: { deals: 'none' } },
    resources: { kb: { default: 'none', overrides: { 'kb-1': 'admin' } } },
  }

  it('answers an unnamed area from the default', () => {
    expect(policyAreaLevel(policy, Area.records)).toBe('admin')
    expect(policyAreaLevel(policy, Area.files)).toBe('view')
  })

  it('answers a definition created after publication from the default', () => {
    expect(policyDefinitionLevel(policy, 'deals')).toBe('none')
    expect(policyDefinitionLevel(policy, 'a-def-that-did-not-exist-at-publish')).toBe('edit')
  })

  it('answers an unlisted resource type from its own area, not from another type', () => {
    // `kb-1`'s own rule is `admin`, but `knowledgeBase` is only `view` here — the
    // area gate is INSIDE this lookup now, so the rule cannot outrun its parent.
    expect(policyResourceLevel(policy, 'kb', 'kb-1')).toBe('view')
    expect(policyResourceLevel(policy, 'kb', 'kb-2')).toBe('none')
    // `dataset` has no entry at all → the `datasets` area answers, not `kb`'s rule.
    expect(policyResourceLevel(policy, 'dataset', 'ds-1')).toBe('view')
    // `records: admin` must not leak sideways into a resource type.
    expect(policyResourceLevel(policy, 'dashboard', 'dash-1')).toBe('view')
  })

  it('fails closed for a resource type this deploy no longer registers', () => {
    expect(policyResourceLevel(policy, 'a-retired-resource-kind', 'x-1')).toBe('none')
  })

  it('lets an area of none close a type that carries an explicit rule', () => {
    const closed: PublishedAgentPermissionPolicy = {
      ...policy,
      areas: { default: 'none', overrides: {} },
    }
    expect(policyResourceLevel(closed, 'kb', 'kb-1')).toBe('none')
  })
})

describe('parsePublishedAgentPolicy coerces defensively and fails closed', () => {
  it('reads an unusable policy as none, never as admin', () => {
    const parsed = parsePublishedAgentPolicy(null)
    expect(parsed.areas.default).toBe('none')
    expect(parsed.definitions.default).toBe('none')
    expect(parsed.resources).toEqual({})
    // No resource keyspace of its own to fail closed — an unreadable policy has
    // an all-`none` area map, and every resource type reads through that.
    expect(policyResourceLevel(parsed, 'kb', 'kb-1')).toBe('none')
  })

  it('reads a type entry with a corrupt default as none, not as its area rung', () => {
    const parsed = parsePublishedAgentPolicy({
      areas: { default: 'admin', overrides: {} },
      resources: { kb: { default: 'sideways', overrides: {} } },
    })
    // The area fall-through is for a type with NO entry. A corrupt entry must not
    // read wider than the absence it replaced.
    expect(parsed.resources.kb?.default).toBe('none')
    expect(policyResourceLevel(parsed, 'kb', 'kb-1')).toBe('none')
  })

  it('drops override values outside the closed vocabulary rather than guessing', () => {
    const parsed = parsePublishedAgentPolicy({
      // `'full'` is the RETIRED spelling (plan 26 Phase 2) — after data migration
      // 054 it must read as an unknown value and be dropped, not silently honored.
      areas: {
        default: 'view',
        overrides: { records: 'admin', files: 'ADMIN', billing: 7, comments: 'full' },
      },
    })
    expect(parsed.areas.overrides.records).toBe('admin')
    expect(parsed.areas.overrides.files).toBeUndefined()
    expect(parsed.areas.overrides.billing).toBeUndefined()
    expect(parsed.areas.overrides.comments).toBeUndefined()
    // …and a dropped override then reads as the default, so lookups stay total.
    expect(policyAreaLevel(parsed, Area.files)).toBe('view')
  })
})

describe('authorizationOnlyPolicy excludes audit metadata (§8.1)', () => {
  it('keeps authorization content and drops the byline', () => {
    const base: PublishedAgentPermissionPolicy = {
      ...emptyAgentPolicy(),
      areas: { default: 'view', overrides: {} },
    }
    const byMember = { ...base, publishedByUserId: 'u-member', clamp: [] }
    const byAdmin = {
      ...base,
      publishedByUserId: 'u-admin',
      sourceProfileUpdatedAt: '2026-01-01T00:00:00.000Z',
      clamp: [
        { domain: 'area' as const, key: 'records', from: 'admin' as const, to: 'view' as const },
      ],
    }

    // Same authority, different publisher + different clamp record ⇒ identical
    // projection, so re-publishing unchanged authority stays a no-op republish.
    expect(authorizationOnlyPolicy(byMember)).toEqual(authorizationOnlyPolicy(byAdmin))

    // A genuine authority change DOES show up.
    const widened = { ...byMember, areas: { default: 'admin' as const, overrides: {} } }
    expect(authorizationOnlyPolicy(widened)).not.toEqual(authorizationOnlyPolicy(byMember))
  })
})

describe('resolveDraftAgentPolicy — the draft binding (§1.3)', () => {
  const agentProfile = profile({ id: 'p-agent', slug: 'agent', agentPolicy: uniform('admin') })
  const chatProfile = profile({ id: 'p-chat', slug: 'chat_agent', agentPolicy: uniform('none') })
  const base = { organizationId: 'org-1', agentId: 'a-1' }

  it('resolves a null binding by kind: internal → agent, chat → chat_agent (§18)', () => {
    const internal = resolveDraftAgentPolicy({
      ...base,
      kind: 'internal',
      permissionProfileId: null,
      profiles: [agentProfile, chatProfile],
    })
    expect(internal.areas.default).toBe('admin')
    expect(internal.sourceProfileId).toBe('p-agent')

    const chat = resolveDraftAgentPolicy({
      ...base,
      kind: 'chat',
      permissionProfileId: null,
      profiles: [agentProfile, chatProfile],
    })
    expect(chat.areas.default).toBe('none')
    expect(chat.definitions.default).toBe('none')
    expect(chat.sourceProfileId).toBe('p-chat')
  })

  it('materializes every known area so the snapshot is explicit and auditable', () => {
    const resolved = resolveDraftAgentPolicy({
      ...base,
      kind: 'internal',
      permissionProfileId: 'p-agent',
      profiles: [agentProfile],
    })
    expect(resolved.areas.overrides[Area.records]).toBe('admin')
    expect(resolved.areas.overrides[Area.billing]).toBe('admin')
    // …while the default is retained for an area a future deploy adds.
    expect(resolved.areas.default).toBe('admin')
  })

  it('records the source profile id + updatedAt as audit metadata', () => {
    const resolved = resolveDraftAgentPolicy({
      ...base,
      kind: 'internal',
      permissionProfileId: 'p-agent',
      profiles: [agentProfile],
    })
    expect(resolved.sourceProfileId).toBe('p-agent')
    expect(resolved.sourceProfileUpdatedAt).toBe('2026-07-24T00:00:00.000Z')
    // publishedByUserId is stamped by the clamp, not by resolution.
    expect(resolved.publishedByUserId).toBeNull()
  })

  it('refuses a foreign/dangling binding and falls back to the kind template', () => {
    const resolved = resolveDraftAgentPolicy({
      ...base,
      kind: 'chat',
      permissionProfileId: 'p-from-another-org',
      profiles: [agentProfile, chatProfile],
    })
    expect(resolved.sourceProfileId).toBe('p-chat')
    expect(resolved.areas.default).toBe('none')
  })

  it('fails closed when a human-only profile is mis-bound to an agent', () => {
    const humanProfile = profile({ id: 'p-member', slug: 'member', appliesTo: 'member' })
    const resolved = resolveDraftAgentPolicy({
      ...base,
      kind: 'internal',
      permissionProfileId: 'p-member',
      profiles: [humanProfile, agentProfile],
    })
    // NOT the permissive `agent` fallback: an explicit binding to something with no
    // agentPolicy is a misconfiguration, and the safe reading is "no authority".
    expect(resolved.areas.default).toBe('none')
    expect(resolved.definitions.default).toBe('none')
  })

  it('fails closed when the org has no seeded agent profiles at all', () => {
    const resolved = resolveDraftAgentPolicy({
      ...base,
      kind: 'internal',
      permissionProfileId: null,
      profiles: [],
    })
    expect(resolved.areas.default).toBe('none')
    expect(resolved.sourceProfileId).toBeNull()
  })
})
