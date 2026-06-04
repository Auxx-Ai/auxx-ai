// packages/lib/src/agents/bindings/project-schema.ts

import type { VarSource } from '@auxx/types/field'
import type { ToolBindingMap } from './types'

/** Appended to a bound input's description so the model knows it's managed. */
const MANAGED_ARG_NOTE = 'Automatically set by the workspace; any value you provide is ignored.'

/**
 * Project a tool's JSON-Schema `parameters` for the LLM given its effective
 * per-tool binding map (plans/chat/v8 phase-4). Pure comprehension — the
 * `buildApplyBindings` clamp is the actual guarantee; this only keeps the model
 * from being asked to supply a value the platform owns, while leaving the input
 * visible so the model still understands the tool.
 *
 * Projection **cannot** know at build time whether a `var` will resolve (app
 * segments resolve at turn time), so it keys on the tool's **original `required`
 * membership**, not on whether the binding will resolve:
 *
 * - `const` — always resolves → drop from `required[]`, annotate.
 * - `var`   — keep its original `required[]` membership (a required id stays
 *   required so the engine refuses when it resolves to `undefined` — the gate),
 *   annotate.
 * - `model` — not bound; left untouched.
 */
export function projectBindingSchemas<
  T extends { name: string; parameters: Record<string, unknown> },
>(tools: T[], bindingsByTool: ToolBindingMap): T[] {
  return tools.map((tool) => {
    const perTool = bindingsByTool[tool.name]
    if (!perTool || Object.keys(perTool).length === 0) return tool
    return { ...tool, parameters: projectOne(tool.parameters, perTool) }
  })
}

function projectOne(
  parameters: Record<string, unknown>,
  perTool: Record<string, VarSource>
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...parameters }

  // Drop only `const`-bound inputs from `required` (they always resolve). `var`
  // keeps its original membership; `model` is not bound.
  if (Array.isArray(next.required)) {
    const filtered = (next.required as unknown[]).filter((name) => {
      if (typeof name !== 'string') return true
      const source = perTool[name]
      return !source || source.kind !== 'const'
    })
    if (filtered.length > 0) next.required = filtered
    else delete next.required
  }

  // Annotate descriptions for const/var bound inputs (not `model`).
  const props = next.properties
  if (props && typeof props === 'object') {
    const nextProps: Record<string, unknown> = { ...(props as Record<string, unknown>) }
    for (const [input, source] of Object.entries(perTool)) {
      if (source.kind === 'model') continue
      const prop = nextProps[input]
      if (!prop || typeof prop !== 'object') continue
      const propObj = prop as Record<string, unknown>
      const existing = typeof propObj.description === 'string' ? propObj.description : ''
      nextProps[input] = {
        ...propObj,
        description: existing ? `${existing} ${MANAGED_ARG_NOTE}` : MANAGED_ARG_NOTE,
      }
    }
    next.properties = nextProps
  }

  return next
}
