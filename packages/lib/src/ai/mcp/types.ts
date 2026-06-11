// packages/lib/src/ai/mcp/types.ts

import type { McpToolDescriptor, McpTrustConfig } from '@auxx/database'
import type { CachedMcpServer } from '../../cache/org-cache-keys'

export type { McpToolDescriptor, McpTrustConfig, CachedMcpServer }

/** Normalized result of a single `tools/call`. */
export interface McpCallResult {
  text: string
  isError: boolean
}
