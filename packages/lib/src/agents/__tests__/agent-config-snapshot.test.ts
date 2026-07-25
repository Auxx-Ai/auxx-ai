// packages/lib/src/agents/__tests__/agent-config-snapshot.test.ts

import type { PublishedAgentPermissionPolicy } from '@auxx/database'
import { emptyAgentPolicy } from '../../permissions/profiles/agent-policy'
import { hashAgentConfig, snapshotAgentConfig } from '../agent-config-snapshot'

/**
 * Pure-logic coverage for the agent behavior snapshot + content hash — the
 * foundation of the no-op-republish check and the eval draft-run identity.
 * Service-level lifecycle tests (publish/restore/discard, dirty flag, reconciler
 * amendment) need a DB harness that does not yet exist in this package; see
 * plans/agents/agent-versions/build-plan.md §9.
 */

describe('snapshotAgentConfig', () => {
  it('picks exactly the six versioned fields with non-null defaults', () => {
    const snap = snapshotAgentConfig({
      prompt: { type: 'doc' },
      toolsets: [{ slug: 'mail', enabled: true }],
      knowledge: null,
      appAccounts: undefined,
      toolRestrictions: { tool: {} },
      modelId: 'anthropic:claude',
    })
    expect(snap).toEqual({
      prompt: { type: 'doc' },
      toolsets: [{ slug: 'mail', enabled: true }],
      knowledge: [],
      appAccounts: {},
      toolRestrictions: { tool: {} },
      modelId: 'anthropic:claude',
    })
  })

  it('ignores non-versioned fields (name/slug/etc.)', () => {
    const snap = snapshotAgentConfig({
      prompt: {},
      // @ts-expect-error — extra fields must not leak into the snapshot
      name: 'Agent A',
      slug: 'agent-a',
    })
    expect(snap).not.toHaveProperty('name')
    expect(snap).not.toHaveProperty('slug')
  })
})

describe('hashAgentConfig', () => {
  it('is stable across jsonb key reordering (the no-op-republish guarantee)', () => {
    const a = hashAgentConfig({
      prompt: { a: 1, b: 2 },
      appAccounts: { gmail: { credId: 'c1' }, slack: { credId: 'c2' } },
      modelId: 'm',
    })
    // Same logical value, keys inserted in a different order (jsonb reorders).
    const b = hashAgentConfig({
      modelId: 'm',
      appAccounts: { slack: { credId: 'c2' }, gmail: { credId: 'c1' } },
      prompt: { b: 2, a: 1 },
    })
    expect(a).toBe(b)
  })

  it('changes when a versioned field changes', () => {
    const base = hashAgentConfig({ prompt: { text: 'hi' }, modelId: 'm' })
    const promptEdit = hashAgentConfig({ prompt: { text: 'bye' }, modelId: 'm' })
    const modelEdit = hashAgentConfig({ prompt: { text: 'hi' }, modelId: 'm2' })
    expect(promptEdit).not.toBe(base)
    expect(modelEdit).not.toBe(base)
  })

  it('treats an empty row and an all-defaults row identically', () => {
    expect(hashAgentConfig({})).toBe(
      hashAgentConfig({
        prompt: {},
        toolsets: [],
        knowledge: [],
        appAccounts: {},
        toolRestrictions: {},
        modelId: null,
      })
    )
  })
})

describe('hashAgentConfig — the permission policy (doc 19 §8.1)', () => {
  const policy = (over: Partial<PublishedAgentPermissionPolicy> = {}) => ({
    ...emptyAgentPolicy(),
    areas: { default: 'read' as const, overrides: {} },
    ...over,
  })

  it('changes when the published AUTHORITY changes', () => {
    const read = hashAgentConfig({ prompt: {}, permissionPolicy: policy() })
    const full = hashAgentConfig({
      prompt: {},
      permissionPolicy: policy({ areas: { default: 'full', overrides: {} } }),
    })
    expect(full).not.toBe(read)
  })

  it('changes when a single definition rule changes — the republish-as-None case', () => {
    const withDeals = hashAgentConfig({
      prompt: {},
      permissionPolicy: policy({ definitions: { default: 'none', overrides: { deals: 'full' } } }),
    })
    const withoutDeals = hashAgentConfig({
      prompt: {},
      permissionPolicy: policy({ definitions: { default: 'none', overrides: { deals: 'none' } } }),
    })
    // If this collided, republishing Deals as `None` would be treated as a no-op
    // and the restriction would never take effect.
    expect(withoutDeals).not.toBe(withDeals)
  })

  it('does NOT change when only the audit metadata differs — no byline-only versions', () => {
    const byMember = hashAgentConfig({
      prompt: {},
      permissionPolicy: policy({ publishedByUserId: 'u-member' }),
    })
    const byAdmin = hashAgentConfig({
      prompt: {},
      permissionPolicy: policy({
        publishedByUserId: 'u-admin',
        sourceProfileId: 'p-other',
        sourceProfileUpdatedAt: '2026-07-24T00:00:00.000Z',
        clamp: [{ domain: 'area', key: 'records', from: 'full', to: 'read' }],
      }),
    })
    expect(byAdmin).toBe(byMember)
  })

  it('is stable across jsonb key reordering inside the policy', () => {
    const a = hashAgentConfig({
      prompt: {},
      permissionPolicy: policy({
        definitions: { default: 'read', overrides: { deals: 'full', contacts: 'none' } },
      }),
    })
    const b = hashAgentConfig({
      prompt: {},
      permissionPolicy: policy({
        definitions: { default: 'read', overrides: { contacts: 'none', deals: 'full' } },
      }),
    })
    expect(a).toBe(b)
  })

  it('distinguishes "no policy" (the draft-eval identity) from any real policy', () => {
    expect(hashAgentConfig({ prompt: {} })).not.toBe(
      hashAgentConfig({ prompt: {}, permissionPolicy: policy() })
    )
  })
})
