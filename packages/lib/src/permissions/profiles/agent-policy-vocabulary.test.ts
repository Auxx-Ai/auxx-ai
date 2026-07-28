// packages/lib/src/permissions/profiles/agent-policy-vocabulary.test.ts

import type { PublishedAgentPermissionPolicy } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { migrateAgentPolicyVocabulary } from '../../data-migrations/migrations/054-agent-policy-vocabulary'
import { AREA_ORDER, PermissionKey } from '../capabilities/registry'
import baseline from './__snapshots__/agent-policy-vocabulary.baseline.json'
import {
  AgentPolicyCapabilities,
  buildDefIdToApiSlug,
  buildDefIdToEntitySlug,
  type PolicyResourceRef,
} from './agent-policy-capabilities'
import { SYSTEM_PROFILE_SEEDS } from './system-profiles'

/**
 * **The bar for plan 26 Phase 2: composed agent capabilities are byte-identical
 * before and after the vocabulary rename.**
 *
 * `__snapshots__/agent-policy-vocabulary.baseline.json` was captured by running
 * the *pre-rename* `AgentPolicyCapabilities` over eight policies — the two
 * canonical extremes, the four seeded agent system profiles, a hand-built policy
 * exercising every rung in every keyspace (including an orphan definition, an
 * unregistered resource type, and an area whose gate closes an `admin` instance
 * rule), and one that walks the whole `AREA_ORDER` through all four rungs. Each
 * entry stores the policy **in the retired `none/read/read_write/full` spelling**
 * plus the full composed answer: every held `PermissionKey`, every area's `Level`,
 * and the def/instance gates.
 *
 * This test replays that baseline through data migration 054's pure transform and
 * the *post-rename* composer, and demands the composed answer be `toEqual` the
 * recorded one. A rename that shifted any rung — in either direction, in any
 * keyspace — fails here, and it fails naming the scenario.
 *
 * It also pins the migration's own idempotence, which is the other half of the
 * bar: a second pass over already-migrated input must be the identity.
 */

const RESOURCES: PolicyResourceRef[] = [
  { id: 'r-deals', apiSlug: 'deals', entityDefinitionId: 'def-deals' },
  { id: 'r-contacts', apiSlug: 'contacts', entityDefinitionId: 'def-contacts' },
  { id: 'r-companies', apiSlug: 'companies', entityDefinitionId: 'def-companies' },
  { id: 'snippet', apiSlug: 'snippets', entityDefinitionId: 'def-snippet', entityType: 'snippet' },
]

/** Every def form the baseline probed — slug, resource id, CUID, mail-infra, unknown. */
const DEF_FORMS = [
  'deals',
  'r-deals',
  'def-deals',
  'contacts',
  'companies',
  'snippet',
  'never-heard-of-it',
]

const INSTANCES: Array<[string, string]> = [
  ['kb', 'kb-1'],
  ['kb', 'kb-unlisted'],
  ['dataset', 'ds-1'],
  ['dashboard', 'dash-1'],
  ['workflow', 'wf-1'],
]

interface ComposedSnapshot {
  keys: string[]
  areaLevels: Record<string, number>
  defs: Record<string, unknown>
  instances: Record<string, unknown>
}

/** Exactly the projection the baseline capture recorded. Keep the two in step. */
function compose(policy: PublishedAgentPermissionPolicy): ComposedSnapshot {
  const caps = new AgentPolicyCapabilities(
    policy,
    buildDefIdToApiSlug(RESOURCES),
    buildDefIdToEntitySlug(RESOURCES)
  )

  const keys = Object.values(PermissionKey)
    .filter((key) => caps.can(key))
    .sort()

  const areaLevels: Record<string, number> = {}
  for (const area of AREA_ORDER) areaLevels[area] = caps.areaLevel(area)

  const defs: Record<string, unknown> = {}
  for (const form of DEF_FORMS) {
    defs[form] = {
      view: caps.canViewEntity(form),
      edit: caps.canEditEntity(form),
      admin: caps.canAdministerDef(form),
      write: caps.canWriteEntity(form),
      viewAccess: caps.viewAccessFor(form) ?? null,
    }
  }

  const instances: Record<string, unknown> = {}
  for (const [key, id] of INSTANCES) {
    const typed = key as 'kb' | 'dataset' | 'dashboard' | 'workflow'
    instances[`${key}:${id}`] = {
      view: caps.canViewInstance(typed, id),
      edit: caps.canEditInstance(typed, id),
      admin: caps.canAdminInstance(typed, id),
    }
  }

  return { keys, areaLevels, defs, instances }
}

const SCENARIOS = baseline as unknown as Record<
  string,
  { policy: PublishedAgentPermissionPolicy; composed: ComposedSnapshot }
>

describe('the vocabulary rename changes no authority (plan 26 §2.6 / §4)', () => {
  it.each(Object.keys(SCENARIOS))('composes %s identically to the pre-rename baseline', (name) => {
    const scenario = SCENARIOS[name]
    if (!scenario) throw new Error(`missing baseline scenario ${name}`)
    const migrated = migrateAgentPolicyVocabulary(scenario.policy)
    expect(compose(migrated)).toEqual(scenario.composed)
  })

  it('covers every scenario the baseline recorded — a silently emptied fixture must fail', () => {
    expect(Object.keys(SCENARIOS).length).toBe(8)
  })

  it('reaches a non-trivial capability surface, so equality is not vacuously true', () => {
    const legacy = SCENARIOS.legacyFull
    const empty = SCENARIOS.empty
    if (!legacy || !empty) throw new Error('missing baseline scenario')
    expect(legacy.composed.keys.length).toBeGreaterThan(20)
    expect(empty.composed.keys).toEqual([])
  })
})

describe('data migration 054 is idempotent', () => {
  it('is the identity on already-migrated input, in every scenario', () => {
    for (const [name, scenario] of Object.entries(SCENARIOS)) {
      const once = migrateAgentPolicyVocabulary(scenario.policy)
      const twice = migrateAgentPolicyVocabulary(once)
      expect(twice, name).toEqual(once)
    }
  })

  it('leaves an unrecognized rung alone rather than guessing at it', () => {
    const migrated = migrateAgentPolicyVocabulary({
      areas: { default: 'ADMIN', overrides: { records: 'nonsense' } },
      definitions: { default: 'read', overrides: {} },
      resourceDefault: 'full',
      resources: {},
    })
    expect(migrated).toEqual({
      areas: { default: 'ADMIN', overrides: { records: 'nonsense' } },
      definitions: { default: 'view', overrides: {} },
      resourceDefault: 'admin',
      resources: {},
    })
  })

  it('rewrites the clamp trail, which is rendered but excluded from configHash', () => {
    const migrated = migrateAgentPolicyVocabulary({
      clamp: [{ domain: 'area', key: 'records', from: 'full', to: 'read' }],
    })
    expect(migrated).toEqual({
      clamp: [{ domain: 'area', key: 'records', from: 'admin', to: 'view' }],
    })
  })
})

describe('the seeded agent profiles ship in the new vocabulary', () => {
  it('stores no retired rung anywhere in SYSTEM_PROFILE_SEEDS', () => {
    const policies = SYSTEM_PROFILE_SEEDS.map((seed) => seed.agentPolicy).filter(Boolean)
    expect(policies.length).toBeGreaterThan(0)
    const serialized = JSON.stringify(policies)
    for (const retired of ['"read"', '"read_write"', '"full"']) {
      expect(serialized).not.toContain(retired)
    }
  })

  it('composes each seed exactly as the pre-rename baseline did', () => {
    for (const seed of SYSTEM_PROFILE_SEEDS) {
      if (!seed.agentPolicy) continue
      const recorded = SCENARIOS[`seed:${seed.slug}`]
      if (!recorded) throw new Error(`no baseline for seed:${seed.slug}`)
      const published: PublishedAgentPermissionPolicy = {
        sourceProfileId: null,
        sourceProfileUpdatedAt: null,
        publishedByUserId: null,
        clamp: [],
        ...seed.agentPolicy,
      }
      expect(compose(published), seed.slug).toEqual(recorded.composed)
    }
  })
})
