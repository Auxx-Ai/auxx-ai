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
