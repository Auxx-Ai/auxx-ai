// packages/lib/src/agents/bindings/effective.ts

import { createScopedLogger } from '@auxx/logger'
import type { VarSource } from '@auxx/types/field'
import type { AgentToolDefinition } from '../../ai/agent-framework/types'
import type { ToolBindingMap } from './types'

const logger = createScopedLogger('agent-bindings')

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
  warnOnUnreadOverrides(tools, overrides)
  return result
}

/**
 * An override keyed by a tool name that isn't in `tools` is never read, so the
 * admin's pre-bound inputs silently stop applying — a typo, a renamed tool, or
 * a toolset the agent no longer has enabled all look identical from the config
 * UI. Deliberately a warning and not a throw: a stale key must not take a live
 * agent down. Tool names go in a structured field so the log is queryable.
 */
function warnOnUnreadOverrides(
  tools: ReadonlyArray<Pick<AgentToolDefinition, 'name' | 'inputBindings'>>,
  overrides: ToolBindingMap
): void {
  const overrideNames = Object.keys(overrides)
  if (overrideNames.length === 0) return
  const bound = new Set(tools.map((t) => t.name))
  const unread = overrideNames.filter((name) => !bound.has(name))
  if (unread.length === 0) return
  logger.warn('Tool binding overrides name tools that are not bound for this run', {
    unreadToolNames: unread,
    unreadToolCount: unread.length,
    boundToolCount: bound.size,
  })
}
