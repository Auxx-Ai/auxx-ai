// packages/lib/src/ai/agent-framework/context/sources/field-source.ts

import type { FieldReference, VarRef } from '@auxx/types/field'
import { buildResolveVarSource } from '../../../../agents/bindings/resolve'
import type { ToolContext } from '../../tool-context'

/**
 * The `FieldReference` source for the kopilot context store — the v8 resolver
 * adapter. Wraps {@link buildResolveVarSource} (plans/chat/v8 phase-2): a bare
 * `FieldReference` becomes a `{ kind: 'var', ref }` source and is resolved off
 * `ctx.subject.anchors`, so a missing anchor (or no subject at all — internal /
 * kopilot runs) gates to `undefined`. No model/visitor input can pick the
 * record; identity is derived from the ref's root entity.
 *
 * Returns the raw resolver; the store layers per-turn memoization on top so a
 * repeated field read hits the cache instead of `batchGetValues`.
 */
export function buildFieldSource(ctx: ToolContext): (ref: FieldReference) => Promise<unknown> {
  const resolve = buildResolveVarSource(ctx)
  return async (ref) => {
    // No subject → no anchors to resolve against → gate by absence.
    if (!ctx.subject) return undefined
    return resolve({ kind: 'var', ref: ref as VarRef }, ctx.subject)
  }
}
