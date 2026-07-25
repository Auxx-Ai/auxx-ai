// packages/lib/src/permissions/profiles/agent-policy.test.ts

import type { AgentPermissionPolicy, PublishedAgentPermissionPolicy } from '@auxx/database'
import { ResourcePermission } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { Area, Level } from '../capabilities/registry'
import {
  agentLevelToAreaLevel,
  agentLevelToPermission,
  areaLevelToAgentLevel,
  authorizationOnlyPolicy,
  emptyAgentPolicy,
  minAgentLevel,
  parsePublishedAgentPolicy,
  permissionToAgentLevel,
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
    baseLevel: null,
    ceiling: null,
    agentPolicy: null,
    isSystem: true,
    updatedAt: '2026-07-24T00:00:00.000Z',
    ...over,
  }
}

function uniform(level: 'none' | 'read' | 'read_write' | 'full'): AgentPermissionPolicy {
  return {
    areas: { default: level, overrides: {} },
    definitions: { default: level, overrides: {} },
    resourceDefault: level,
    resources: {},
  }
}

describe('the four exact rungs map onto both existing ladders (§2.3)', () => {
  it('maps every label to its area Level', () => {
    expect(agentLevelToAreaLevel('none')).toBe(Level.None)
    expect(agentLevelToAreaLevel('read')).toBe(Level.Read)
    expect(agentLevelToAreaLevel('read_write')).toBe(Level.Edit)
    expect(agentLevelToAreaLevel('full')).toBe(Level.Full)
  })

  it('maps every label to its definition/resource ResourcePermission', () => {
    expect(agentLevelToPermission('none')).toBeUndefined()
    expect(agentLevelToPermission('read')).toBe(ResourcePermission.view)
    expect(agentLevelToPermission('read_write')).toBe(ResourcePermission.edit)
    expect(agentLevelToPermission('full')).toBe(ResourcePermission.admin)
  })

  it('round-trips both inverses used by the publish-time clamp', () => {
    for (const level of ['none', 'read', 'read_write', 'full'] as const) {
      expect(areaLevelToAgentLevel(agentLevelToAreaLevel(level))).toBe(level)
      expect(permissionToAgentLevel(agentLevelToPermission(level))).toBe(level)
    }
  })

  it('takes the lower rung, with none as the floor', () => {
    expect(minAgentLevel('full', 'read')).toBe('read')
    expect(minAgentLevel('read', 'full')).toBe('read')
    expect(minAgentLevel('read_write', 'none')).toBe('none')
    expect(minAgentLevel('full', 'full')).toBe('full')
  })
})

describe('lookups are total — there is no run-time inherit (§2.3)', () => {
  const policy: PublishedAgentPermissionPolicy = {
    ...emptyAgentPolicy(),
    areas: { default: 'read', overrides: { [Area.records]: 'full' } },
    definitions: { default: 'read_write', overrides: { deals: 'none' } },
    resourceDefault: 'read',
    resources: { kb: { default: 'none', overrides: { 'kb-1': 'full' } } },
  }

  it('answers an unnamed area from the default', () => {
    expect(policyAreaLevel(policy, Area.records)).toBe('full')
    expect(policyAreaLevel(policy, Area.files)).toBe('read')
  })

  it('answers a definition created after publication from the default', () => {
    expect(policyDefinitionLevel(policy, 'deals')).toBe('none')
    expect(policyDefinitionLevel(policy, 'a-def-that-did-not-exist-at-publish')).toBe('read_write')
  })

  it('answers an unlisted resource type from resourceDefault, not from another type', () => {
    expect(policyResourceLevel(policy, 'kb', 'kb-1')).toBe('full')
    expect(policyResourceLevel(policy, 'kb', 'kb-2')).toBe('none')
    // `dataset` has no entry at all → the top-level resourceDefault answers.
    expect(policyResourceLevel(policy, 'dataset', 'ds-1')).toBe('read')
  })
})

describe('parsePublishedAgentPolicy coerces defensively and fails closed', () => {
  it('reads an unusable policy as none, never as full', () => {
    const parsed = parsePublishedAgentPolicy(null)
    expect(parsed.areas.default).toBe('none')
    expect(parsed.definitions.default).toBe('none')
    expect(parsed.resourceDefault).toBe('none')
  })

  it('drops override values outside the closed vocabulary rather than guessing', () => {
    const parsed = parsePublishedAgentPolicy({
      areas: { default: 'read', overrides: { records: 'full', files: 'ADMIN', billing: 7 } },
    })
    expect(parsed.areas.overrides.records).toBe('full')
    expect(parsed.areas.overrides.files).toBeUndefined()
    expect(parsed.areas.overrides.billing).toBeUndefined()
    // …and a dropped override then reads as the default, so lookups stay total.
    expect(policyAreaLevel(parsed, Area.files)).toBe('read')
  })
})

describe('authorizationOnlyPolicy excludes audit metadata (§8.1)', () => {
  it('keeps authorization content and drops the byline', () => {
    const base: PublishedAgentPermissionPolicy = {
      ...emptyAgentPolicy(),
      areas: { default: 'read', overrides: {} },
    }
    const byMember = { ...base, publishedByUserId: 'u-member', clamp: [] }
    const byAdmin = {
      ...base,
      publishedByUserId: 'u-admin',
      sourceProfileUpdatedAt: '2026-01-01T00:00:00.000Z',
      clamp: [
        { domain: 'area' as const, key: 'records', from: 'full' as const, to: 'read' as const },
      ],
    }

    // Same authority, different publisher + different clamp record ⇒ identical
    // projection, so re-publishing unchanged authority stays a no-op republish.
    expect(authorizationOnlyPolicy(byMember)).toEqual(authorizationOnlyPolicy(byAdmin))

    // A genuine authority change DOES show up.
    const widened = { ...byMember, areas: { default: 'full' as const, overrides: {} } }
    expect(authorizationOnlyPolicy(widened)).not.toEqual(authorizationOnlyPolicy(byMember))
  })
})

describe('resolveDraftAgentPolicy — the draft binding (§1.3)', () => {
  const agentProfile = profile({ id: 'p-agent', slug: 'agent', agentPolicy: uniform('full') })
  const chatProfile = profile({ id: 'p-chat', slug: 'chat_agent', agentPolicy: uniform('none') })
  const base = { organizationId: 'org-1', agentId: 'a-1' }

  it('resolves a null binding by kind: internal → agent, chat → chat_agent (§18)', () => {
    const internal = resolveDraftAgentPolicy({
      ...base,
      kind: 'internal',
      permissionProfileId: null,
      profiles: [agentProfile, chatProfile],
    })
    expect(internal.areas.default).toBe('full')
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
    expect(resolved.areas.overrides[Area.records]).toBe('full')
    expect(resolved.areas.overrides[Area.billing]).toBe('full')
    // …while the default is retained for an area a future deploy adds.
    expect(resolved.areas.default).toBe('full')
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
