// packages/lib/src/evals/snapshots.ts
//
// Canonical snapshot serialization + stable hashing + defensive secret
// stripping. Snapshotting is a SERVICE responsibility: the definition and
// runtime snapshots are built from validated case data before the queued run is
// inserted, then hashed canonically so historical detail never depends on the
// mutable case. See plans/evals/phase-1-agent-simulation.md §1.3 and
// conventions.md §4.

import type { AgentEvalAssertion, AgentEvalTarget, SimulationConfig } from '@auxx/types/evals'
import { stableHash } from '@auxx/utils/hash'
import { canonicalize } from '@auxx/utils/json'

// Canonical serialization + stable hashing now live in @auxx/utils (`./json` +
// `./hash`) — re-exported so the eval surface and existing imports stay stable.
export { canonicalize, stableHash }

/** Persisted definition snapshot — the immutable case copy a run executes against. */
export type AgentDefinitionSnapshotV1 = {
  version: 1
  case: {
    id: string
    name: string
    kind: 'agent_simulation'
    target: AgentEvalTarget
    config: SimulationConfig
    assertions: AgentEvalAssertion[]
  }
  createdAt: string
}

/** Hash of both snapshots together — the run's `snapshotHash`. */
export function hashSnapshots(definition: unknown, runtime: unknown): string {
  return stableHash({ definition, runtime })
}

// Defensive deep secret redaction now lives in @auxx/utils/redact (its defaults
// match the eval needs: secret-shaped keys redacted, reference ids preserved).
// Snapshots are built from a secret-free manifest already; this is
// belt-and-suspenders so a stray decrypted value can never be persisted in a
// snapshot, trace, or assertion note. Re-exported as `stripSecrets` so existing
// imports stay stable.
export { redactSecrets as stripSecrets } from '@auxx/utils/redact'

/** Build the immutable definition snapshot from validated case data. */
export function buildDefinitionSnapshot(input: {
  id: string
  name: string
  target: AgentEvalTarget
  config: SimulationConfig
  assertions: AgentEvalAssertion[]
  createdAt: string
}): AgentDefinitionSnapshotV1 {
  return {
    version: 1,
    case: {
      id: input.id,
      name: input.name,
      kind: 'agent_simulation',
      target: input.target,
      config: input.config,
      assertions: input.assertions,
    },
    createdAt: input.createdAt,
  }
}
