// packages/lib/src/resources/crud/write-origin.ts

// Phase 3 of plans/events/03-write-context-and-batch-lane-plan.md (§4):
// writers declare what a write IS — never what to skip. The origin binds to a
// WriteSession at handler construction and flows through the mutation layer,
// replacing the `skipEvents` boolean over time.

import type { ManifestCollector } from '../../record-rules/sync-manifest-collector'

/**
 * What a write IS, declared by the writer (plan 03 §4). One of five kinds:
 *
 * - `interactive` — a human in the product. Default when a handler is built
 *   with a real userId + request path.
 * - `api` — public API / SDK. Behaves like interactive; actor is the token owner.
 * - `automation` — server-side automation: workflows, rules, agents, hooks,
 *   steady-state ingest. Fires per-record; actor is a SYSTEM actor user id,
 *   `cause` names what started it.
 * - `sync` — connector / import / mail-backfill / retro jobs. NOTE: there is
 *   deliberately no `phase` field — the small-run vs batch lane is decided at
 *   finalize from the OBSERVED changed-set count (D-12), never declared by the
 *   writer. `collector` is the B2 manifest contract as a type.
 * - `seed` — seeders and data migrations. Silent forever (the documented
 *   exemption).
 */
export type WriteOrigin =
  /** A human in the product. Default when a handler is built with a real userId + request path. */
  | { kind: 'interactive'; userId: string; socketId?: string }
  /** Public API / SDK. Behaves like interactive; actor is the token owner. */
  | { kind: 'api'; userId: string; tokenRef?: string }
  /**
   * Server-side automation: workflows, rules, agents, hooks, steady-state
   * ingest. `actor` is a system actor user id; `cause` names what started it.
   */
  | { kind: 'automation'; actor: string; cause?: { type: string; id: string } }
  /**
   * Connector / import / mail-backfill / retro jobs. Deliberately carries no
   * `phase` field — lane selection is count-based at finalize (D-12).
   */
  | {
      kind: 'sync'
      source: 'connector' | 'import' | 'mail' | 'retro'
      /** runId | importJobId — the collector's identity. */
      ref: string
      /** REQUIRED: the B2 manifest contract as a type. */
      collector: ManifestCollector
    }
  /** Seed / reshape. Silent forever. */
  | { kind: 'seed'; reason: string }

/**
 * The origin plus cascade state, bound at handler construction (plan 03 §4b
 * S1) and inherited by nested handlers via AsyncLocalStorage (see
 * `write-session-als.ts`).
 *
 * `depth` will absorb the record-rules `ruleChain` ALS's depth/seen cascade
 * guard over time (S9), so there is one cascade guard, not two. For this
 * slice it is carried but not yet enforced.
 */
export interface WriteSession {
  origin: WriteOrigin
  depth: number
}

/** Build an interactive session — the default for a handler constructed with a userId. */
export function interactiveSession(userId: string, socketId?: string): WriteSession {
  return { origin: { kind: 'interactive', userId, socketId }, depth: 0 }
}

/** Build a seed session — silent forever (the documented exemption). */
export function seedSession(reason: string): WriteSession {
  return { origin: { kind: 'seed', reason }, depth: 0 }
}

/**
 * The execution lane a session's writes take TODAY.
 *
 * - `'inline'` — per-record fan-out as it happens (bus event, realtime,
 *   timeline, field-change hooks): interactive, api, automation.
 * - `'silent'` — no per-write fan-out: sync, seed. This matches the current
 *   `skipEvents: true` semantics exactly — sync writers still feed the B2
 *   manifest collector, seed stays silent forever.
 *
 * The batched replay lane (accumulate against the run ref, finalize pipeline,
 * count-based small-run vs batch selection per D-12) arrives in Phase 4; until
 * then `sync` maps to `'silent'` so behavior is preserved.
 */
export function sessionLane(session: WriteSession): 'inline' | 'silent' {
  switch (session.origin.kind) {
    case 'interactive':
    case 'api':
    case 'automation':
      return 'inline'
    case 'sync':
    case 'seed':
      return 'silent'
  }
}
