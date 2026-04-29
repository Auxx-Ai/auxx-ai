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
  parseToolArgs,
  stableStringify,
  type ToolExecResult,
  validateRequiredParams,
} from './utils'

const logger = createScopedLogger('agent-query-loop')
const DEFAULT_MAX_ITERATIONS = 10

/** Terminator marker returned by meta-tools like `submit_final_answer` */
const TERMINATOR_KEY = '__terminate'

/**
 * Core agent query loop — standalone async generator.
 *
 * Calls agent.buildMessages() → callModel() → collect tool calls → execute → loop.
 * Yields AgentEvent for every phase: llm-stream, tool-started, tool-completed, tool-error.
 *
 * One-shot agents (tools=[], maxIterations=1) and looping agents use the same code path.
 *
 * If a tool's output contains `{ __terminate: true, content }`, the loop yields a
 * `final-message` event and exits cleanly. This is how `submit_final_answer` ends a turn.
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

    // Per-tool-call arg buffers for streaming — only surfaced for meta-tools
    // like submit_final_answer where the arg text IS the user-facing content.
    const toolArgBuffers = new Map<string, { toolName?: string; lastContent: string }>()

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
          case 'tool-args-delta': {
            if (event.toolName !== 'submit_final_answer') break
            const prior = toolArgBuffers.get(event.toolCallId) ?? {
              toolName: event.toolName,
              lastContent: '',
            }
            const nextRaw = (prior as { raw?: string }).raw ?? ''
            const raw = nextRaw + event.argsDelta
            const extracted = extractContentFromPartialJson(raw)
            if (extracted.length > prior.lastContent.length) {
              const delta = extracted.slice(prior.lastContent.length)
              yield { type: 'final-message-delta', agent: agent.name, delta }
              prior.lastContent = extracted
            }
            ;(prior as { raw?: string }).raw = raw
            toolArgBuffers.set(event.toolCallId, prior)
            break
          }
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

      // The LLM ended the turn by typing text without calling the terminator
      // tool (`submit_final_answer`). Treat this as an implicit final answer:
      // run the same post-process pipeline a terminator would get (snapshot
      // injection, fallback fence auto-emit) and persist + emit a final-message
      // event so the frontend renders instead of showing nothing.
      if (content.length > 0) {
        const finalContent = config.domainConfig.postProcessFinalContent
          ? config.domainConfig.postProcessFinalContent(content, currentState)
          : content

        yield { type: 'final-message', agent: agent.name, content: finalContent }

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
      tools: toolCalls.map((tc) => tc.function.name),
    })

    // Capture mode (headless kopilot): never pause. Approval-required tools
    // are recorded into state.capturedActions with a synthetic `_captured: true`
    // result, and the loop continues until the model emits submit_final_answer
    // or runs out of tool calls. Read-only tools execute normally.
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
            blocks: r.blocks,
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
        ...(r.blocks && r.blocks.length > 0 ? { blocks: r.blocks } : {}),
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

      const terminator = captureRun.results.find((r) => isTerminatorResult(r.output))
      if (terminator) {
        const output = terminator.output as Record<string, unknown>
        const rawContent = typeof output.content === 'string' ? output.content : ''
        const finalContent = config.domainConfig.postProcessFinalContent
          ? config.domainConfig.postProcessFinalContent(rawContent, currentState)
          : rawContent
        yield {
          type: 'final-message',
          agent: agent.name,
          content: finalContent,
        }
        currentState = {
          ...currentState,
          messages: [
            ...currentState.messages,
            {
              role: 'assistant' as const,
              content: finalContent,
              timestamp: Date.now(),
              metadata: {
                agent: agent.name,
                modelId: `${callParams.provider}:${callParams.model}`,
                final: true,
              },
            },
          ],
        }
        currentState = await agent.processResult(finalContent, [], currentState, ctx)
        break
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
      const approvalArgs = parseToolArgs(approvalTool)
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
          blocks: r.blocks,
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
      ...(r.blocks && r.blocks.length > 0 ? { blocks: r.blocks } : {}),
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

    // Check for termination marker from meta-tools (e.g. submit_final_answer)
    const terminator = toolResults.results.find((r) => isTerminatorResult(r.output))
    if (terminator) {
      const output = terminator.output as Record<string, unknown>
      const rawContent = typeof output.content === 'string' ? output.content : ''
      // Let the domain post-process (inject snapshots, auto-emit fallback fences).
      const finalContent = config.domainConfig.postProcessFinalContent
        ? config.domainConfig.postProcessFinalContent(rawContent, currentState)
        : rawContent
      yield {
        type: 'final-message',
        agent: agent.name,
        content: finalContent,
      }
      // Persist the final prose as an assistant message so session restore is clean.
      currentState = {
        ...currentState,
        messages: [
          ...currentState.messages,
          {
            role: 'assistant' as const,
            content: finalContent,
            timestamp: Date.now(),
            metadata: {
              agent: agent.name,
              modelId: `${callParams.provider}:${callParams.model}`,
              final: true,
            },
          },
        ],
      }
      currentState = await agent.processResult(finalContent, [], currentState, ctx)
      break
    }

    // Let the agent process intermediate results
    currentState = await agent.processResult(content, toolCalls, currentState, ctx)
  }

  yield { type: 'agent-completed', agent: agent.name }
  logger.info('Agent completed', { turnId, agent: agent.name, iterations: iteration })

  return currentState
}

// ===== HELPERS =====

function isTerminatorResult(output: unknown): boolean {
  return (
    typeof output === 'object' &&
    output !== null &&
    (output as Record<string, unknown>)[TERMINATOR_KEY] === true
  )
}

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
  const approvalToolNames = new Set(agentTools.filter((t) => t.requiresApproval).map((t) => t.name))
  return toolCalls.find((tc) => approvalToolNames.has(tc.function.name))
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
    const args = parseToolArgs(toolCall)

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
    if (tool.requiresApproval) {
      continue
    }

    const cacheKey = tool.idempotent ? `${toolName}::${stableStringify(args)}` : null
    if (cacheKey) {
      const cached = idempotentCache.get(cacheKey)
      if (cached) {
        events.push({ type: 'tool-started', agent: agentName, tool: toolName, args })
        events.push({
          type: 'tool-completed',
          agent: agentName,
          tool: toolName,
          result: {
            success: cached.success,
            output: cached.output,
            error: cached.error,
            blocks: cached.blocks,
          },
        })
        results.push({
          toolCallId: toolCall.id,
          toolName,
          output: cached.output,
          success: cached.success,
          error: cached.error,
          blocks: cached.blocks,
        })
        continue
      }
    }

    events.push({ type: 'tool-started', agent: agentName, tool: toolName, args })

    try {
      const result = await tool.execute(args, ctx)
      events.push({ type: 'tool-completed', agent: agentName, tool: toolName, result })
      const execResult: ToolExecResult = {
        toolCallId: toolCall.id,
        toolName,
        output: result.output,
        success: result.success,
        error: result.error,
        blocks: result.blocks,
      }
      results.push(execResult)
      if (cacheKey && result.success) idempotentCache.set(cacheKey, execResult)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      events.push({ type: 'tool-error', agent: agentName, tool: toolName, error: errorMsg })
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

/**
 * Best-effort extraction of the `content` field from a streaming, potentially
 * incomplete JSON tool-args payload. Designed for `submit_final_answer` where
 * the model streams `{"content":"..."}` — we don't wait for a complete parse,
 * we just read characters of the content string as they arrive. Returns the
 * content captured so far (possibly empty).
 */
function extractContentFromPartialJson(raw: string): string {
  const marker = '"content"'
  const keyIdx = raw.indexOf(marker)
  if (keyIdx < 0) return ''
  let i = keyIdx + marker.length
  // Skip whitespace and colon
  while (i < raw.length && (raw[i] === ' ' || raw[i] === ':' || raw[i] === '\t' || raw[i] === '\n'))
    i++
  if (raw[i] !== '"') return ''
  i++
  let out = ''
  while (i < raw.length) {
    const ch = raw[i]
    if (ch === '\\') {
      const next = raw[i + 1]
      if (next === undefined) break
      if (next === 'n') out += '\n'
      else if (next === 't') out += '\t'
      else if (next === 'r') out += '\r'
      else if (next === '"') out += '"'
      else if (next === '\\') out += '\\'
      else if (next === '/') out += '/'
      else out += next
      i += 2
      continue
    }
    if (ch === '"') break
    out += ch
    i++
  }
  return out
}
