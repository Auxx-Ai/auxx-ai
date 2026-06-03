// packages/lib/src/agents/restrictions/apply.ts

import type { ToolContext } from '../../ai/agent-framework/tool-context'
import type { AgentEngineConfig } from '../../ai/agent-framework/types'
import type { ToolRestrictionMap } from './client'

/**
 * Build the `applyToolRestrictions` hook from an agent's restriction map.
 *
 * Phase 1 ships the `constant` and `required` sources. The `var` source calls
 * `resolveVar` when provided (phase 2 wires the registry); without it, a `var`
 * restriction is a no-op and leaves the arg untouched. The `model` source
 * always leaves the arg to the LLM.
 *
 * Security invariant: the returned `args` object is a fresh clone — the engine
 * threads exactly this object into validateInputs / execute / prepareLambdaCall
 * and never re-reads the pre-clamp args. See plans/chat/v6 phase-1.
 *
 * Phase 3 adds the **author-floor fail-closed** check: on a visitor turn
 * (`ctx.invocation` present) every identity-scoped arg declared by the tool
 * (`identityScopedInputsByTool[toolName]`) MUST be bound to a restriction and
 * resolve non-null, or the call is refused (`visitor_not_identified`). This
 * runs even when the tool has *no* restriction map at all — that is exactly the
 * "admin forgot to bind" case the floor must catch. Internal turns
 * (`ctx.invocation` absent) skip the check (fail-open): the admin's toolset
 * choice is the authorization. See plans/chat/v6 phase-3.
 *
 * @param restrictions tool registered-name → arg name → restriction
 * @param resolveVar optional async resolver for `source: 'var'` (phase 2)
 * @param identityScopedInputsByTool tool registered-name → identity-scoped args
 *   (the author-floor); enforced only on visitor turns. Undefined ⇒ no-op.
 */
export function buildApplyToolRestrictions(
  restrictions: ToolRestrictionMap,
  resolveVar?: (key: string, ctx: ToolContext) => Promise<unknown>,
  identityScopedInputsByTool?: Record<
    string,
    ReadonlyArray<{ name: string; suggestedVar?: string }>
  >
): NonNullable<AgentEngineConfig['applyToolRestrictions']> {
  return async (toolName, args, ctx) => {
    const perTool = restrictions[toolName]

    // Always clone — the engine threads exactly this object downstream and
    // never re-reads the pre-clamp args.
    const next = { ...args }

    if (perTool) {
      for (const [arg, r] of Object.entries(perTool)) {
        if (r.source === 'constant') {
          next[arg] = r.value
        } else if (r.source === 'var' && r.var && resolveVar) {
          next[arg] = await resolveVar(r.var, ctx)
        }
        // source 'model' (and 'var' without a resolver) leave next[arg] untouched.

        if (r.required && (next[arg] === undefined || next[arg] === null)) {
          return { ok: false, error: `arg_not_bound: "${arg}" required for ${toolName}` }
        }
      }
    }

    // Author-floor: visitor turns fail closed on any identity-scoped arg that
    // isn't pinned to a *platform* value, even when the tool has no restriction
    // map (forgot-to-bind case). A `model` binding clamps nothing — the LLM
    // could supply someone else's id — so it does NOT satisfy the floor; only a
    // `constant`, or a `var` with an actual var id that resolved non-null, does.
    if (ctx.invocation) {
      for (const { name } of identityScopedInputsByTool?.[toolName] ?? []) {
        const bound = perTool?.[name]
        const platformBound =
          bound && (bound.source === 'constant' || (bound.source === 'var' && !!bound.var))
        const value = next[name]
        if (!platformBound || value === undefined || value === null) {
          return { ok: false, error: 'visitor_not_identified' }
        }
      }
    }

    return { ok: true, args: next }
  }
}
