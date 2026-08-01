// packages/lib/src/agents/agent-toolset-types.ts

/**
 * Shape of `Agent.toolsets[].config` (jsonb). Stored as `{}` by default; reader
 * tolerates extra/unknown keys. Single source of truth for writers + readers.
 *
 * A type ALIAS, not an interface: `ToolsetEntry.config` is declared
 * `Record<string, unknown>` in `@auxx/database` (tier 1, which cannot see this
 * type), and only an alias carries the implicit index signature that makes it
 * assignable there. An interface forces an `as` at every write.
 */
export type AgentToolsetConfig = {
  /**
   * Allow-list of registered tool names enabled inside this toolset for this
   * agent. Present on implicit toolsets (MCP servers, ungrouped app tools);
   * **absent** on explicit-bundle entries, which have no per-tool config —
   * absent ⇒ every tool in the toolset. Fail-closed: a tool the server/app
   * ships later is not in the list and stays off until someone enables it.
   * See plans/mcp/v4/tool-first-catalog.md ("Why allow-list").
   */
  enabledTools?: string[]
  /** Future: pre-filled tool args. Reserved; ignored today. */
  defaultArgs?: Record<string, unknown>
}
