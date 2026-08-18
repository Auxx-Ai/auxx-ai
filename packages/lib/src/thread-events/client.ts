// packages/lib/src/thread-events/client.ts
//
// Client-safe constants and types for thread lifecycle events. NO 'use client'
// directive — server code imports this file too, and the directive would turn
// every export into a client-reference proxy there.

/**
 * The full ThreadEvent `type` vocabulary — the single source of truth
 * (plans/threads/thread-events.md §5.4). These strings are externally pinned:
 * `thread:archived` / `thread:reopened` are public webhook event names, and all
 * of them double as Pusher event names, so they are never renamed.
 *
 * This list GROWS over time; {@link VISITOR_FACING_THREAD_EVENT_TYPES} is
 * frozen at the original six. They are deliberately not the same set.
 */
export const THREAD_EVENT_TYPES = [
  'thread:taken_over',
  'thread:returned_to_ai',
  'thread:archived',
  'thread:reopened',
  'thread:assignee:changed',
  'thread:visitor:identified',
  'thread:tagged',
  'thread:untagged',
  'thread:merged',
] as const

/** A member of {@link THREAD_EVENT_TYPES}. */
export type ThreadEventType = (typeof THREAD_EVENT_TYPES)[number]

/**
 * The frozen visitor-facing subset (plans/threads/thread-events.md §13.3): the
 * chat widget renders exactly these six and never learns about newer types —
 * a visitor must not see that a thread was tagged or merged. Do NOT add to
 * this list when `THREAD_EVENT_TYPES` grows.
 */
export const VISITOR_FACING_THREAD_EVENT_TYPES = [
  'thread:taken_over',
  'thread:returned_to_ai',
  'thread:archived',
  'thread:reopened',
  'thread:assignee:changed',
  'thread:visitor:identified',
] as const satisfies readonly ThreadEventType[]

/** A member of {@link VISITOR_FACING_THREAD_EVENT_TYPES}. */
export type VisitorFacingThreadEventType = (typeof VISITOR_FACING_THREAD_EVENT_TYPES)[number]

/**
 * Provenance for automated thread changes (plans/threads/thread-events.md
 * §5.5): which workflow / record rule / mail filter / classifier did it. NOT an
 * ActorId — `ActorId` has no `workflow:` kind; these render as copy ("Archived
 * by workflow *Auto-close*"), not as an avatar badge. `name` is a snapshot at
 * emit time so a deleted workflow still renders; live-name resolution by `id`
 * takes precedence when it succeeds.
 */
export interface ThreadEventSource {
  kind: 'workflow' | 'record_rule' | 'mail_filter' | 'classification' | 'system'
  id?: string
  runId?: string
  name?: string
}

/**
 * The acting principal for a thread mutation (plans/threads/thread-events.md
 * §5.5 / §13.7 finding 1). Addressable principals (`user` / `agent`) map onto
 * the `ThreadEvent.actorId` column as branded ActorId strings and render as
 * avatar badges; automation kinds map onto `data.source` provenance and render
 * as copy ("Archived by workflow *Auto-close*") with `actorId = null`.
 */
export type ThreadActor =
  | { kind: 'user'; id: string }
  | { kind: 'agent'; id: string }
  | {
      kind: 'mail_filter' | 'workflow' | 'record_rule' | 'classification' | 'system'
      id?: string
      runId?: string
      name?: string
    }

/**
 * Map a {@link ThreadActor} onto the event-payload fields the emitters write:
 * `user`/`agent` kinds become a branded `actorId` string, automation kinds
 * become `actorId: null` plus a {@link ThreadEventSource}. `undefined` (no
 * known principal) yields a bare null actor with no provenance.
 */
export function threadActorToEventFields(actor: ThreadActor | undefined): {
  actorId: string | null
  source?: ThreadEventSource
} {
  if (!actor) return { actorId: null }
  if (actor.kind === 'user' || actor.kind === 'agent') {
    return { actorId: `${actor.kind}:${actor.id}` }
  }
  return {
    actorId: null,
    source: {
      kind: actor.kind,
      ...(actor.id ? { id: actor.id } : {}),
      ...(actor.runId ? { runId: actor.runId } : {}),
      ...(actor.name ? { name: actor.name } : {}),
    },
  }
}

/** Every payload may carry automation provenance. */
type WithSource = { source?: ThreadEventSource }

/**
 * Legacy payloads whose exact shape isn't pinned — the original six types keep
 * whatever fields the emitters historically wrote (`previousState`,
 * `visitorEmail`, `visitorParticipantId`, …) as loose extras.
 */
type LooseEventData = Record<string, unknown> & WithSource

/**
 * Per-type `ThreadEvent.data` payload shapes, keyed by {@link ThreadEventType}.
 *
 * Actor references inside payloads (e.g. `assigneeActorId`) are branded
 * `ActorId` strings (`user:…` / `agent:…`), never bare user ids — the renderer
 * feeds them straight to `useActor`/`ActorBadge`.
 */
export type ThreadEventData = {
  'thread:taken_over': LooseEventData
  'thread:returned_to_ai': LooseEventData
  'thread:archived': LooseEventData
  'thread:reopened': LooseEventData
  'thread:assignee:changed': {
    /** Branded ActorId of the new assignee ('user:…' / 'agent:…'), null when unassigned. */
    assigneeActorId: string | null
    fromUserId?: string | null
    previousState?: string
  } & LooseEventData
  'thread:visitor:identified': LooseEventData
  'thread:tagged': { tagIds: string[]; tagNames: string[] } & WithSource
  'thread:untagged': { tagIds: string[]; tagNames: string[] } & WithSource
  'thread:merged': { sourceThreadId: string } & WithSource
}
