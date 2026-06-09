// packages/lib/src/ai/agent-framework/utils.ts

import { createScopedLogger } from '@auxx/logger'
import type { Message, ToolCall } from '../clients/base/types'
import type { ToolContext } from './tool-context'
import type {
  AgentToolDefinition,
  AgentToolResult,
  AssistantSessionMessage,
  ContentPart,
  SessionMessage,
  ToolProgressPayload,
} from './types'

const utilsLogger = createScopedLogger('agent-utils')

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
 * errors are logged and dropped so a misshapen digest never fails the turn.
 * Returns `undefined` when the tool has no `buildDigest` or the output cannot
 * be projected. `buildDigest` is the projection of `outputSchema` (the single
 * source of truth); it is trusted as-is and not re-validated.
 */
export function buildToolDigest(
  tool: AgentToolDefinition | undefined,
  output: unknown,
  logger?: { warn: (msg: string, meta?: Record<string, unknown>) => void }
): unknown {
  if (!tool?.buildDigest) return undefined
  try {
    return tool.buildDigest(output)
  } catch (err) {
    logger?.warn('buildDigest threw', {
      tool: tool.name,
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}

/**
 * Parse a `ToolCall.function.arguments` payload (provider-dependent — string or
 * already-parsed object) into a `Record<string, unknown>`. Returns an empty
 * object on malformed JSON and logs the failure with a raw-string preview so
 * mid-stream truncation (the typical cause) isn't silently swallowed.
 */
export function parseToolArgs(toolCall: ToolCall): Record<string, unknown> {
  const raw = toolCall.function.arguments
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch (err) {
      utilsLogger.warn('Failed to parse tool args — returning empty object', {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        rawLength: raw.length,
        rawPreview: raw.slice(0, 200),
        rawTail: raw.length > 200 ? raw.slice(-100) : undefined,
        error: err instanceof Error ? err.message : String(err),
        hint:
          raw.length === 0
            ? 'empty string — provider returned no args, likely max_tokens truncation before any input_json_delta'
            : 'non-empty but invalid JSON — likely truncated mid-stream',
      })
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
 * Type guard for a tool's `execute` return — true when the value is an
 * async generator (streaming tool), false when it's a Promise (buffered).
 */
function isAsyncGenerator(
  value: unknown
): value is AsyncGenerator<ToolProgressPayload, AgentToolResult, void> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AsyncIterator<unknown>)[Symbol.asyncIterator as keyof object] === 'function' &&
    typeof (value as AsyncIterator<unknown>).next === 'function'
  )
}

/**
 * Run a tool's `execute` and surface progress events when the tool is
 * streaming. For buffered tools, equivalent to `await tool.execute(args, ctx)`.
 * For streaming tools, drains the async generator: each yielded payload
 * triggers `onProgress`, the generator's return value becomes the result.
 *
 * `onProgress` is optional — autonomous / capture-mode runs pass `undefined`
 * and silently drain the generator (per plans/kopilot/apps/README.md §6.2).
 */
export async function executeToolWithProgress(
  tool: AgentToolDefinition,
  args: Record<string, unknown>,
  ctx: ToolContext,
  onProgress?: (payload: ToolProgressPayload) => void
): Promise<AgentToolResult> {
  const exec = tool.execute(args, ctx)
  if (isAsyncGenerator(exec)) {
    while (true) {
      const next = await exec.next()
      if (next.done) return next.value
      if (onProgress) onProgress(next.value)
    }
  }
  return exec
}

/**
 * Convert an assistant message's `parts[]` into the OpenAI/Anthropic wire
 * format the LLM expects — one assistant `Message` plus one `tool` `Message`
 * per `tool_call` part (linked by `tool_call_id`).
 *
 * Rules:
 * - All `text` parts concatenate into the assistant message's `content`.
 * - `thinking` parts become the assistant message's `reasoning_content`
 *   (concatenated). Most providers re-strip stale reasoning; we still surface
 *   it so a single open turn can carry chain-of-thought across iterations.
 * - Every `tool_call` part:
 *   - Appended to the assistant message's `tool_calls[]`.
 *   - Produces a `tool` Message right after the assistant, whose `content`
 *     stringifies the tool's `output` (or `{ error, output }` on failure).
 *   - Skipped entirely if `status === 'awaiting-approval'` — no tool result
 *     yet, but the assistant's tool_calls[] still references it. This is
 *     what providers see while a turn is paused.
 *
 * The returned array is a flat sequence: `[assistant, tool, tool, ...]`. Caller
 * splices it into the message list in place of the source assistant.
 */
export function partsToWireFormat(parts: ContentPart[]): Message[] {
  let textContent = ''
  const reasoningChunks: string[] = []
  const toolCalls: ToolCall[] = []
  const toolMessages: Message[] = []

  for (const part of parts) {
    if (part.type === 'text') {
      textContent += part.text
      continue
    }
    if (part.type === 'thinking') {
      reasoningChunks.push(part.text)
      continue
    }
    if (part.type === 'tool_call') {
      toolCalls.push({
        id: part.toolCallId,
        type: 'function',
        function: {
          name: part.name,
          arguments: typeof part.args === 'string' ? part.args : JSON.stringify(part.args),
        },
      })
      // Skip emitting a tool message when there's no result yet (running /
      // awaiting-approval). The assistant's tool_calls[] still references the
      // id; on resume we splice the tool message in.
      if (part.status === 'completed' || part.status === 'error' || part.status === 'rejected') {
        const toolContent =
          part.status === 'completed'
            ? JSON.stringify(part.output ?? null)
            : JSON.stringify({
                error: part.error ?? 'Unknown error',
                output: part.output ?? null,
              })
        toolMessages.push({
          role: 'tool',
          content: toolContent,
          tool_call_id: part.toolCallId,
        })
      }
    }
  }

  const assistant: Message = {
    role: 'assistant',
    content: textContent.length > 0 ? textContent : toolCalls.length > 0 ? null : '',
  }
  if (toolCalls.length > 0) assistant.tool_calls = toolCalls
  if (reasoningChunks.length > 0) assistant.reasoning_content = reasoningChunks.join('')

  return [assistant, ...toolMessages]
}

/**
 * Walk session messages and emit the OpenAI/Anthropic wire format. Assistant
 * messages expand into `assistant + tool*` via `partsToWireFormat`; user and
 * system messages pass through (with their `content` string).
 *
 * `assistantTextTransform` lets the caller transform a final/responder text
 * payload right before it goes on the wire — used by Kopilot to rewrite
 * `auxx:*` fences into ordinal-numbered prose for model consumption.
 */
export function sessionMessagesToWire(
  messages: SessionMessage[],
  opts?: {
    /** Transform applied to the joined-text content of the LAST assistant message that has no tool_call parts (the "final" assistant). */
    finalAssistantTextTransform?: (text: string) => string
  }
): Message[] {
  const out: Message[] = []
  const lastFinalIdx = findLastFinalAssistantIdx(messages)
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
      continue
    }
    if (m.role === 'system') {
      // Approval-card system messages don't have prompt content for the LLM —
      // skip them; the assistant's awaiting-approval tool_call part is enough.
      if (m.approval) continue
      out.push({ role: 'system', content: m.content })
      continue
    }
    // Assistant — expand parts
    const wire = partsToWireFormat((m as AssistantSessionMessage).parts)
    if (i === lastFinalIdx && opts?.finalAssistantTextTransform) {
      const first = wire[0]
      if (first && typeof first.content === 'string' && first.content.length > 0) {
        first.content = opts.finalAssistantTextTransform(first.content)
      }
    }
    for (const w of wire) out.push(w)
  }
  return out
}

function findLastFinalAssistantIdx(messages: SessionMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.role !== 'assistant') continue
    const a = m as AssistantSessionMessage
    const hasToolCalls = a.parts.some((p) => p.type === 'tool_call')
    if (!hasToolCalls) return i
  }
  return -1
}

// Deterministic, key-order-independent JSON.stringify — used to key the per-turn
// idempotent cache for read-only tool calls. Lives in @auxx/utils now;
// re-exported so existing `import { stableStringify } from './utils'` call sites
// keep working.
export { stableStringify } from '@auxx/utils/json'
