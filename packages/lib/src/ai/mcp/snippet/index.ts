// packages/lib/src/ai/mcp/snippet/index.ts
// Smart-paste pipeline: parse any MCP install snippet (pure) → resolve to a connectable remote
// (network). See phase-7-smart-paste.md.

export { parseMcpSnippet } from './parse-mcp-snippet'
export { resolveMcpSnippet } from './resolve-mcp-snippet'
export type {
  McpSnippetAuthKind,
  McpSnippetCandidate,
  ResolvedMcpSnippet,
} from './types'
