// packages/lib/src/agents/bindings/apply.ts

import type { AgentEngineConfig } from '../../ai/agent-framework/types'
import { buildResolveVarSource } from './resolve'
import type { ToolBindingMap } from './types'

/**
 * Build the `applyToolRestrictions` engine hook from an agent's **effective**
 * binding map (plans/chat/v8 phase-4). For each bound input the platform
 * resolves the `VarSource` from the turn's subject and clamps it onto the args
 * before `validateInputs` / `execute`.
 *
 * What is **gone** vs v6: no `required` flag, no `arg_not_bound`, no
 * `visitor_not_identified`, no author-floor loop. A bound input that resolves to
 * `undefined` (absent anchor, empty field, no connected store) is simply absent
 * — the tool's own JSON-schema `required` (kept by `projectBindingSchemas`) makes
 * the engine refuse the call naturally. **Missing required input is the gate.**
 *
 * The resolver is built **per call** from `ctx` because `@app:` segment
 * resolution needs `ctx.appAccounts` / `ctx.organizationId` / `ctx.db` (phase-2).
 * The returned `args` is always a fresh clone — the engine threads exactly this
 * object into validateInputs / execute and never re-reads the pre-clamp args.
 *
 * @param bindingsByTool effective bindings (`override ?? authorDefault`)
 */
export function buildApplyBindings(
  bindingsByTool: ToolBindingMap
): NonNullable<AgentEngineConfig['applyToolRestrictions']> {
  return async (toolName, args, ctx) => {
    const perTool = bindingsByTool[toolName]
    const next = { ...args }
    // No subject (internal / kopilot / autonomous turn) ⇒ bound inputs fall
    // through to the model untouched.
    if (perTool && ctx.subject) {
      const resolveVarSource = buildResolveVarSource(ctx)
      for (const [input, source] of Object.entries(perTool)) {
        if (source.kind === 'model') continue // explicitly left to the LLM
        const resolved = await resolveVarSource(source, ctx.subject)
        // Overwrite the model-supplied value either way; when the binding
        // resolves to nothing (absent anchor / empty field / no store), DELETE
        // the key so the input is unambiguously absent — the tool's JSON-schema
        // `required` then refuses the call (missing input is the gate), with no
        // validator dependence on `undefined`-vs-missing.
        if (resolved === undefined) delete next[input]
        else next[input] = resolved
      }
    }
    return { ok: true, args: next }
  }
}
