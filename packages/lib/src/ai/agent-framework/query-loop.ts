// packages/lib/src/ai/agent-framework/query-loop.ts

import { createScopedLogger } from '@auxx/logger'
import type { ToolCall } from '../clients/base/types'
import { processCaptureToolCalls } from './capture-mode'
import type { ToolContext } from './tool-context'
import type {
  AgentDefinition,
  AgentEngineConfig,
  AgentEvent,
  AgentState,
  AgentToolDefinition,
  AgentToolResult,
  LLMCallParams,
} from './types'
import {
  buildToolDigest,
  needsApproval,
  parseToolArgs,
  previewValue,
  stableStringify,
  type ToolExecResult,
  validateRequiredParams,
} from './utils'

const logger = createScopedLogger('agent-query-loop')
const DEFAULT_MAX_ITERATIONS = 10

/**
 * Core agent query loop — standalone async generator.
 *
 * Calls agent.buildMessages() → callModel() → collect tool calls → execute → loop.
 * Yields AgentEvent for every phase: llm-stream, tool-started, tool-completed, tool-error.
 *
 * One-shot agents (tools=[], maxIterations=1) and looping agents use the same code path.
 *
 * Termination: the loop exits when the LLM returns a response with no tool
 * calls — that response's content becomes the turn's final answer (post-
 * processed via `domainConfig.postProcessFinalContent` and emitted as a
 * `final-message` event).
 */
export async function* agentQueryLoop(
  agent: AgentDefinition,
  state: AgentState,
  config: AgentEngineConfig,
  turnId?: string
): AsyncGenerator<AgentEvent, AgentState> {
  const maxIterations = agent.maxIterations ?? DEFAULT_MAX_ITERATIONS
  const ctx: ToolContext = {
    db: config.db,
    organizationId: config.organizationId,
    userId: config.userId,
    sessionId: config.sessionId,
    signal: config.signal,
    turnId,
    traceId: turnId,
  }

  const minToolCalls = agent.minToolCalls ?? 0

  let currentState = state
  let iteration = 0
  let totalToolCallCount = 0

  /**
   * Per-turn cache of idempotent tool results. Keyed by "toolName::sortedArgsJson".
   * Prevents the LLM from paying twice to re-run the same read-only lookup
   * within a single agent loop (e.g. calling search_entities with the same
   * query on two consecutive iterations).
   */
  const idempotentCache = new Map<string, ToolExecResult>()

  yield { type: 'agent-started', agent: agent.name }
  logger.info('Agent started', {
    turnId,
    agent: agent.name,
    maxIterations,
    toolCount: agent.tools.length,
  })

  while (iteration < maxIterations) {
    if (config.signal?.aborted) {
      logger.info('Agent aborted', { turnId, agent: agent.name, iteration })
      break
    }

    iteration++

    // Build messages from current state
    const messages = await agent.buildMessages(currentState, ctx)
    logger.debug('LLM call', {
      turnId,
      agent: agent.name,
      iteration,
      messageCount: messages.length,
    })

    const callParams: LLMCallParams = {
      model: agent.model ?? config.domainConfig.defaultModel,
      provider: agent.provider ?? config.domainConfig.defaultProvider,
      messages,
      tools: agent.tools.length > 0 ? agentToolsToLLMTools(agent.tools) : undefined,
      parameters: agent.parameters,
      responseFormat: agent.responseFormat,
      signal: config.signal,
    }

    let content = ''
    let toolCalls: ToolCall[] = []
    let reasoningContent: string | undefined

    try {
      for await (const event of config.callModel(callParams)) {
        switch (event.type) {
          case 'text-delta':
            yield { type: 'llm-stream', agent: agent.name, delta: event.delta }
            break
          case 'reasoning-delta':
            yield { type: 'llm-reasoning-stream', agent: agent.name, delta: event.delta }
            break
          case 'tool-call':
            break
          case 'usage':
            break
          case 'done':
            content = event.content
            toolCalls = event.toolCalls
            reasoningContent = event.reasoning_content
            yield {
              type: 'llm-complete',
              agent: agent.name,
              content: event.content,
              usage: event.usage,
              provider: callParams.provider,
              model: callParams.model,
              providerType: event.providerType,
              credentialSource: event.credentialSource,
            }
            break
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('LLM error', { turnId, agent: agent.name, iteration, error: errorMessage })
      yield { type: 'turn-error', error: `LLM error in ${agent.name}: ${errorMessage}` }
      break
    }

    // No tool calls — one-shot or final response
    if (toolCalls.length === 0) {
      if (totalToolCallCount < minToolCalls && iteration < maxIterations) {
        logger.warn('Agent returned text without meeting minimum tool calls, nudging', {
          turnId,
          agent: agent.name,
          minToolCalls,
          actualToolCalls: totalToolCallCount,
          iteration,
        })
        currentState = {
          ...currentState,
          messages: [
            ...currentState.messages,
            {
              role: 'assistant' as const,
              content,
              reasoning_content: reasoningContent || undefined,
              timestamp: Date.now(),
              metadata: {
                agent: agent.name,
                modelId: `${callParams.provider}:${callParams.model}`,
              },
            },
            {
              role: 'user' as const,
              content:
                'You must use tools to complete this task. Do not write the result as text — call the appropriate tool now.',
              timestamp: Date.now(),
              metadata: { agent: agent.name, synthetic: true },
            },
          ],
        }
        continue
      }

      logger.debug('Agent one-shot result', {
        turnId,
        agent: agent.name,
        contentLength: content.length,
      })

      // The LLM stopped calling tools — that's the turn's terminator. Run the
      // domain post-process (snapshot injection, link-snapshot extraction) and
      // persist + emit a final-message event so the frontend commits the
      // canonical content.
      if (content.length > 0) {
        const processed = config.domainConfig.postProcessFinalContent
          ? config.domainConfig.postProcessFinalContent(content, currentState)
          : { content }
        const finalContent = processed.content

        yield {
          type: 'final-message',
          agent: agent.name,
          content: finalContent,
          ...(processed.linkSnapshots ? { linkSnapshots: processed.linkSnapshots } : {}),
        }

        currentState = {
          ...currentState,
          messages: [
            ...currentState.messages,
            {
              role: 'assistant' as const,
              content: finalContent,
              reasoning_content: reasoningContent || undefined,
              timestamp: Date.now(),
              metadata: {
                agent: agent.name,
                modelId: `${callParams.provider}:${callParams.model}`,
                final: true,
              },
              ...(processed.linkSnapshots ? { linkSnapshots: processed.linkSnapshots } : {}),
            },
          ],
        }
        currentState = await agent.processResult(finalContent, toolCalls, currentState, ctx)
      } else {
        currentState = await agent.processResult(content, toolCalls, currentState, ctx)
      }
      break
    }

    totalToolCallCount += toolCalls.length
    logger.info('Executing tools', {
      turnId,
      agent: agent.name,
      tools: toolCalls.map((tc) => ({
        name: tc.function.name,
        args: previewValue(parseToolArgs(tc)),
      })),
    })

    // Capture mode (headless kopilot): never pause. Approval-required tools
    // are recorded into state.capturedActions with a synthetic `_captured: true`
    // result, and the loop continues until the model returns no tool calls.
    // Read-only tools execute normally.
    if (config.approvalMode === 'capture') {
      const captureRun = await processCaptureToolCalls(
        toolCalls,
        agent.tools,
        agent.name,
        ctx,
        idempotentCache,
        currentState.capturedActions ?? []
      )
      for (const event of captureRun.events) yield event

      if (config.domainConfig.onToolResult) {
        for (const r of captureRun.results) {
          if (!r.success || r.captured) continue
          const toolResult: AgentToolResult = {
            success: r.success,
            output: r.output,
            error: r.error,
          }
          currentState = config.domainConfig.onToolResult(r.toolName, toolResult, currentState)
        }
      }

      const toolResultMessages = captureRun.results.map((r) => ({
        role: 'tool' as const,
        content: JSON.stringify(
          r.success ? r.output : { error: r.error ?? 'Unknown error', output: r.output }
        ),
        toolCallId: r.toolCallId,
        timestamp: Date.now(),
        metadata: { agent: agent.name, ...(r.captured ? { captured: true } : {}) },
        toolStatus: (r.success ? 'completed' : 'error') as 'completed' | 'error',
        ...(r.digest !== undefined ? { digest: r.digest } : {}),
      }))

      const assistantMessage = {
        role: 'assistant' as const,
        content,
        toolCalls,
        reasoning_content: reasoningContent || undefined,
        timestamp: Date.now(),
        metadata: {
          agent: agent.name,
          modelId: `${callParams.provider}:${callParams.model}`,
        },
      }

      currentState = {
        ...currentState,
        messages: [...currentState.messages, assistantMessage, ...toolResultMessages],
        capturedActions: [...(currentState.capturedActions ?? []), ...captureRun.capturedActions],
      }

      currentState = await agent.processResult(content, toolCalls, currentState, ctx)
      continue
    }

    // Before executing, check if any tool requires approval. If so, we emit the
    // assistant message with tool_calls, then the approval-required event, and
    // stop the loop — waiting for engine.resume() to continue. We do NOT write
    // a fake "awaiting_approval" tool result message (fixes F7, F23).
    const approvalTool = findApprovalTool(toolCalls, agent.tools)
    if (approvalTool) {
      let approvalArgs = parseToolArgs(approvalTool)
      const toolDef = agent.tools.find((t) => t.name === approvalTool.function.name)
      const missingParams = validateRequiredParams(toolDef, approvalArgs)

      if (missingParams.length > 0) {
        logger.warn('Approval tool missing required params, returning error to LLM', {
          turnId,
          agent: agent.name,
          tool: approvalTool.function.name,
          missingParams,
        })
        // Persist the assistant message + synthetic error tool result so the LLM
        // can retry with complete args on the next iteration. toolCalls is
        // rewritten to [approvalTool] so sibling auto-tool calls in the same
        // response can't dangle (we only synthesize a result for approvalTool).
        const errorContent = JSON.stringify({
          error: `Missing required parameters: ${missingParams.join(', ')}. Please provide all required parameters.`,
          output: null,
        })
        currentState = {
          ...currentState,
          messages: [
            ...currentState.messages,
            {
              role: 'assistant' as const,
              content,
              toolCalls: [approvalTool],
              reasoning_content: reasoningContent || undefined,
              timestamp: Date.now(),
              metadata: {
                agent: agent.name,
                modelId: `${callParams.provider}:${callParams.model}`,
              },
            },
            {
              role: 'tool' as const,
              content: errorContent,
              toolCallId: approvalTool.id,
              timestamp: Date.now(),
              metadata: { agent: agent.name, validationError: true },
            },
          ],
        }
        continue
      }

      // Pre-pause input validation. If the args are recoverable, the
      // validator rewrites them and the user sees a clean approval card. If
      // they're not, we surface a synthetic error tool message and let the
      // LLM retry without bothering the user — same shape as the
      // missing-params branch above.
      if (toolDef?.validateInputs) {
        const v = await toolDef.validateInputs(approvalArgs, ctx)
        if (!v.ok) {
          logger.info('validateInputs rejected approval-required call', {
            turnId,
            agent: agent.name,
            tool: approvalTool.function.name,
            error: v.error,
          })
          const errorContent = JSON.stringify({ error: v.error, output: null })
          currentState = {
            ...currentState,
            messages: [
              ...currentState.messages,
              {
                role: 'assistant' as const,
                content,
                toolCalls: [approvalTool],
                reasoning_content: reasoningContent || undefined,
                timestamp: Date.now(),
                metadata: {
                  agent: agent.name,
                  modelId: `${callParams.provider}:${callParams.model}`,
                },
              },
              {
                role: 'tool' as const,
                content: errorContent,
                toolCallId: approvalTool.id,
                timestamp: Date.now(),
                metadata: { agent: agent.name, validationError: true },
              },
            ],
          }
          continue
        }
        if (v.warnings?.length) {
          logger.info('validateInputs warnings (pre-pause)', {
            tool: approvalTool.function.name,
            warnings: v.warnings,
          })
        }
        approvalArgs = v.args
      }

      logger.info('Approval required', {
        turnId,
        agent: agent.name,
        tool: approvalTool.function.name,
      })

      // Hold the assistant message on pendingToolCall instead of pushing it
      // into state.messages. The engine re-appends it atomically with the
      // tool result on resume, so state.messages is always provider-valid.
      // toolCalls is rewritten to [approvalTool] because the loop never
      // executes sibling auto-tool calls in the same response — including
      // them would create dangling tool_call_ids on resume.
      const assistantMessage = {
        role: 'assistant' as const,
        content,
        toolCalls: [approvalTool],
        reasoning_content: reasoningContent || undefined,
        timestamp: Date.now(),
        metadata: {
          agent: agent.name,
          modelId: `${callParams.provider}:${callParams.model}`,
        },
      }

      yield {
        type: 'approval-required',
        agent: agent.name,
        tool: approvalTool.function.name,
        toolCallId: approvalTool.id,
        args: approvalArgs,
      }

      currentState = await agent.processResult(content, toolCalls, currentState, ctx)
      currentState = {
        ...currentState,
        waitingForApproval: true,
        pendingToolCall: {
          toolCallId: approvalTool.id,
          toolName: approvalTool.function.name,
          agentName: agent.name,
          args: approvalArgs,
          assistantMessage,
        },
      }
      break
    }

    // Execute non-approval tool calls
    const toolResults = await executeToolCalls(
      toolCalls,
      agent.tools,
      agent.name,
      ctx,
      idempotentCache
    )
    for (const event of toolResults.events) {
      yield event
    }

    // Let the domain mine each tool result for state updates (e.g. snapshot extraction)
    if (config.domainConfig.onToolResult) {
      for (const r of toolResults.results) {
        if (!r.success) continue
        const toolResult: AgentToolResult = {
          success: r.success,
          output: r.output,
          error: r.error,
        }
        currentState = config.domainConfig.onToolResult(r.toolName, toolResult, currentState)
      }
    }

    const toolResultMessages = toolResults.results.map((r) => ({
      role: 'tool' as const,
      content: JSON.stringify(
        r.success ? r.output : { error: r.error ?? 'Unknown error', output: r.output }
      ),
      toolCallId: r.toolCallId,
      timestamp: Date.now(),
      metadata: { agent: agent.name },
      toolStatus: (r.success ? 'completed' : 'error') as 'completed' | 'error',
      ...(r.digest !== undefined ? { digest: r.digest } : {}),
    }))

    const assistantMessage = {
      role: 'assistant' as const,
      content,
      toolCalls,
      reasoning_content: reasoningContent || undefined,
      timestamp: Date.now(),
      metadata: {
        agent: agent.name,
        modelId: `${callParams.provider}:${callParams.model}`,
      },
    }

    currentState = {
      ...currentState,
      messages: [...currentState.messages, assistantMessage, ...toolResultMessages],
    }

    // Let the agent process intermediate results
    currentState = await agent.processResult(content, toolCalls, currentState, ctx)
  }

  yield { type: 'agent-completed', agent: agent.name }
  logger.info('Agent completed', { turnId, agent: agent.name, iterations: iteration })

  return currentState
}

// ===== HELPERS =====

function agentToolsToLLMTools(tools: AgentToolDefinition[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}

function findApprovalTool(
  toolCalls: ToolCall[],
  agentTools: AgentToolDefinition[]
): ToolCall | undefined {
  const toolMap = new Map(agentTools.map((t) => [t.name, t]))
  return toolCalls.find((tc) => {
    const tool = toolMap.get(tc.function.name)
    if (!tool) return false
    return needsApproval(tool, parseToolArgs(tc))
  })
}

async function executeToolCalls(
  toolCalls: ToolCall[],
  agentTools: AgentToolDefinition[],
  agentName: string,
  ctx: ToolContext,
  idempotentCache: Map<string, ToolExecResult>
): Promise<{ events: AgentEvent[]; results: ToolExecResult[] }> {
  const toolMap = new Map(agentTools.map((t) => [t.name, t]))
  const events: AgentEvent[] = []
  const results: ToolExecResult[] = []

  for (const toolCall of toolCalls) {
    const toolName = toolCall.function.name
    const tool = toolMap.get(toolName)
    let args = parseToolArgs(toolCall)

    if (!tool) {
      events.push({ type: 'tool-started', agent: agentName, tool: toolName, args })
      const errorMsg = `Unknown tool: ${toolName}`
      events.push({ type: 'tool-error', agent: agentName, tool: toolName, error: errorMsg })
      results.push({
        toolCallId: toolCall.id,
        toolName,
        output: { error: errorMsg },
        success: false,
        error: errorMsg,
      })
      continue
    }

    // Approval-required tools should never reach this executor — the loop handles
    // them before calling executeToolCalls. Guard just in case.
    if (needsApproval(tool, args)) {
      continue
    }

    // Input validation + normalization. Runs before the idempotent cache
    // lookup so two LLM calls passing equivalent-but-different input shapes
    // (e.g. raw vs. over-prefixed recordId) collapse to a single cache hit.
    if (tool.validateInputs) {
      const v = await tool.validateInputs(args, ctx)
      if (!v.ok) {
        events.push({
          type: 'tool-started',
          agent: agentName,
          tool: toolName,
          toolCallId: toolCall.id,
          args,
        })
        const errResult = { success: false, output: null, error: v.error }
        events.push({
          type: 'tool-completed',
          agent: agentName,
          tool: toolName,
          toolCallId: toolCall.id,
          result: errResult,
        })
        logger.info('validateInputs rejected', { agent: agentName, tool: toolName, error: v.error })
        results.push({
          toolCallId: toolCall.id,
          toolName,
          output: { error: v.error },
          success: false,
          error: v.error,
        })
        continue
      }
      if (v.warnings?.length) {
        logger.info('validateInputs warnings', {
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
          },
          digest: cached.digest,
        })
        results.push({
          toolCallId: toolCall.id,
          toolName,
          output: cached.output,
          success: cached.success,
          error: cached.error,
          digest: cached.digest,
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
      logger.info('Tool result', {
        agent: agentName,
        tool: toolName,
        success: result.success,
        error: result.error,
        output: previewValue(result.output),
      })
      const execResult: ToolExecResult = {
        toolCallId: toolCall.id,
        toolName,
        output: result.output,
        success: result.success,
        error: result.error,
        digest,
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
      logger.error('Tool threw', {
        agent: agentName,
        tool: toolName,
        error: errorMsg,
        stack: error instanceof Error ? error.stack : undefined,
      })
      results.push({
        toolCallId: toolCall.id,
        toolName,
        output: { error: errorMsg },
        success: false,
        error: errorMsg,
      })
    }
  }

  return { events, results }
}
