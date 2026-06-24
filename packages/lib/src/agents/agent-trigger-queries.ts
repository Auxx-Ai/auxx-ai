// packages/lib/src/agents/agent-trigger-queries.ts

/**
 * Flat key/value `filter` evaluator shared by all app-trigger consumers
 * (workflows, agents, and the data-connector sync bridge). Filters stay
 * primitive — exact-match on top-level keys of the resource payload — with one
 * generalization: a value of `{ in: [...] }` matches when the payload key is any
 * member of the list. That covers a flagship app multiplexing many topics
 * through ONE trigger (Shopify fans all 22 topics on `shopify.shopify-trigger`,
 * discriminated on `triggerData.topic`), so a stream can bind a subset of topics
 * without a provider-specific schema. Returns true when the filter is empty or
 * every key matches.
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
    const actual = payload[key]
    if (isInOperator(expected)) {
      if (!expected.in.includes(actual)) return false
    } else if (actual !== expected) {
      return false
    }
  }
  return true
}

/** Narrow a filter value to the `{ in: [...] }` membership operator. */
function isInOperator(value: unknown): value is { in: unknown[] } {
  return (
    typeof value === 'object' && value !== null && Array.isArray((value as { in?: unknown }).in)
  )
}
