// packages/lib/src/ai/agent-framework/capture-mode.ts

import { createScopedLogger } from '@auxx/logger'
import type { ToolCall } from '../clients/base/types'
import type { ToolContext } from './tool-context'
import type { AgentEvent, AgentToolDefinition, CapturedAction } from './types'
import {
  buildToolDigest,
  needsApproval,
  parseToolArgs,
  previewValue,
  stableStringify,
  type ToolExecResult,
  validateRequiredParams,
} from './utils'

const logger = createScopedLogger('agent-capture-mode')

export interface CaptureExecResult extends ToolExecResult {
  /** True when the result was synthesized by capture-mode (no real execution). */
  captured: boolean
}

/**
 * Capture-mode tool dispatcher. For each tool call in order:
 * - Approval-required → call `captureMint(args)` (or fall back to a placeholder),
 *   record a `CapturedAction`, and synthesize a `_captured: true` tool result
 *   message so the conversation history stays valid for subsequent turns AND
 *   the model can reference predicted IDs in chained captured calls.
 * - Non-approval → execute normally, identical semantics to `executeToolCalls`.
 *
 * `localIndex` is monotonic across the entire engine run (continues from the
 * length of the existing `capturedActions` list passed in), so chained captured
 * calls in a multi-turn capture run never collide on temp IDs.
 */
export async function processCaptureToolCalls(
  toolCalls: ToolCall[],
  agentTools: AgentToolDefinition[],
  agentName: string,
  ctx: ToolContext,
  idempotentCache: Map<string, ToolExecResult>,
  existingCaptures: CapturedAction[]
): Promise<{
  events: AgentEvent[]
  results: CaptureExecResult[]
  capturedActions: CapturedAction[]
}> {
  const toolMap = new Map(agentTools.map((t) => [t.name, t]))
  const events: AgentEvent[] = []
  const results: CaptureExecResult[] = []
  const capturedActions: CapturedAction[] = []
  let nextLocalIndex = existingCaptures.length

  for (const toolCall of toolCalls) {
    const toolName = toolCall.function.name
    const tool = toolMap.get(toolName)
    const args = parseToolArgs(toolCall)

    if (!tool) {
      events.push({
        type: 'tool-started',
        agent: agentName,
        tool: toolName,
        toolCallId: toolCall.id,
        args,
      })
      const errorMsg = `Unknown tool: ${toolName}`
      events.push({
        type: 'tool-error',
        agent: agentName,
        tool: toolName,
        toolCallId: toolCall.id,
        error: errorMsg,
      })
      results.push({
        toolCallId: toolCall.id,
        toolName,
        output: { error: errorMsg },
        success: false,
        error: errorMsg,
        captured: false,
      })
      continue
    }

    if (needsApproval(tool, args)) {
      // Validate required params first. Capture should reflect "intent to
      // execute on approval" — bad args wouldn't execute regardless, so we
      // emit a tool-error result and let the model retry instead of capturing.
      const missing = validateRequiredParams(tool, args)
      if (missing.length > 0) {
        const errMsg = `Missing required parameters: ${missing.join(', ')}. Please provide all required parameters.`
        events.push({
          type: 'tool-started',
          agent: agentName,
          tool: toolName,
          toolCallId: toolCall.id,
          args,
        })
        events.push({
          type: 'tool-error',
          agent: agentName,
          tool: toolName,
          toolCallId: toolCall.id,
          error: errMsg,
        })
        results.push({
          toolCallId: toolCall.id,
          toolName,
          output: { error: errMsg },
          success: false,
          error: errMsg,
          captured: false,
        })
        continue
      }

      const localIndex = nextLocalIndex++
      let minted: unknown = { status: 'queued_for_approval' }
      if (tool.captureMint) {
        try {
          minted = tool.captureMint(args, { localIndex })
        } catch (err) {
          logger.warn('captureMint threw, using placeholder', {
            tool: toolName,
            error: err instanceof Error ? err.message : String(err),
          })
          minted = { status: 'queued_for_approval' }
        }
      }

      const predictedOutput =
        typeof minted === 'object' && minted !== null
          ? { _captured: true, ...(minted as Record<string, unknown>) }
          : { _captured: true, value: minted }

      const summary = safeSummary(tool, args)

      capturedActions.push({
        toolCallId: toolCall.id,
        toolName,
        args,
        summary,
        localIndex,
        predictedOutput,
      })

      events.push({
        type: 'tool-started',
        agent: agentName,
        tool: toolName,
        toolCallId: toolCall.id,
        args,
      })
      events.push({
        type: 'tool-completed',
        agent: agentName,
        tool: toolName,
        toolCallId: toolCall.id,
        result: { success: true, output: predictedOutput },
      })
      logger.info('Tool captured (no execute)', {
        agent: agentName,
        tool: toolName,
        localIndex,
        summary,
        predictedOutput: previewValue(predictedOutput),
      })
      results.push({
        toolCallId: toolCall.id,
        toolName,
        output: predictedOutput,
        success: true,
        captured: true,
      })
      continue
    }

    // Non-approval tool — execute normally, mirroring executeToolCalls.
    const cacheKey = tool.idempotent ? `${toolName}::${stableStringify(args)}` : null
    if (cacheKey) {
      const cached = idempotentCache.get(cacheKey)
      if (cached) {
        events.push({
          type: 'tool-started',
          agent: agentName,
          tool: toolName,
          toolCallId: toolCall.id,
          args,
        })
        events.push({
          type: 'tool-completed',
          agent: agentName,
          tool: toolName,
          toolCallId: toolCall.id,
          result: {
            success: cached.success,
            output: cached.output,
            error: cached.error,
            blocks: cached.blocks,
          },
          digest: cached.digest,
        })
        results.push({
          toolCallId: toolCall.id,
          toolName,
          output: cached.output,
          success: cached.success,
          error: cached.error,
          blocks: cached.blocks,
          digest: cached.digest,
          captured: false,
        })
        continue
      }
    }

    events.push({
      type: 'tool-started',
      agent: agentName,
      tool: toolName,
      toolCallId: toolCall.id,
      args,
    })

    try {
      const result = await tool.execute(args, ctx)
      const digest = result.success ? buildToolDigest(tool, result.output, logger) : undefined
      events.push({
        type: 'tool-completed',
        agent: agentName,
        tool: toolName,
        toolCallId: toolCall.id,
        result,
        digest,
      })
      logger.info('Tool result (capture)', {
        agent: agentName,
        tool: toolName,
        success: result.success,
        error: result.error,
        output: previewValue(result.output),
        blocks: result.blocks?.map((b) => b.type),
      })
      const execResult: CaptureExecResult = {
        toolCallId: toolCall.id,
        toolName,
        output: result.output,
        success: result.success,
        error: result.error,
        blocks: result.blocks,
        digest,
        captured: false,
      }
      results.push(execResult)
      if (cacheKey && result.success) idempotentCache.set(cacheKey, execResult)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      events.push({
        type: 'tool-error',
        agent: agentName,
        tool: toolName,
        toolCallId: toolCall.id,
        error: errorMsg,
      })
      results.push({
        toolCallId: toolCall.id,
        toolName,
        output: { error: errorMsg },
        success: false,
        error: errorMsg,
        captured: false,
      })
    }
  }

  return { events, results, capturedActions }
}

function safeSummary(tool: AgentToolDefinition, args: Record<string, unknown>): string {
  if (tool.summary) {
    try {
      return tool.summary(args)
    } catch (err) {
      logger.warn('tool.summary threw, using fallback', {
        tool: tool.name,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  const argsStr = JSON.stringify(args)
  const truncated = argsStr.length > 80 ? `${argsStr.slice(0, 80)}…` : argsStr
  return `${tool.name}(${truncated})`
}
