// packages/lib/src/ai/kopilot/capabilities/agents-builder/snapshot.ts

/**
 * Structured fragment returned by every builder mutator. The detail-page rail
 * listens to chat tool-completed events and invalidates `api.agent.getById`
 * whenever a `_railUpdate` block lands.
 *
 * Carried inside the tool's `output` under the reserved `_railUpdate` key so
 * existing tool-result plumbing (digest extraction, snapshot pipeline) is not
 * disturbed.
 */
export interface AgentRailUpdate {
  agentId: string
  /** Which surfaces of the rail need to re-render. */
  changed: Array<'identity' | 'prompt' | 'toolsets' | 'scope' | 'triggers' | 'avatar'>
  /** Optional one-line summary for the chat — e.g. `name: "Refund Triager"`. */
  summary?: string
}

/**
 * Convenience builder so tool implementations don't repeat the shape.
 */
export function buildAgentRailUpdate(input: AgentRailUpdate): { _railUpdate: AgentRailUpdate } {
  return { _railUpdate: input }
}
