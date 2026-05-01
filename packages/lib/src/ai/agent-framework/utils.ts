// packages/lib/src/ai/agent-framework/utils.ts

import type { ToolCall } from '../clients/base/types'
import type { AgentToolDefinition } from './types'

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
  /** Display projection of the tool output, computed via `buildDigest`. */
  digest?: unknown
}

/**
 * Compute the display digest for a tool result. Best-effort — `buildDigest`
 * errors and `outputDigestSchema` validation failures are logged and dropped so
 * a misshapen digest never fails the turn. Returns `undefined` when the tool
 * has no `buildDigest` or the output cannot be projected.
 */
export function buildToolDigest(
  tool: AgentToolDefinition | undefined,
  output: unknown,
  logger?: { warn: (msg: string, meta?: Record<string, unknown>) => void }
): unknown {
  if (!tool?.buildDigest) return undefined
  let digest: unknown
  try {
    digest = tool.buildDigest(output)
  } catch (err) {
    logger?.warn('buildDigest threw', {
      tool: tool.name,
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
  if (tool.outputDigestSchema) {
    const parsed = tool.outputDigestSchema.safeParse(digest)
    if (!parsed.success) {
      logger?.warn('digest failed outputDigestSchema validation', {
        tool: tool.name,
        issues: parsed.error.issues.slice(0, 3),
      })
      return undefined
    }
    return parsed.data
  }
  return digest
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
 * Compact-stringify a value for log lines. Truncates each leaf string and the
 * final serialized form so logs stay readable when tool args / outputs carry
 * large payloads (e.g. message bodies, embeddings, file blobs).
 */
export function previewValue(value: unknown, maxLength = 600): string {
  let serialized: string
  try {
    serialized = JSON.stringify(value, (_key, v) => {
      if (typeof v === 'string' && v.length > 200) return `${v.slice(0, 200)}…`
      if (Array.isArray(v) && v.length > 20) {
        return [...v.slice(0, 20), `…(+${v.length - 20})`]
      }
      return v
    })
  } catch {
    serialized = String(value)
  }
  if (serialized.length > maxLength) {
    return `${serialized.slice(0, maxLength)}…(+${serialized.length - maxLength})`
  }
  return serialized
}

/**
 * Resolve a tool's `requiresApproval` field for a specific call. Booleans are
 * passed through; predicate forms are evaluated against the call's args. A
 * thrown predicate falls back to `false` (no approval) and is the caller's
 * responsibility to log if it cares.
 */
export function needsApproval(tool: AgentToolDefinition, args: Record<string, unknown>): boolean {
  const gate = tool.requiresApproval
  if (typeof gate === 'function') {
    try {
      return gate(args)
    } catch {
      return false
    }
  }
  return !!gate
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
