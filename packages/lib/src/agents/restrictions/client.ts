// packages/lib/src/agents/restrictions/client.ts

/**
 * Client-safe types for per-agent tool restrictions (`Agent.toolRestrictions`).
 *
 * A restriction either **pins** one argument of one tool to a
 * platform-resolved value (a constant, or a dynamic var from the invocation
 * context) or marks it **required**. The engine applies the map immediately
 * before a tool's `validateInputs` / `execute`, so the tool stays dumb and
 * receives already-clamped args. See plans/chat/v6 phase-1.
 *
 * This module is client-safe (no server-only imports) so both the engine and
 * the builder UI can import the same shapes.
 */

/** Source of a restricted argument's value. */
export type RestrictionSource = 'model' | 'var' | 'constant'

/** Restriction on a single tool argument. */
export interface ArgRestriction {
  /** Where the value comes from. 'model' = leave to the LLM (default). */
  source: RestrictionSource
  /** When source === 'var': a key from the var registry (phase 2). */
  var?: string
  /** When source === 'constant': the literal value to inject. */
  value?: unknown
  /**
   * The resolved/model value must be non-null or the call is refused.
   * `source: 'var' + required: true` is the identity gate
   * (refuse when the var resolves null — e.g. unverified visitor).
   */
  required?: boolean
}

/**
 * tool registered-name → arg name → restriction. Keyed by the LLM-facing tool
 * name (e.g. `find_contact`, `shopify_list_orders`) and the arg name as it
 * appears in the tool's JSON-Schema `parameters`. Scalar top-level args only
 * (v6).
 */
export type ToolRestrictionMap = Record<string, Record<string, ArgRestriction>>

/**
 * A dynamic var the UI picker can bind a `source: 'var'` restriction to.
 *
 * A var is a **read-only value reachable from the chat invocation context** —
 * an `anchor` (the verified visitor or the thread) plus a field `ref` on that
 * anchor's entity. Vars are not authored: the registry **projects** them from
 * the entity-field system (`getCachedResourceFields`), so built-in, custom, and
 * app-registered fields all surface uniformly. See plans/chat/v6 phase-2.
 *
 * This shape is client-safe so the phase-4 builder UI can render the picker.
 */
export interface RestrictionVar {
  /**
   * Stable id stored on the restriction (`ArgRestriction.var`).
   * Format `<anchor>:<ref>` where `ref` is `'self'` or an encoded
   * `ResourceFieldId`. e.g. `visitor:self`, `visitor:contact:primary_email`.
   */
  id: string
  /** The identity anchor the value is rooted at. */
  anchor: 'visitor' | 'thread'
  /**
   * The field reference on the anchor's entity. `'self'` means the anchor's
   * own record id; otherwise a `ResourceFieldId` string (`<entityDef>:<field>`).
   * FieldPath traversal is deferred in v6 (anchor-local only).
   */
  ref: 'self' | string
  /** Human-readable label for the picker. */
  label: string
  /** Picker group heading — `'Visitor'`, `'Thread'`, or an app/group name. */
  group: string
  /**
   * The terminal field's `FieldType` string (e.g. `TEXT`, `NUMBER`). Lets the
   * phase-4 UI offer only vars whose type matches the arg being bound.
   */
  fieldType: string
}
