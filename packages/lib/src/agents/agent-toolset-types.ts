// packages/lib/src/agents/agent-toolset-types.ts

/**
 * Shape of `Agent.toolsets[].config` (jsonb). Stored as `{}` by default; reader
 * tolerates extra/unknown keys. Single source of truth for writers + readers.
 */
export interface AgentToolsetConfig {
  /** Tool names disabled inside this toolset for this agent. */
  disabledTools?: string[]
  /** Future: pre-filled tool args. Reserved; ignored today. */
  defaultArgs?: Record<string, unknown>
}
