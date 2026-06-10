// packages/lib/src/agents/bindings/client.ts

/**
 * Client-safe binding types for the admin Bindings UI (plans/chat/v8 phase-5).
 * No server-only imports, so client components can import them without pulling
 * `FieldValueService` / the org cache.
 *
 * These are the **structural** shapes the UI and persistence layer work in —
 * `ref` is a plain `string | string[]` (the picker emits plain field refs). The
 * runtime resolver (`resolve.ts`) narrows `ref` to a branded `VarRef`. Mirrors
 * the `@auxx/database` `AgentVarSource` shape.
 */

/** A var ref as carried client-side / persisted — a field ref or traversal path. */
export type VarRef = string | string[]

/** Source of a tool-input binding (client/persisted structural shape). */
export type VarSource =
  | { kind: 'var'; ref: VarRef }
  | { kind: 'const'; value: unknown }
  | { kind: 'model' }

/** Per-agent override map: tool registered-name → input → {@link VarSource}. */
export type ToolBindingMap = Record<string, Record<string, VarSource>>
