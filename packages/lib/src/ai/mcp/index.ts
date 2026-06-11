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
export type { McpConnectOutcome } from './manage'
export {
  connectCuratedMcpServer,
  createCustomMcpServer,
  deleteMcpServer,
  updateMcpServer,
} from './manage'
export type { McpRateLimitResult } from './rate-limiter'
export {
  checkAndCountMcpCall,
  MCP_ORG_CALL_LIMIT,
  MCP_TURN_CALL_LIMIT,
} from './rate-limiter'
export type { SyncMcpToolsResult } from './sync'
export { syncMcpTools } from './sync'
export { buildMcpAgentTools, mcpToolName, wrapMcpOutput } from './tool-adapter'
export type { CachedMcpServer, McpCallResult, McpToolDescriptor, McpTrustConfig } from './types'
