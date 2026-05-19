// packages/lib/src/agents/filter-tools.ts

import type { AgentToolDefinition } from '../ai/agent-framework/types'
import type { ResolvedAgentConfig } from './resolve-agent-config'

/**
 * Drop tools whose `toolsetSlug` is not enabled for the given agent. Tools
 * without a slug are treated as always-on (plan tools today). Master sessions
 * gate on the resolved `kopilot.*` settings — same filter, no pass-through.
 *
 * First of three composable predicates per
 * `plans/kopilot/agents/tool-loading-and-execution.md §12`. Invoker-scope
 * (autonomous trigger runs) and approval-mode (K2/K3) filters slot into the
 * same chain when their tracks land.
 */
export function filterToolsByToolsets(
  tools: AgentToolDefinition[],
  agentConfig: ResolvedAgentConfig | undefined
): AgentToolDefinition[] {
  if (!agentConfig) return tools

  const bySlug = new Map<string, ReadonlySet<string>>(
    agentConfig.toolsets.map((t) => [t.slug, t.disabledTools])
  )

  return tools.filter((tool) => {
    if (!tool.toolsetSlug) return true
    const disabledInToolset = bySlug.get(tool.toolsetSlug)
    if (!disabledInToolset) return false
    return !disabledInToolset.has(tool.name)
  })
}
