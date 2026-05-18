// packages/lib/src/agents/agent-trigger-queries.ts

/**
 * Flat key/value `filter` evaluator. The Phase 2 spec keeps filters
 * primitive — exact-match on top-level keys of the resource payload.
 * Returns true when the filter is empty or every key matches.
 *
 * Dispatch lookups (`getAgentTriggersBy*`) used to live here. They now read
 * from the org agents cache — see plans/kopilot/agents/cache/plan.md.
 */
export function matchesFilter(
  filter: Record<string, unknown> | undefined | null,
  payload: Record<string, unknown> | undefined | null
): boolean {
  if (!filter || Object.keys(filter).length === 0) return true
  if (!payload) return false
  for (const [key, expected] of Object.entries(filter)) {
    if (payload[key] !== expected) return false
  }
  return true
}
