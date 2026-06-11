// packages/lib/src/ai/mcp/index.ts
// Server-side MCP runtime + connection plumbing. (tool-adapter / capabilities / discovery
// arrive in phases 3–4.)

export type { McpRequestContext } from './auth'
export { buildMcpRequestContext } from './auth'
export { createMcpCapabilities } from './capabilities'
export { mcpCallTool, mcpListTools, withMcpSession } from './client'
export type {
  DecryptedConnectionData,
  McpConnectionError,
  McpRuntimeConnection,
} from './connections'
export {
  deleteMcpConnection,
  markMcpConnectionFailed,
  resolveMcpConnectionForRuntime,
  saveMcpConnection,
} from './connections'
export type { McpAuthDiscoveryResult, McpDiscoveryError } from './discovery'
export { discoverMcpAuth, registerDcrClient } from './discovery'
export type { MappedMcpError } from './errors'
export { McpAuthError, mapMcpError } from './errors'
export type { McpConnectOutcome, McpOAuthConfigInput } from './manage'
export {
  connectCuratedMcpServer,
  connectMcpTemplate,
  createCustomMcpServer,
  deleteMcpServer,
  updateMcpServer,
} from './manage'
export type { McpRateLimitResult } from './rate-limiter'
export {
  checkAndCountMcpCall,
  checkMcpResolveRateLimit,
  MCP_ORG_CALL_LIMIT,
  MCP_RESOLVE_LIMIT,
  MCP_TURN_CALL_LIMIT,
} from './rate-limiter'
export type {
  McpSnippetAuthKind,
  McpSnippetCandidate,
  ResolvedMcpSnippet,
} from './snippet'
export { parseMcpSnippet, resolveMcpSnippet } from './snippet'
export type { SyncMcpToolsResult } from './sync'
export { syncMcpTools } from './sync'
export type { McpTemplate, McpTemplateCategory, McpTemplateCategoryDef } from './templates'
export { ensureCuratedMcpServer, mcpTemplateCategories, mcpTemplates } from './templates'
export { buildMcpAgentTools, mcpToolName, wrapMcpOutput } from './tool-adapter'
export type { CachedMcpServer, McpCallResult, McpToolDescriptor, McpTrustConfig } from './types'
