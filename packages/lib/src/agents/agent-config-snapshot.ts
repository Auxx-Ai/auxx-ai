// packages/lib/src/agents/agent-config-snapshot.ts

import type { PublishedAgentPermissionPolicy } from '@auxx/database'
import { stableHash } from '@auxx/utils/hash'
import { authorizationOnlyPolicy } from '../permissions/profiles/agent-policy'

/**
 * The versioned scope of an agent — the exact set an {@link AgentVersion}
 * snapshots (see plans/agents/agent-versions/build-plan.md §"Version scope" and
 * plans/permissions/v2/19-permission-profiles.md §2.3): the six behavior fields
 * plus the resolved permission policy. Identity, lifecycle, the draft
 * `Agent.permissionProfileId` binding, procedure links, and triggers are
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

/**
 * Row shape this reads from — both the `Agent` draft row and an `AgentVersion`.
 * `permissionPolicy` exists only on an `AgentVersion` (the draft row carries a
 * profile *binding*, not a resolved policy), so it is optional here and supplied
 * explicitly at publish from the freshly resolved + clamped snapshot.
 */
interface AgentConfigSource {
  prompt?: Record<string, unknown> | null
  toolsets?: unknown[] | null
  knowledge?: unknown[] | null
  appAccounts?: Record<string, unknown> | null
  toolRestrictions?: Record<string, unknown> | null
  modelId?: string | null
  permissionPolicy?: PublishedAgentPermissionPolicy | null
}

/** Pick the six versioned behavior fields off a row, normalized to non-null defaults. */
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
 * sha256 (hex) of the stable-stringified behavior snapshot **plus the
 * authorization-only projection of the permission policy** — drives the
 * no-op-republish check and the draft-run eval identity.
 *
 * Stable-key serialization (not `JSON.stringify`) so a `jsonb` round-trip that
 * reorders keys still hashes identically. See [[project_jsonb_hash_sorted_keys]].
 *
 * **Only the authorization content of the policy is hashed** (areas / definitions
 * / resource rules), never its audit metadata. Two properties follow, and both are
 * intended:
 *
 * - Re-publishing byte-identical authority under a different editor stays a
 *   **no-op**, instead of minting a version that differs only by byline.
 * - A genuine change in resolved authority — including the publish-time author
 *   clamp biting harder because the publisher was demoted (plan 19 §2.4a) — always
 *   alters that content, so it **does** mint a new version. That is what makes
 *   "republish re-clamps" observable rather than silent.
 *
 * `permissionPolicy` is hashed as `null` when absent, which is only the case for
 * the draft-eval identity hash (the draft row has a binding, not a policy).
 */
export function hashAgentConfig(row: AgentConfigSource): string {
  return stableHash({
    ...snapshotAgentConfig(row),
    permissionPolicy: row.permissionPolicy ? authorizationOnlyPolicy(row.permissionPolicy) : null,
  })
}
