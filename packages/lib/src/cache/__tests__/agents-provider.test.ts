// packages/lib/src/cache/__tests__/agents-provider.test.ts

import { describe, expect, it } from 'vitest'
import { agentsProvider } from '../providers/agents-provider'

/**
 * Coverage for the Phase 7 §4 procedure projection. The load-bearing fix — that
 * criteria DEFAULTS are selected from the active `ProcedureVersion` snapshot, not
 * the mutable `Procedure` draft row (so an unpublished draft edit can't leak into
 * a runtime candidate) — lives in the `db.select(...)` column map in
 * `agents-provider.ts`. That column SOURCE can't be asserted under vitest because
 * `@auxx/database` resolves to a type-stripped artifact whose drizzle columns are
 * not runtime-introspectable; it's guarded by the schema invariant doc-comment on
 * `ProcedureVersion` + code review.
 *
 * What we CAN drive here: feed `compute` canned join rows (the shape the corrected
 * query returns) via a fake query builder and assert the `override ?? default`
 * resolution wires the version snapshot through to the cached candidate.
 */

interface FakeRows {
  agents: unknown[]
  triggers: unknown[]
  procedures: unknown[]
}

function makeFakeDb(rows: FakeRows) {
  const chainFor = (resolved: unknown[]) => {
    const promise = Promise.resolve(resolved)
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') return promise.then.bind(promise)
          if (prop === 'catch') return promise.catch.bind(promise)
          if (prop === 'finally') return promise.finally.bind(promise)
          return () => proxy // from / leftJoin / innerJoin / where / orderBy → keep chaining
        },
      }
    )
    return proxy
  }

  return {
    select(columns: Record<string, unknown>) {
      if ('whenToUseDefault' in columns) return chainFor(rows.procedures)
      if ('slug' in columns) return chainFor(rows.agents)
      return chainFor(rows.triggers)
    },
  }
}

const agentRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'agent-1',
  userId: null,
  createdById: 'user-1',
  slug: 'triage',
  description: null,
  kind: 'internal',
  prompt: {},
  toolsets: [],
  knowledge: [],
  appAccounts: {},
  toolRestrictions: {},
  modelId: null,
  mentionable: true,
  setupCompletedAt: null,
  archivedAt: null,
  config: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
  userName: 'Triage',
  userAvatarAssetId: null,
  ...overrides,
})

const procRow = (overrides: Record<string, unknown> = {}) => ({
  linkId: 'link-1',
  agentId: 'agent-1',
  procedureId: 'proc-1',
  enabled: true,
  priority: 0,
  whenToUseDefault: 'published criteria',
  whenToUseOverride: null,
  examplesDefault: [],
  examplesOverride: null,
  rulesetDefault: [],
  rulesetOverride: null,
  activeVersionId: 'ver-1',
  compiled: {},
  ...overrides,
})

describe('agentsProvider procedure projection', () => {
  it('carries the active version snapshot when no link override is set', async () => {
    const db = makeFakeDb({ agents: [agentRow()], triggers: [], procedures: [procRow()] })
    const agents = await agentsProvider.compute('org-1', db as never)
    expect(agents[0]!.procedures).toHaveLength(1)
    // The cached candidate carries the published snapshot — a later draft edit
    // (which changes only `Procedure.whenToUse`) cannot affect this.
    expect(agents[0]!.procedures[0]!.whenToUse).toBe('published criteria')
  })

  it('prefers a per-agent link override over the version default', async () => {
    const db = makeFakeDb({
      agents: [agentRow()],
      triggers: [],
      procedures: [procRow({ whenToUseOverride: 'agent-specific override' })],
    })
    const agents = await agentsProvider.compute('org-1', db as never)
    expect(agents[0]!.procedures[0]!.whenToUse).toBe('agent-specific override')
  })
})
