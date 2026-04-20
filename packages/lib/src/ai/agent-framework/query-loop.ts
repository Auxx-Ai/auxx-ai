// packages/lib/src/ai/agent-framework/query-loop.ts

import { createScopedLogger } from '@auxx/logger'
import type { ToolCall } from '../clients/base/types'
import type {
  AgentDefinition,
  AgentDeps,
  AgentEngineConfig,
  AgentEvent,
  AgentState,
  AgentToolDefinition,
  LLMCallParams,
} from './types'

const logger = createScopedLogger('agent-query-loop')
const DEFAULT_MAX_ITERATIONS = 10

/**
 * Core agent query loop — standalone async generator.
 *
 * Calls agent.buildMessages() → callModel() → collect tool calls → execute → loop.
 * Yields AgentEvent for every phase: llm-stream, tool-started, tool-completed, tool-error.
 *
 * One-shot agents (tools=[], maxIterations=1) and looping agents use the same code path.
 */
export async function* agentQueryLoop(
  agent: AgentDefinition,
  state: AgentState,
  config: AgentEngineConfig
): AsyncGenerator<AgentEvent, AgentState> {
  const maxIterations = agent.maxIterations ?? DEFAULT_MAX_ITERATIONS
  const deps: AgentDeps = {
    organizationId: config.organizationId,
    userId: config.userId,
    sessionId: config.sessionId,
    signal: config.signal,
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
  logger.info('Agent started', { agent: agent.name, maxIterations, toolCount: agent.tools.length })

  while (iteration < maxIterations) {
    // Check abort
    if (config.signal?.aborted) {
      logger.info('Agent aborted', { agent: agent.name, iteration })
      break
    }

    iteration++

    // Build messages from current state
    const messages = await agent.buildMessages(currentState, deps)
    logger.debug('LLM call', {
      agent: agent.name,
      iteration,
      messageCount: messages.length,
    })

    // Build LLM call params
    const callParams: LLMCallParams = {
      model: agent.model ?? config.domainConfig.defaultModel,
      provider: agent.provider ?? config.domainConfig.defaultProvider,
      messages,
      tools: agent.tools.length > 0 ? agentToolsToLLMTools(agent.tools) : undefined,
      parameters: agent.parameters,
      responseFormat: agent.responseFormat,
      signal: config.signal,
    }

    // Call the model and stream events
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
            // Collected in the done event
            break
          case 'usage':
            // Will be included in done
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
      logger.error('LLM error', { agent: agent.name, iteration, error: errorMessage })
      yield { type: 'pipeline-error', error: `LLM error in ${agent.name}: ${errorMessage}` }
      break
    }

    // No tool calls — one-shot or final response
    if (toolCalls.length === 0) {
      // If minimum tool calls not met, inject a nudge and retry
      if (totalToolCallCount < minToolCalls && iteration < maxIterations) {
        logger.warn('Agent returned text without meeting minimum tool calls, nudging', {
          agent: agent.name,
          minToolCalls,
          actualToolCalls: totalToolCallCount,
          iteration,
          contentPreview: content.slice(0, 200),
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

      if (totalToolCallCount < minToolCalls) {
        logger.warn('Agent exited without meeting minimum tool calls', {
          agent: agent.name,
          minToolCalls,
          actualToolCalls: totalToolCallCount,
          iteration,
          contentPreview: content.slice(0, 200),
        })
      }

      logger.debug('Agent one-shot result', {
        agent: agent.name,
        contentLength: content.length,
        hasContent: content.length > 0,
        contentPreview: content.slice(0, 300),
      })
      currentState = await agent.processResult(content, toolCalls, currentState, deps)
      break
    }

    // Execute tool calls
    totalToolCallCount += toolCalls.length
    logger.info('Executing tools', {
      agent: agent.name,
      tools: toolCalls.map((tc) => tc.function.name),
    })
    const toolResults = await executeToolCalls(
      toolCalls,
      agent.tools,
      agent.name,
      deps,
      config,
      idempotentCache
    )
    for (const event of toolResults.events) {
      yield event
    }

    // Build tool result messages and add to state — must happen before the
    // approval check so the assistant tool-call message is always persisted.
    const toolResultMessages = toolResults.results.map((r) => ({
      role: 'tool' as const,
      content: JSON.stringify(
        r.success ? r.output : { error: r.error ?? 'Unknown error', output: r.output }
      ),
      toolCallId: r.toolCallId,
      timestamp: Date.now(),
      metadata: { agent: agent.name },
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

    // Check if any tool requires approval (HITL)
    const approvalTool = findApprovalTool(toolCalls, agent.tools)
    if (approvalTool) {
      const approvalArgs = parseToolArgs(approvalTool)
      const toolDef = agent.tools.find((t) => t.name === approvalTool.function.name)

      // Validate required params before showing approval — if missing, return
      // an error so the LLM can retry with correct args instead of showing an
      // empty approval card.
      const missingParams = validateRequiredParams(toolDef, approvalArgs)
      if (missingParams.length > 0) {
        logger.warn('Approval tool missing required params, returning error to LLM', {
          agent: agent.name,
          tool: approvalTool.function.name,
          missingParams,
          args: approvalArgs,
        })
        const errorContent = JSON.stringify({
          error: `Missing required parameters: ${missingParams.join(', ')}. Please provide all required parameters.`,
          output: null,
        })
        // Replace the fake "awaiting_approval" tool result already in state
        // with an error so the LLM can retry with correct args.
        currentState = {
          ...currentState,
          messages: currentState.messages.map((m) =>
            m.role === 'tool' && m.toolCallId === approvalTool.id
              ? { ...m, content: errorContent }
              : m
          ),
        }
        continue
      }

      logger.info('Approval required', {
        agent: agent.name,
        tool: approvalTool.function.name,
        args: approvalArgs,
      })
      yield {
        type: 'approval-required',
        agent: agent.name,
        tool: approvalTool.function.name,
        toolCallId: approvalTool.id,
        args: approvalArgs,
      }
      // Let processResult update state (e.g. mark as waiting)
      currentState = await agent.processResult(content, toolCalls, currentState, deps)
      currentState = {
        ...currentState,
        waitingForApproval: true,
        pendingToolCall: {
          toolCallId: approvalTool.id,
          toolName: approvalTool.function.name,
          agentName: agent.name,
          args: approvalArgs,
        },
      }
      break
    }

    // Let the agent process intermediate results
    currentState = await agent.processResult(content, toolCalls, currentState, deps)
  }

  yield { type: 'agent-completed', agent: agent.name }
  logger.info('Agent completed', { agent: agent.name, iterations: iteration })

  return currentState
}

// ===== HELPERS =====

interface ToolExecResult {
  toolCallId: string
  toolName: string
  output: unknown
  success: boolean
  error?: string
}

/**
 * Check that all `required` params from the tool's JSON Schema are present in the parsed args.
 * Returns the list of missing parameter names (empty if valid).
 */
function validateRequiredParams(
  toolDef: AgentToolDefinition | undefined,
  args: Record<string, unknown>
): string[] {
  if (!toolDef) return []
  const required = toolDef.parameters?.required
  if (!Array.isArray(required)) return []
  return required.filter((param: string) => !(param in args))
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

function parseToolArgs(toolCall: ToolCall): Record<string, unknown> {
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
  deps: AgentDeps,
  config: AgentEngineConfig,
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

    // Skip execution and events for approval-required tools — the approval
    // flow handles its own tool-started/completed events on resume.
    if (tool.requiresApproval) {
      results.push({
        toolCallId: toolCall.id,
        toolName,
        output: { status: 'awaiting_approval' },
        success: true,
      })
      continue
    }

    // Per-turn cache for read-only tools: if the LLM re-requests the same
    // (tool, args) pair within the loop, return the earlier result instead of
    // re-executing. The toolCallId is fresh so the LLM gets a valid tool_call_id
    // pairing, but no DB/API work is repeated.
    const cacheKey = tool.idempotent ? `${toolName}::${stableStringify(args)}` : null
    if (cacheKey) {
      const cached = idempotentCache.get(cacheKey)
      if (cached) {
        events.push({ type: 'tool-started', agent: agentName, tool: toolName, args })
        events.push({
          type: 'tool-completed',
          agent: agentName,
          tool: toolName,
          result: { success: cached.success, output: cached.output, error: cached.error },
        })
        results.push({
          toolCallId: toolCall.id,
          toolName,
          output: cached.output,
          success: cached.success,
          error: cached.error,
        })
        continue
      }
    }

    events.push({ type: 'tool-started', agent: agentName, tool: toolName, args })

    try {
      const result = await tool.execute(args, deps)
      events.push({ type: 'tool-completed', agent: agentName, tool: toolName, result })
      const execResult: ToolExecResult = {
        toolCallId: toolCall.id,
        toolName,
        output: result.output,
        success: result.success,
        error: result.error,
      }
      results.push(execResult)
      if (cacheKey && result.success) idempotentCache.set(cacheKey, execResult)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      events.push({ type: 'tool-error', agent: agentName, tool: toolName, error: errorMsg })
      // Feed error back as tool result so the LLM can recover
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
 * Deterministic JSON.stringify — sorts object keys so `{a:1,b:2}` and
 * `{b:2,a:1}` produce the same cache key.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
  return `{${entries.join(',')}}`
}
