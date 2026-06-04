// packages/lib/src/agents/bindings/types.ts

import type { VarRef, VarSource } from '@auxx/types/field'

/**
 * Tool-input binding model (plans/chat/v8 phase-2). The canonical {@link VarSource}
 * / {@link VarRef} types live in `@auxx/types/field` so the SDK, the database
 * schema, and the runtime can all describe a binding without crossing tier
 * boundaries. Re-exported here as the agents-layer entry point.
 *
 * Replaces the v6 `var-registry.ts` string scheme: there is no stored `anchor`
 * (it is derived from the ref's root entity), no `visitor:app:slug:key` whole-var
 * form, and no `parseVarId`. App-ness is a per-segment property (`@app:<slug>:<key>`)
 * resolved at turn time, so an app field can live on any anchor or traversal target.
 */
export type { VarRef, VarSource }

/**
 * Effective per-tool binding map consumed by the clamp: tool registered-name →
 * input name → resolved {@link VarSource} (`override ?? authorDefault`).
 */
export type ToolBindingMap = Record<string, Record<string, VarSource>>

/**
 * One bindable field on an anchor, for the admin override picker (plans/chat/v8
 * phase-5). App-owned fields appear as their `@app:<slug>:<key>` ref (the
 * connection is resolved at turn time). Pure type — lives here so the web UI
 * can import it client-side without pulling the server-only projection.
 */
export interface AvailableField {
  /** The `VarRef` (as a string) to store in a `{ kind:'var', ref }` binding. */
  ref: string
  /** Human-readable label for the picker. */
  label: string
  /** Picker group heading — the anchor label, or the app title for app fields. */
  group: string
  /** Terminal field type (`TEXT`, `NUMBER`, …) so the UI can type-match the input. */
  fieldType: string
}
