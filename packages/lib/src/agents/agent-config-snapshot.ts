// packages/lib/src/agents/agent-config-snapshot.ts

import { stableHash } from '@auxx/utils/hash'

/**
 * The six versioned behavior fields of an agent — the exact scope an
 * {@link AgentVersion} snapshots (see plans/agents/agent-versions/build-plan.md
 * §"Version scope"). Identity, lifecycle, procedure links, and triggers are
 * deliberately excluded.
 *
 * Kept in its own module so both the version service and the mention reconciler
 * compute `configHash` from one definition (the reconciler amends the active
 * version's derived rows in place and must recompute the same hash) without an
 * import cycle.
 */
export interface AgentConfigSnapshot {
  prompt: Record<string, unknown>
  toolsets: unknown[]
  knowledge: unknown[]
  appAccounts: Record<string, unknown>
  toolRestrictions: Record<string, unknown>
  modelId: string | null
}

/** Row shape this reads from — both the `Agent` draft row and an `AgentVersion`. */
interface AgentConfigSource {
  prompt?: Record<string, unknown> | null
  toolsets?: unknown[] | null
  knowledge?: unknown[] | null
  appAccounts?: Record<string, unknown> | null
  toolRestrictions?: Record<string, unknown> | null
  modelId?: string | null
}

/** Pick the six versioned fields off a row, normalized to non-null defaults. */
export function snapshotAgentConfig(row: AgentConfigSource): AgentConfigSnapshot {
  return {
    prompt: row.prompt ?? {},
    toolsets: row.toolsets ?? [],
    knowledge: row.knowledge ?? [],
    appAccounts: row.appAccounts ?? {},
    toolRestrictions: row.toolRestrictions ?? {},
    modelId: row.modelId ?? null,
  }
}

/**
 * sha256 (hex) of the stable-stringified snapshot — drives the no-op-republish
 * check and the draft-run eval identity. Stable-key serialization (not
 * `JSON.stringify`) so a `jsonb` round-trip that reorders keys still hashes
 * identically. See [[project_jsonb_hash_sorted_keys]].
 */
export function hashAgentConfig(row: AgentConfigSource): string {
  return stableHash(snapshotAgentConfig(row))
}
