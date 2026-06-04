// packages/lib/src/ai/agent-framework/context/context-manager.ts

import type { FieldReference } from '@auxx/types/field'

/**
 * Chat v9 — the shared execution-context contract.
 *
 * One `ContextManager` interface is threaded onto every `ToolContext` as
 * `ctx.context`, so a tool reaches turn state the same way whether it runs in
 * plain chat, internal kopilot, or inside a workflow AI node. Two backing
 * stores conform to it: the kopilot `KopilotContextStore` (the full impl) and
 * the workflow `ExecutionContextManager` (via thin adapters). See
 * plans/chat/v9/CONTEXT-VARIABLES-IMPLEMENTATION.md.
 *
 * Phase 0 lands this contract + the {@link parseContextRef} parser with **zero
 * behavior change** — nothing consumes it yet.
 */

/**
 * A typed string grammar addressing any value reachable this turn. Parsed once
 * into a `(kind, root, path)` triple by {@link parseContextRef}; each backing
 * store resolves the root for its own sources, then both navigate within the
 * materialized value with the one shared path walker (Phase 1).
 *
 * - `var:*`            — scratch namespace, PERSISTS across turns
 * - `tool:*` / `call:*`— captured tool invocations, TURN-SCOPED
 * - `sys:*`            — read-only system values (userId, orgId, now, agentName)
 * - {@link FieldReference} — v8 field grammar resolved off `Subject.anchors`
 *
 * Reserved non-entity prefixes are `var` / `tool` / `call` / `sys`; everything
 * else parses as a `FieldReference` (Open Q5, adopted). An entity type can
 * therefore never use one of those four slugs.
 */
export type ContextRef =
  | `var:${string}`
  | `tool:${string}`
  | `tool:${string}[]`
  | `call:${string}`
  | `sys:${string}`
  | FieldReference // ResourceFieldId | FieldPath, v8 grammar, off Subject

/** Discriminator for {@link ContextEntryDescriptor.kind}. */
export type ContextRefKind = 'var' | 'tool' | 'call' | 'field' | 'sys'

/** One resolvable ref surfaced by {@link ContextManager.list}. */
export interface ContextEntryDescriptor {
  ref: ContextRef
  kind: ContextRefKind
  /** Human hint for the runtime "available context" listing. */
  label?: string
}

/**
 * A single captured tool invocation. Stored per `toolCallId` and appended to a
 * per-tool-name ordered list, so `tool:foo` (latest), `tool:foo[]` (all), and
 * `call:<id>` (exact) are all addressable without clobbering (Phase 3).
 */
export interface CapturedInvocation {
  toolCallId: string
  toolName: string
  result: unknown
  /** Monotonic per-store sequence — preserves chronological order in `tool:*[]`. */
  seq: number
}

/**
 * Persisted shape of a context store, rehydrated from `domainState.__context`.
 *
 * `vars` is the scratch namespace and persists ACROSS turns. The optional
 * `turn` sub-slice holds captured tool outputs and persists only WITHIN a turn
 * (so captures survive an approval pause/resume, which builds a fresh store);
 * it is wiped by `resetTurn()` on a new user message (Phase 3).
 */
export interface SerializedContext {
  vars: Record<string, unknown>
  turn?: {
    /** Captured invocations by tool name, chronological. */
    tools: Record<string, CapturedInvocation[]>
    /** Captured invocations by `toolCallId`. */
    calls: Record<string, CapturedInvocation>
  }
}

/**
 * The tool-facing runtime surface every store exposes via `ctx.context`.
 *
 * Note: **`serialize()` is intentionally not on this interface.** Persistence
 * is store-specific — `KopilotContextStore.serialize()` returns a
 * {@link SerializedContext} for `domainState`, while `ExecutionContextManager`
 * serializes to a string for workflow-run persistence. Forcing one signature
 * here would break either store. The interface is the read/write/capture/
 * interpolate/list contract that tools actually call; how each store persists
 * stays its own concern.
 */
export interface ContextManager {
  /** Resolve a ref to its (possibly navigated) value, or `undefined` if absent. */
  read(ref: ContextRef): Promise<unknown>
  /** Replace `{{ref}}` occurrences in `text` with display-formatted values. */
  interpolate(text: string): Promise<string>
  /** Write a value; nested `var:*` paths set into the path (Phase 2). */
  write(ref: ContextRef, value: unknown): Promise<void>
  /** Capture a successful tool result for `tool:*` / `call:*` addressing (Phase 3). */
  captureToolResult(toolCallId: string, toolName: string, result: unknown): void
  /** Enumerate currently-resolvable refs (for the runtime "available context" listing). */
  list(): ContextEntryDescriptor[]
}
