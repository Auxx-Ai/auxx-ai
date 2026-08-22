// packages/lib/src/resources/crud/write-origin.ts

// Phase 3 of plans/events/03-write-context-and-batch-lane-plan.md (§4):
// writers declare what a write IS — never what to skip. The origin binds to a
// WriteSession at handler construction and flows through the mutation layer,
// replacing the `skipEvents` boolean over time.

import type { ManifestCollector } from '../../record-rules/sync-manifest-collector'
import type { TxWriteScope } from './tx-write-scope'

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
/**
 * HOW a write's doors behave, orthogonal to {@link WriteOrigin} (which says what
 * the write IS). Plan 04 §6.2 — every suppression names its announcer, so the
 * door-conformance harness can check that announcer exists.
 */
export type WriteMode =
  /** Default. Doors fire inline, per record, as the write happens. */
  | { kind: 'fanout' }
  /** C1/C2 (plan 04 §3). Doors are captured into `scope` and replayed after the tx commits. */
  | { kind: 'buffered'; scope: TxWriteScope }
  /** C3. Doors stay shut at the leaf; `by` names the aggregator that announces. */
  | { kind: 'absorbed'; by: string }
  /** C4/C5. Doors stay shut on purpose; `reason` is the decision, in prose. */
  | { kind: 'quiet'; reason: string }

export interface WriteSession {
  origin: WriteOrigin
  depth: number
  /** Defaults to `{ kind: 'fanout' }` when absent. */
  mode?: WriteMode
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
 * - `'buffered'` — the write is inside a transaction that has not committed, so
 *   its doors are captured into the session's {@link TxWriteScope} and replayed
 *   once afterwards (plan 04 §6). Differs from `'silent'` only in that a live
 *   collector keeps what `'silent'` throws away.
 *
 * The batched replay lane (accumulate against the run ref, finalize pipeline,
 * count-based small-run vs batch selection per D-12) arrives in Phase 4; until
 * then `sync` maps to `'silent'` so behavior is preserved.
 *
 * `derivePublishEvents` (`unified-handler-mutations.ts`) is the only production
 * reader — no call site outside that seam needs to know which lane it is on.
 */
export function sessionLane(session: WriteSession): 'inline' | 'silent' | 'buffered' {
  // The mode is orthogonal to the origin: a buffered interactive write and a
  // buffered automation write are both buffered. `absorbed`/`quiet` resolve to
  // the same `publishEvents === false` the leaves produce today; they carry the
  // reason, not new behavior.
  switch (session.mode?.kind) {
    case 'buffered':
      return 'buffered'
    case 'absorbed':
    case 'quiet':
      return 'silent'
    default:
      break
  }
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

/**
 * True when a session DECLARES its silence — `quiet` (C4/C5) or `absorbed`
 * (C3), the two modes of plan 04 §3 that exist to carry a reason rather than
 * new behavior.
 *
 * This is deliberately narrower than `sessionLane(...) === 'silent'`: a sync or
 * seed ORIGIN is also silent, but it has never gated the field-value layer and
 * turning that on here would be a behavior change across every sync write. The
 * two declared modes are new in plan 04, so nothing sets them yet and honoring
 * them is inert until a leaf opts in (plan 04 Phase B).
 */
export function isDeclaredSilent(session?: WriteSession): boolean {
  const kind = session?.mode?.kind
  return kind === 'quiet' || kind === 'absorbed'
}

/**
 * Declare a write QUIET (plan 04 §3 C4/C5): its doors stay shut on purpose and
 * `reason` is the decision, in prose, at the site that made it.
 *
 * Replaces a bare `publishEvents: false` plus a comment. Same lane, same
 * suppression — the difference is that the intent is typed, greppable, and
 * checkable by the door-conformance harness instead of living in a comment
 * nobody can enforce.
 *
 * @param reason Why this write is deliberately silent. Required, non-empty.
 * @param base The session to inherit origin and depth from, when there is one.
 */
export function quietSession(reason: string, base?: WriteSession): WriteSession {
  if (!reason.trim()) throw new Error('quietSession requires a non-empty reason')
  return {
    origin: base?.origin ?? { kind: 'automation', actor: 'system' },
    depth: base?.depth ?? 0,
    mode: { kind: 'quiet', reason },
  }
}

/**
 * Declare a write ABSORBED (plan 04 §3 C3): its doors stay shut at the leaf
 * because an aggregator one frame up announces the whole operation, and `by`
 * names that aggregator.
 *
 * Naming it is the point. B-16 — merge suppressing every door while claiming an
 * aggregator that does not exist — is exactly the defect a named announcer makes
 * checkable.
 *
 * @param by The aggregator that announces on this write's behalf. Non-empty.
 * @param base The session to inherit origin and depth from, when there is one.
 */
export function absorbedSession(by: string, base?: WriteSession): WriteSession {
  if (!by.trim()) throw new Error('absorbedSession requires a named aggregator')
  return {
    origin: base?.origin ?? { kind: 'automation', actor: 'system' },
    depth: base?.depth ?? 0,
    mode: { kind: 'absorbed', by },
  }
}
