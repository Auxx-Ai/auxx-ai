// packages/lib/src/ai/mcp/snippet/types.ts
//
// Pure, dependency-free types for the smart-paste pipeline. Safe to import from anywhere
// (client included) — no server-only deps. The parser produces `McpSnippetCandidate[]`; the
// resolver turns each into a `ResolvedMcpSnippet`.

/** A single server parsed out of a pasted snippet. Exactly one shape survives: remote (`url`) or stdio (`command`). */
export type McpSnippetCandidate = {
  name?: string
  // remote (or mcp-remote-unwrapped):
  url?: string
  headers?: Record<string, string>
  transportHint?: 'http' | 'sse'
  // stdio:
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** `${VAR}`-style interpolations found in url/headers/env — prompt the user for these. */
  placeholders?: string[]
}

/** Auth posture surfaced to the dialog (mirrors `McpAuthDiscoveryResult['kind']`). */
export type McpSnippetAuthKind = 'none' | 'oauth'

/** Result of resolving one candidate against the network (probe + registry + curated match). */
export type ResolvedMcpSnippet =
  | {
      kind: 'remote'
      name: string
      endpoint: string
      auth: McpSnippetAuthKind
      headers?: Record<string, string>
      /** Non-`Authorization` header name when the snippet authed via a custom header. */
      authHeaderName?: string
      placeholders?: string[]
      description?: string
      iconUrl?: string
      /** Matched a seeded curated server → UI pivots to the connect-curated flow. */
      curatedServerId?: string
    }
  | { kind: 'local-only'; name: string; packageId: string; reason: string }
  | { kind: 'unresolved'; name?: string; packageId?: string; reason: string }
