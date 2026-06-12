// packages/lib/src/agents/filter-tools.ts

import type { AgentToolDefinition } from '../ai/agent-framework/types'
import type { ResolvedAgentConfig } from './resolve-agent-config'

/**
 * Drop tools whose `toolsetSlug` is not enabled for the given agent. Tools
 * without a slug are treated as always-on (plan tools today). Master sessions
 * gate on the resolved `kopilot.*` settings — same filter, no pass-through.
 *
 * Per-tool gating is an **allow-list**: a toolset with `enabledTools === null`
 * (explicit bundle, no per-tool config) passes every member tool; one with a
 * set keeps exactly the listed registered names — a tool the server shipped
 * after the list was written is absent and stays off (fail-closed). See
 * plans/mcp/v4/tool-first-catalog.md.
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

  const bySlug = new Map<string, ReadonlySet<string> | null>(
    agentConfig.toolsets.map((t) => [t.slug, t.enabledTools])
  )

  return tools.filter((tool) => {
    if (!tool.toolsetSlug) return true
    if (!bySlug.has(tool.toolsetSlug)) return false
    const enabledInToolset = bySlug.get(tool.toolsetSlug)
    return enabledInToolset === null || (enabledInToolset?.has(tool.name) ?? false)
  })
}
