// packages/lib/src/permissions/profiles/agent-policy-vocabulary.test.ts

import type { PublishedAgentPermissionPolicy } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { migrateAgentPolicyVocabulary } from '../../data-migrations/migrations/054-agent-policy-vocabulary'
import { dropResourceDefault } from '../../data-migrations/migrations/055-agent-policy-resource-area-fallthrough'
import { AREA_ORDER, Area, PERMISSION_AREAS, PermissionKey } from '../capabilities/registry'
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
 *
 * **AMENDED 2026-07-28 — the fixture is no longer a pristine pre-rename
 * capture.** The agents instance-access slice (plan 25 §4.2) split `Area.agents`
 * from one `Full → agents.manage` rung into Read/Edit/Full, so every scenario
 * composing a non-`None` agents level now expands to more keys than the capture
 * recorded. The whole delta was `+4 × agents.view` and `+3 × agents.edit`
 * across five scenarios — nothing removed, no `areaLevels` entry moved — and the
 * fixture was amended by exactly that rule (`level ≥ 1 ⇒ view`, `≥ 2 ⇒ edit`).
 * {@link agentsRungsAreTheOnlyAmendment} re-derives it from `areaLevels` so the
 * amendment stays checkable instead of resting on this comment.
 *
 * Note the shape of that change: the `mixed` scenario composed `agents` at
 * `Level.Read` with ZERO keys, because the 1-rung ladder had nothing to expand
 * at Read. That rung was inert; now it confers `agents.view`. #1345's workflows
 * split had the same effect and it was accepted then for the same reason — the
 * rung meaning something is the point of adding it.
 *
 * **AMENDED AGAIN 2026-07-28 — plan 36 (signatures + snippets).** Two effects,
 * both amended under the same "derive it, don't regenerate it" rule:
 *   1. `Area.signatures` / `Area.snippets` are new, so every scenario gained two
 *      `areaLevels` entries plus the keys those levels imply. No scenario names
 *      either area, so both fall through to `areas.default` and the delta is
 *      fully derived — re-checked by the signatures/snippets sibling of
 *      {@link agentsRungsAreTheOnlyAmendment} below.
 *   2. `snippet` LEFT `NON_RECORD_DEF_SLUGS` (§7.6), so `defs.snippet` stopped
 *      being the mail-infra bypass's unconditional `view: true / viewAccess:
 *      null` and now resolves through the definitions keyspace. That one is a
 *      real authority change, not a rename — it is pinned explicitly rather than
 *      derived, because it is exactly the hole the slice set out to close.
 * Every other def, every instance, and every pre-existing `areaLevels` entry is
 * byte-identical; the amendment script refused to write otherwise.
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

/**
 * The stored-blob migration chain, in deploy order: 054 renames the rungs, 055
 * retires `resourceDefault` in favour of the per-type area fall-through. A blob
 * captured before either one experiences both, so the baseline must be replayed
 * through both — and demanding the composed answer still match is what pins BOTH
 * migrations as authority-preserving, not just the rename.
 *
 * 055 is where the `mixed` scenario earns its keep: it holds
 * `resourceDefault: read_write` under `workflows: full` and names no `workflow`
 * rule, so the retired field was genuinely load-bearing there (`min(edit, admin)`
 * = edit). Dropping it without materializing would hand that agent `admin` on
 * every workflow. The migration writes `workflow: { default: 'edit' }` and the
 * composed answer is unchanged — which is exactly the line this test holds.
 */
function migrateStoredPolicy(policy: PublishedAgentPermissionPolicy) {
  return dropResourceDefault(migrateAgentPolicyVocabulary(policy))
}

describe('the vocabulary rename changes no authority (plan 26 §2.6 / §4)', () => {
  it.each(Object.keys(SCENARIOS))('composes %s identically to the pre-rename baseline', (name) => {
    const scenario = SCENARIOS[name]
    if (!scenario) throw new Error(`missing baseline scenario ${name}`)
    expect(compose(migrateStoredPolicy(scenario.policy))).toEqual(scenario.composed)
  })

  it('needs 055 to hold that line — the rename alone would widen `mixed`', () => {
    const scenario = SCENARIOS.mixed
    if (!scenario) throw new Error('missing baseline scenario mixed')
    // Renamed but NOT de-`resourceDefault`ed: the field is now ignored on read, so
    // `workflow` falls straight through to its `full` area. A guard against this
    // test being "fixed" one day by dropping the 055 step from the chain.
    const renamedOnly = compose(migrateAgentPolicyVocabulary(scenario.policy))
    expect(renamedOnly).not.toEqual(scenario.composed)
    expect(renamedOnly.instances['workflow:wf-1']).toEqual({
      view: true,
      edit: true,
      admin: true,
    })
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

  /**
   * The 2026-07-28 amendment, re-derived rather than asserted in prose.
   *
   * The fixture was hand-edited when `Area.agents` gained its Read/Edit rungs,
   * which is exactly the kind of edit that can quietly launder a real
   * regression into a "baseline update". Every recorded agents key must follow
   * from that scenario's recorded agents `areaLevel` and nothing else — so an
   * amendment that added a key the ladder does not imply, or dropped one it
   * does, fails here naming the scenario.
   */
  it('carries exactly the agents keys its recorded area level implies (agentsRungsAreTheOnlyAmendment)', () => {
    for (const [name, scenario] of Object.entries(SCENARIOS)) {
      const level = scenario.composed.areaLevels.agents ?? 0
      const expected = [
        ...(level >= 1 ? [PermissionKey.agentsView] : []),
        ...(level >= 2 ? [PermissionKey.agentsEdit] : []),
        ...(level >= 3 ? [PermissionKey.agentsManage] : []),
      ]
      const actual = scenario.composed.keys.filter((key) => key.startsWith('agents.')).sort()
      expect(actual, name).toEqual([...expected].sort())
    }
  })

  /**
   * The 2026-07-28 plan 36 amendment, held to the same standard.
   *
   * `Area.signatures` and `Area.snippets` did not exist when the fixture was
   * captured, so every scenario gained two `areaLevels` entries and whatever
   * keys those levels imply — no scenario NAMES either area, so both fall
   * through to the policy's `areas.default` and the amendment is fully derived.
   * Re-deriving it here is what stops a future "just regenerate the fixture"
   * from laundering a real shift into this file.
   */
  it('carries exactly the signatures/snippets keys their recorded area levels imply', () => {
    // Re-derived from `PERMISSION_AREAS` rather than a hardcoded three-rung list
    // (changed by plan 43 §3.1, which dropped the `Level.Edit` rung from both
    // areas). The old `rungs.slice(0, level)` shape was exactly the trap the
    // `inboxes` sibling below was written to warn about — it invents a rung the
    // ladder does not have — and it went from a latent hazard to a live failure
    // the moment these two ladders became partial. Deriving means the next rung
    // change needs no edit here at all.
    for (const area of [Area.signatures, Area.snippets] as const) {
      const rungs = PERMISSION_AREAS[area].rungs
      for (const [name, scenario] of Object.entries(SCENARIOS)) {
        const level = scenario.composed.areaLevels[area] ?? 0
        const expected = rungs.filter((rung) => level >= rung.level).flatMap((rung) => rung.keys)
        const actual = scenario.composed.keys.filter((key) => key.startsWith(`${area}.`)).sort()
        expect(actual, `${name}/${area}`).toEqual([...expected].sort())
      }
    }
  })

  /**
   * The 2026-07-29 plan 40 amendment, held to the same standard as the two
   * above — and it is the case where the derivation matters most, because
   * `Area.inboxes` is the first PARTIAL ladder to be added this way.
   *
   * The area did not exist when the fixture was captured, and no scenario names
   * it, so every scenario gained one `areaLevels` entry equal to its policy's
   * `areas.default` plus whatever keys that level implies. But the ladder has
   * only Read and Full rungs — there is no `Edit` — so a recorded level of 2
   * implies `inboxes.view` and NOTHING ELSE. A naive `rungs.slice(0, level)`
   * amendment would have invented an `inboxes.edit` that does not exist, which
   * is precisely what this re-derivation catches.
   */
  it('carries exactly the inboxes keys its recorded area level implies', () => {
    for (const [name, scenario] of Object.entries(SCENARIOS)) {
      const level = scenario.composed.areaLevels.inboxes ?? 0
      const expected = [
        // Level.Read (1) and above → the view rung. Level.Edit (2) adds nothing:
        // the ladder skips it.
        ...(level >= 1 ? [PermissionKey.inboxesView] : []),
        ...(level >= 3 ? [PermissionKey.inboxesManage] : []),
      ]
      const actual = scenario.composed.keys.filter((key) => key.startsWith('inboxes.')).sort()
      expect(actual, name).toEqual([...expected].sort())
    }
  })

  /**
   * The other half of the plan 36 amendment, which is NOT derivable from a rung
   * ladder: `snippet` left `NON_RECORD_DEF_SLUGS` (§7.6), so the recorded
   * `defs.snippet` answers stopped coming from the mail-infra bypass — which
   * returned `view: true` and `viewAccess: null` unconditionally — and started
   * resolving through the agent policy's DEFINITIONS keyspace like any other def.
   *
   * The tell that the bypass is gone: a `definitions: none` policy must now be
   * able to deny it. Two recorded scenarios do exactly that, and this pins them
   * so a re-add of `snippet` to the set fails here instead of silently restoring
   * an org-wide read.
   */
  it('resolves snippet through the definitions keyspace, not the mail-infra bypass', () => {
    const denied = ['empty', 'seed:chat_agent'] as const
    for (const name of denied) {
      const scenario = SCENARIOS[name]
      if (!scenario) throw new Error(`missing baseline scenario ${name}`)
      expect((scenario.composed.defs.snippet as { view: boolean }).view, name).toBe(false)
    }
    // …and a scenario that DOES grant definitions still reaches it, so the
    // assertion above is a real gate rather than a blanket denial.
    const legacyFull = SCENARIOS.legacyFull
    if (!legacyFull) throw new Error('missing baseline scenario legacyFull')
    expect(legacyFull.composed.defs.snippet).toEqual({
      view: true,
      edit: true,
      admin: true,
      write: true,
      viewAccess: 'admin',
    })
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

  it('leaves 055 a clean hand-off — the two migrations touch disjoint fields', () => {
    for (const [name, scenario] of Object.entries(SCENARIOS)) {
      const renamed = migrateAgentPolicyVocabulary(scenario.policy)
      // 055 never re-spells a rung, so running it cannot undo 054.
      expect(JSON.stringify(dropResourceDefault(renamed)), name).not.toContain('"read_write"')
    }
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

describe('data migration 055 retires resourceDefault without moving authority', () => {
  it('is the identity on already-migrated input, in every scenario', () => {
    for (const [name, scenario] of Object.entries(SCENARIOS)) {
      const once = migrateStoredPolicy(scenario.policy)
      expect(dropResourceDefault(once), name).toEqual(once)
    }
  })

  it('drops the field entirely, in every scenario', () => {
    for (const [name, scenario] of Object.entries(SCENARIOS)) {
      expect(migrateStoredPolicy(scenario.policy), name).not.toHaveProperty('resourceDefault')
    }
  })

  it('materializes only where the field was load-bearing, and at the old rung', () => {
    const migrated = dropResourceDefault({
      areas: { default: 'view', overrides: { workflows: 'admin', dashboards: 'none' } },
      definitions: { default: 'none', overrides: {} },
      resourceDefault: 'edit',
      resources: { kb: { default: 'admin', overrides: {} } },
    })
    expect(migrated).toEqual({
      areas: { default: 'view', overrides: { workflows: 'admin', dashboards: 'none' } },
      definitions: { default: 'none', overrides: {} },
      resources: {
        // Already had a rule of its own — untouched.
        kb: { default: 'admin', overrides: {} },
        // `edit` sat BELOW `workflows: admin`, so it was doing work. Pinned.
        workflow: { default: 'edit', overrides: {} },
        // `edit` sat at or ABOVE these areas, so `min` picked the area either
        // way and the fall-through now reproduces it with no entry at all.
        // dataset (areas.default view), dashboard (none), agent (view): absent.
      },
    })
  })

  it('is a no-op on a blob that never carried the field', () => {
    const already = { areas: { default: 'view', overrides: {} }, resources: {} }
    expect(dropResourceDefault(already)).toBe(already)
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
