// packages/lib/src/agents/restrictions/project-schema.ts

import type { ArgRestriction } from './client'

/** Appended to a bound arg's description so the model knows it's managed. */
const MANAGED_ARG_NOTE = 'Automatically set by the workspace; any value you provide is ignored.'

/**
 * Project a tool's JSON-Schema `parameters` for the LLM given the per-tool
 * restriction map entry. For each restricted arg the result:
 *
 * - **keeps** the property in `properties` (never hidden),
 * - **removes** it from the schema's `required` array (the model must not be
 *   forced to supply a value the platform owns),
 * - **appends** {@link MANAGED_ARG_NOTE} to its `description` — but only for
 *   `constant` / `var` sources, not plain `model` / required-only restrictions.
 *
 * Pure transform — never mutates the input. Security does NOT depend on this;
 * the `applyToolRestrictions` overwrite is the guarantee. This is purely for
 * model comprehension. See plans/chat/v6 phase-1.
 */
export function projectToolSchema(
  parameters: Record<string, unknown>,
  restrictions: Record<string, ArgRestriction> | undefined
): Record<string, unknown> {
  if (!restrictions || Object.keys(restrictions).length === 0) return parameters

  const next: Record<string, unknown> = { ...parameters }

  // Drop bound args from `required`.
  if (Array.isArray(next.required)) {
    const filtered = (next.required as unknown[]).filter(
      (name) => typeof name !== 'string' || restrictions[name] === undefined
    )
    if (filtered.length > 0) next.required = filtered
    else delete next.required
  }

  // Annotate descriptions for constant/var sources (not plain model/required).
  const props = next.properties
  if (props && typeof props === 'object') {
    const nextProps: Record<string, unknown> = { ...(props as Record<string, unknown>) }
    for (const [arg, r] of Object.entries(restrictions)) {
      if (r.source !== 'constant' && r.source !== 'var') continue
      const prop = nextProps[arg]
      if (!prop || typeof prop !== 'object') continue
      const propObj = prop as Record<string, unknown>
      const existing = typeof propObj.description === 'string' ? propObj.description : ''
      const description = existing ? `${existing} ${MANAGED_ARG_NOTE}` : MANAGED_ARG_NOTE
      nextProps[arg] = { ...propObj, description }
    }
    next.properties = nextProps
  }

  return next
}

/**
 * Apply {@link projectToolSchema} to a list of tools given the agent's full
 * restriction map (tool name → arg → restriction). Returns fresh tool objects
 * for any tool that has restrictions; untouched tools pass through by
 * reference.
 */
export function projectToolsSchemas<
  T extends { name: string; parameters: Record<string, unknown> },
>(tools: T[], restrictions: Record<string, Record<string, ArgRestriction>>): T[] {
  return tools.map((tool) => {
    const perTool = restrictions[tool.name]
    if (!perTool) return tool
    return { ...tool, parameters: projectToolSchema(tool.parameters, perTool) }
  })
}
