// packages/lib/src/ai/agent-framework/context/sources/field-source.ts

import type { FieldReference } from '@auxx/types/field'
import { buildSubjectFieldResolver } from '../../../../agents/bindings/resolve'
import type { ToolContext } from '../../tool-context'

/**
 * The `FieldReference` source for the kopilot context store — the v8 resolver
 * adapter. Delegates to the shared {@link buildSubjectFieldResolver}: in
 * production a bare `FieldReference` resolves off `ctx.subject.anchors` (a
 * missing anchor or no subject gates to `undefined`); under an eval Simulation
 * the same call short-circuits to the `startingFields` overlay. No model/visitor
 * input can pick the record; identity is derived from the ref's root entity.
 *
 * Returns the raw resolver; the store layers per-turn memoization on top so a
 * repeated field read hits the cache instead of `batchGetValues`.
 */
export function buildFieldSource(ctx: ToolContext): (ref: FieldReference) => Promise<unknown> {
  return buildSubjectFieldResolver(ctx)
}
