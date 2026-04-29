// packages/lib/src/ai/agent-framework/utils.ts

import type { ToolCall } from '../clients/base/types'
import type { AgentBlock, AgentToolDefinition } from './types'

/**
 * Result of executing (or synthesizing) a single tool call inside the query
 * loop. Shared between the pause-mode dispatcher (`executeToolCalls`) and the
 * capture-mode dispatcher (`processCaptureToolCalls`, which extends this with
 * a `captured` flag).
 */
export interface ToolExecResult {
  toolCallId: string
  toolName: string
  output: unknown
  success: boolean
  error?: string
  blocks?: AgentBlock[]
}

/**
 * Parse a `ToolCall.function.arguments` payload (provider-dependent — string or
 * already-parsed object) into a `Record<string, unknown>`. Returns an empty
 * object on malformed JSON so the caller can decide how to react.
 */
export function parseToolArgs(toolCall: ToolCall): Record<string, unknown> {
  const raw = toolCall.function.arguments
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return {}
    }
  }
  return raw as Record<string, unknown>
}

/**
 * Check that all `required` params from the tool's JSON Schema are present in
 * the parsed args. Returns the list of missing param names (empty when all
 * required params are present, or when the tool has no required params).
 */
export function validateRequiredParams(
  toolDef: AgentToolDefinition | undefined,
  args: Record<string, unknown>
): string[] {
  if (!toolDef) return []
  const required = toolDef.parameters?.required
  if (!Array.isArray(required)) return []
  return required.filter((param: string) => !(param in args))
}

/**
 * Deterministic JSON.stringify — sorts object keys so `{a:1,b:2}` and
 * `{b:2,a:1}` produce the same cache key. Used to key the per-turn idempotent
 * cache for read-only tool calls.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
  return `{${entries.join(',')}}`
}
