// packages/lib/src/agents/bindings/effective.ts

import type { VarSource } from '@auxx/types/field'
import type { AgentToolDefinition } from '../../ai/agent-framework/types'
import type { ToolBindingMap } from './types'

/**
 * Compute the **effective** binding map (plans/chat/v8 phase-4):
 *
 *   effective(tool, input) = agentOverride[tool]?.[input] ?? authorDefault(tool, input)
 *
 * `authorDefault` comes from each tool's `inputBindings` (phase-3); `overrides`
 * is the thin per-agent override map (phase-5) — usually empty, so the common
 * result is just the author defaults. An override of `{ kind: 'model' }` clears
 * the default (the only way to un-bind an author default) and is carried through
 * so the clamp / projection treat it as "left to the LLM".
 *
 * No build-time app resolution happens here — the result is plain `VarSource`s;
 * `@app:` indirection is the turn-time resolver's job (phase-2).
 */
export function computeEffectiveBindings(
  tools: ReadonlyArray<Pick<AgentToolDefinition, 'name' | 'inputBindings'>>,
  overrides: ToolBindingMap = {}
): ToolBindingMap {
  const result: ToolBindingMap = {}
  for (const tool of tools) {
    const perTool: Record<string, VarSource> = {}
    for (const binding of tool.inputBindings ?? []) {
      perTool[binding.name] = binding.default
    }
    const override = overrides[tool.name]
    if (override) {
      for (const [input, source] of Object.entries(override)) {
        perTool[input] = source
      }
    }
    if (Object.keys(perTool).length > 0) result[tool.name] = perTool
  }
  return result
}
