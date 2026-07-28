// apps/web/src/components/permissions/hooks/use-agent-policy.test.ts

import type { AgentPermissionPolicy } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import {
  countChanges,
  normalizeAgentPolicy,
  resourceTypeAreaLevel,
  stableKey,
} from './use-agent-policy'

/**
 * Plan 29 §5 verification #1 — the tree unification is a RENDERING change, so a
 * policy authored on the old three-section screen must re-render on the unified
 * area tree and save byte-identical.
 *
 * The editor holds no policy state of its own (it destructures everything from
 * `useAgentPolicy`), so "the new screen perturbs nothing" reduces to: the same
 * stored value normalizes to the same draft, and an untouched draft reports zero
 * changes. Both are asserted here on the exported seams rather than through a
 * render, because the assertion is about the DATA and a render would only add
 * provider mocking between the test and the thing under test.
 */

/**
 * A policy exercising all four keyspaces, both orphan families included.
 *
 * It still carries `resourceDefault` on purpose: data migration 055 retired the
 * field, and an un-migrated row (or an old client's payload) must normalize
 * without it rather than round-tripping a value the model no longer reads.
 */
const STORED = {
  areas: { default: 'view', overrides: { records: 'admin', auditLog: 'none' } },
  definitions: { default: 'none', overrides: { companies: 'view', gone_away: 'admin' } },
  resourceDefault: 'none',
  resources: {
    kb: { default: 'view', overrides: { kb_1: 'admin', kb_missing: 'none' } },
    dataset: { default: 'none', overrides: {} },
  },
} as unknown as AgentPermissionPolicy

describe('agent policy round-trip (plan 29 §5)', () => {
  it('normalizes to a stable key and reports no changes when nothing is edited', () => {
    const saved = normalizeAgentPolicy(STORED)
    const reRendered = normalizeAgentPolicy(STORED)

    expect(stableKey(reRendered)).toBe(stableKey(saved))
    expect(countChanges(saved, reRendered)).toBe(0)
  })

  it('ignores jsonb key reordering, which postgres is free to do', () => {
    const reordered = {
      resources: {
        dataset: { overrides: {}, default: 'none' },
        kb: { overrides: { kb_missing: 'none', kb_1: 'admin' }, default: 'view' },
      },
      resourceDefault: 'none',
      definitions: { overrides: { gone_away: 'admin', companies: 'view' }, default: 'none' },
      areas: { overrides: { auditLog: 'none', records: 'admin' }, default: 'view' },
    } as unknown as AgentPermissionPolicy

    expect(stableKey(normalizeAgentPolicy(reordered))).toBe(stableKey(normalizeAgentPolicy(STORED)))
  })

  it('fails closed for a profile that has never carried a policy', () => {
    const empty = normalizeAgentPolicy(null)

    expect(empty.areas.default).toBe('none')
    expect(empty.definitions.default).toBe('none')
    expect(empty.resources).toEqual({})
    // No resource keyspace of its own — every type reads through the area map,
    // which is all-`none` here.
    expect(resourceTypeAreaLevel(empty, 'kb')).toBe('none')
  })

  it('falls a resource type with no rule through to its own area, not a sibling', () => {
    const policy = normalizeAgentPolicy({
      areas: { default: 'none', overrides: { datasets: 'edit', knowledgeBase: 'view' } },
      definitions: { default: 'none', overrides: {} },
      resources: {},
    } as unknown as AgentPermissionPolicy)

    expect(resourceTypeAreaLevel(policy, 'dataset')).toBe('edit')
    expect(resourceTypeAreaLevel(policy, 'kb')).toBe('view')
    // Not in the area map → `areas.default`.
    expect(resourceTypeAreaLevel(policy, 'dashboard')).toBe('none')
    // Not a registered resource type at all → fail closed.
    expect(resourceTypeAreaLevel(policy, 'retired_kind')).toBe('none')
  })

  it('counts a cleared resource type as its default PLUS every per-item rule it drops', () => {
    const saved = normalizeAgentPolicy(STORED)
    const { kb: _dropped, ...rest } = saved.resources
    const cleared = { ...saved, resources: rest }

    // `clearResourceType('kb')` — the type default and its two per-item rules.
    // This count is exactly why the "All knowledge bases" row confirms first.
    expect(countChanges(saved, cleared)).toBe(3)
  })
})
