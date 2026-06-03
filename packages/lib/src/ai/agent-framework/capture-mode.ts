// packages/lib/src/ai/agent-framework/capture-mode.ts

import { createScopedLogger } from '@auxx/logger'
import type { ToolCall } from '../clients/base/types'
import type { ToolContext } from './tool-context'
import type { AgentEvent, AgentToolDefinition, CapturedAction } from './types'
import {
  buildToolDigest,
  executeToolWithProgress,
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
 *   so the conversation history stays valid for subsequent turns AND
 *   the model can reference predicted IDs in chained captured calls.
 * - Non-approval → execute normally, identical semantics to `executeToolCalls`.
 *
 * Events emitted here use the new message-scoped variants (`tool-call-started`,
 * `tool-call-completed`, `tool-call-failed`). `messageId` / `partIndex` are
 * placeholders (`''` / `-1`) — `query-loop` patches them in based on the
 * tool call index in `toolCalls[]` before forwarding to the consumer.
 *
 * `localIndex` is monotonic across the entire engine run.
 */
export async function processCaptureToolCalls(
  toolCalls: ToolCall[],
  agentTools: AgentToolDefinition[],
  agentName: string,
  ctx: ToolContext,
  idempotentCache: Map<string, ToolExecResult>,
  existingCaptures: CapturedAction[],
  transformInput?: (toolName: string, args: Record<string, unknown>) => Record<string, unknown>,
  applyToolRestrictions?: (
    toolName: string,
    args: Record<string, unknown>,
    ctx: ToolContext
  ) => Promise<{ ok: true; args: Record<string, unknown> } | { ok: false; error: string }>
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
    let args = parseToolArgs(toolCall)
    if (transformInput) args = transformInput(toolName, args)

    if (!tool) {
      events.push(toolStartedEvent(toolCall.id, toolName, agentName, args))
      const errorMsg = `Unknown tool: ${toolName}`
      events.push(toolFailedEvent(toolCall.id, agentName, errorMsg))
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
      // Validate required params first.
      const missing = validateRequiredParams(tool, args)
      if (missing.length > 0) {
        const errMsg = `Missing required parameters: ${missing.join(', ')}. Please provide all required parameters.`
        events.push(toolStartedEvent(toolCall.id, toolName, agentName, args))
        events.push(toolFailedEvent(toolCall.id, agentName, errMsg))
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

      // Per-agent restriction clamp (capture, approval-required).
      if (applyToolRestrictions) {
        const r = await applyToolRestrictions(toolName, args, ctx)
        if (!r.ok) {
          events.push(toolStartedEvent(toolCall.id, toolName, agentName, args))
          events.push(toolFailedEvent(toolCall.id, agentName, r.error))
          logger.info('applyToolRestrictions refused (capture, approval-required)', {
            agent: agentName,
            tool: toolName,
            error: r.error,
          })
          results.push({
            toolCallId: toolCall.id,
            toolName,
            output: { error: r.error },
            success: false,
            error: r.error,
            captured: false,
          })
          continue
        }
        args = r.args
      }

      if (tool.validateInputs) {
        const v = await tool.validateInputs(args, ctx)
        if (!v.ok) {
          events.push(toolStartedEvent(toolCall.id, toolName, agentName, args))
          events.push(toolFailedEvent(toolCall.id, agentName, v.error))
          logger.info('validateInputs rejected (capture, approval-required)', {
            agent: agentName,
            tool: toolName,
            error: v.error,
          })
          results.push({
            toolCallId: toolCall.id,
            toolName,
            output: { error: v.error },
            success: false,
            error: v.error,
            captured: false,
          })
          continue
        }
        if (v.warnings?.length) {
          logger.info('validateInputs warnings (capture, approval)', {
            agent: agentName,
            tool: toolName,
            warnings: v.warnings,
          })
        }
        args = v.args
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

      events.push(toolStartedEvent(toolCall.id, toolName, agentName, args))
      events.push({
        type: 'tool-call-completed',
        messageId: '',
        partIndex: -1,
        toolCallId: toolCall.id,
        agent: agentName,
        output: predictedOutput,
        captured: true,
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

    // Non-approval tool — execute normally.
    // Per-agent restriction clamp (capture, non-approval).
    if (applyToolRestrictions) {
      const r = await applyToolRestrictions(toolName, args, ctx)
      if (!r.ok) {
        events.push(toolStartedEvent(toolCall.id, toolName, agentName, args))
        events.push(toolFailedEvent(toolCall.id, agentName, r.error))
        logger.info('applyToolRestrictions refused (capture, non-approval)', {
          agent: agentName,
          tool: toolName,
          error: r.error,
        })
        results.push({
          toolCallId: toolCall.id,
          toolName,
          output: { error: r.error },
          success: false,
          error: r.error,
          captured: false,
        })
        continue
      }
      args = r.args
    }

    if (tool.validateInputs) {
      const v = await tool.validateInputs(args, ctx)
      if (!v.ok) {
        events.push(toolStartedEvent(toolCall.id, toolName, agentName, args))
        events.push(toolFailedEvent(toolCall.id, agentName, v.error))
        logger.info('validateInputs rejected (capture, non-approval)', {
          agent: agentName,
          tool: toolName,
          error: v.error,
        })
        results.push({
          toolCallId: toolCall.id,
          toolName,
          output: { error: v.error },
          success: false,
          error: v.error,
          captured: false,
        })
        continue
      }
      if (v.warnings?.length) {
        logger.info('validateInputs warnings (capture, non-approval)', {
          agent: agentName,
          tool: toolName,
          warnings: v.warnings,
        })
      }
      args = v.args
    }

    const cacheKey = tool.idempotent ? `${toolName}::${stableStringify(args)}` : null
    if (cacheKey) {
      const cached = idempotentCache.get(cacheKey)
      if (cached) {
        events.push(toolStartedEvent(toolCall.id, toolName, agentName, args))
        if (cached.success) {
          events.push({
            type: 'tool-call-completed',
            messageId: '',
            partIndex: -1,
            toolCallId: toolCall.id,
            agent: agentName,
            output: cached.output,
            ...(cached.digest !== undefined ? { digest: cached.digest } : {}),
          })
        } else {
          events.push(toolFailedEvent(toolCall.id, agentName, cached.error ?? 'Unknown error'))
        }
        results.push({
          toolCallId: toolCall.id,
          toolName,
          output: cached.output,
          success: cached.success,
          error: cached.error,
          digest: cached.digest,
          captured: false,
        })
        continue
      }
    }

    events.push(toolStartedEvent(toolCall.id, toolName, agentName, args))

    try {
      // Capture mode is the headless / autonomous path — silently drain
      // streaming tools (no progress consumer).
      const result = await executeToolWithProgress(tool, args, ctx)
      const digest = result.success ? buildToolDigest(tool, result.output, logger) : undefined
      if (result.success) {
        events.push({
          type: 'tool-call-completed',
          messageId: '',
          partIndex: -1,
          toolCallId: toolCall.id,
          agent: agentName,
          output: result.output,
          ...(digest !== undefined ? { digest } : {}),
        })
      } else {
        events.push(toolFailedEvent(toolCall.id, agentName, result.error ?? 'Unknown error'))
      }
      logger.info('Tool result (capture)', {
        agent: agentName,
        tool: toolName,
        success: result.success,
        error: result.error,
        output: previewValue(result.output),
      })
      const execResult: CaptureExecResult = {
        toolCallId: toolCall.id,
        toolName,
        output: result.output,
        success: result.success,
        error: result.error,
        digest,
        captured: false,
      }
      results.push(execResult)
      if (cacheKey && result.success) idempotentCache.set(cacheKey, execResult)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      events.push(toolFailedEvent(toolCall.id, agentName, errorMsg))
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

function toolStartedEvent(
  toolCallId: string,
  name: string,
  agentName: string,
  args: Record<string, unknown>
): AgentEvent {
  return {
    type: 'tool-call-started',
    messageId: '',
    partIndex: -1,
    toolCallId,
    name,
    agent: agentName,
    args,
  }
}

function toolFailedEvent(toolCallId: string, agentName: string, error: string): AgentEvent {
  return {
    type: 'tool-call-failed',
    messageId: '',
    partIndex: -1,
    toolCallId,
    agent: agentName,
    error,
  }
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
