// packages/lib/src/agents/__tests__/agent-config-snapshot.test.ts

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
