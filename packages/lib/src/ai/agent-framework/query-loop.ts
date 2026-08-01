// packages/lib/src/ai/agent-framework/query-loop.ts

import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils/generateId'
import type { ToolCall, UsageMetrics } from '../clients/base/types'
import { processCaptureToolCalls } from './capture-mode'
import { KopilotContextStore, readContextSlice, syncContextSlice } from './context'
import type { ToolContext } from './tool-context'
import type {
  AgentDefinition,
  AgentEngineConfig,
  AgentEvent,
  AgentState,
  AgentToolDefinition,
  AgentToolResult,
  AssistantSessionMessage,
  ContentPart,
  IterationUsage,
  LLMCallParams,
  PostProcessResult,
  TextPart,
  ThinkingPart,
  ToolCallPart,
} from './types'
import {
  buildToolDigest,
  needsApproval,
  parseToolArgs,
  previewArgs,
  previewValue,
  stableStringify,
  type ToolExecResult,
  validateRequiredParams,
} from './utils'

const logger = createScopedLogger('agent-query-loop')
const DEFAULT_MAX_ITERATIONS = 10
// Number of consecutive iterations in which the same tool fails (and only
// that tool runs) before we bail out of the turn.
const SAME_TOOL_FAILURE_LIMIT = 3
// Number of consecutive iterations in which the same tool SUCCEEDS with
// identical args (only that tool runs, and the model also emitted text)
// before we conclude the model is done and repeating itself, and finalize
// the turn gracefully with its text as the final reply.
const SAME_TOOL_SUCCESS_LIMIT = 3

/**
 * Core agent query loop — emits one assistant message per turn with a
 * `parts[]` array that interleaves `text`, `thinking`, and `tool_call` parts.
 *
 * Lifecycle:
 * 1. Emit `assistant-message-started` with a fresh `messageId`.
 * 2. For each LLM iteration: stream text/thinking deltas (extending the
 *    current open text/thinking part), execute tool calls, mutate the parts
 *    array in place, yield per-event SSE events scoped to `messageId`/`partIndex`.
 * 3. On no-tool-call termination, run `postProcessFinalContent` on the
 *    joined-text projection of all text parts. If the rewrite differs from
 *    the joined input, collapse every text part into a single `text` part
 *    at the position of the first text part, splicing out the rest.
 * 4. Emit `assistant-message-finished` with the FULL final parts array,
 *    `linkSnapshots`, and turn-total usage. This is the "checksum" that
 *    kills streaming/refresh divergence by construction.
 */
/**
 * Hint passed by the engine when continuing a paused assistant message —
 * skip the open-message events, append new parts to the existing message id,
 * and seed turn-cumulative counters so the message's metadata stays whole
 * across the pause boundary.
 */
export interface AgentQueryResumeHint {
  messageId: string
  parts: ContentPart[]
  turnUsage: UsageMetrics
  /** Iterations executed before the pause; preserved for message metadata. */
  iterations: IterationUsage[]
}

/**
 * Persist the kopilot context store's state (var:* scratch + turn captures)
 * into `domainState.__context` so it rides the existing domainState persistence
 * across turns and an approval pause. No-op for the workflow `ExecutionContextManager`,
 * which persists through the workflow engine instead.
 */
function syncStoreSlice(ctx: ToolContext, state: AgentState): AgentState {
  if (!(ctx.context instanceof KopilotContextStore)) return state
  const domainState = { ...(state.domainState as Record<string, unknown>) }
  syncContextSlice(domainState, ctx.context)
  return { ...state, domainState }
}

export async function* agentQueryLoop(
  agent: AgentDefinition,
  state: AgentState,
  config: AgentEngineConfig,
  turnId?: string,
  resumeFrom?: AgentQueryResumeHint
): AsyncGenerator<AgentEvent, AgentState> {
  const maxIterations = agent.maxIterations ?? DEFAULT_MAX_ITERATIONS
  const baseCtx = {
    db: config.db,
    organizationId: config.organizationId,
    userId: config.userId,
    sessionId: config.sessionId,
    signal: config.signal,
    turnId,
    traceId: turnId,
    workflow: config.workflow,
    subject: config.subject,
    appAccounts: config.appAccounts,
    agentName: agent.name,
    // Eval Simulations pin a frozen clock (`timeFrozenAt`); production uses the wall clock.
    now: config.nowMs ?? Date.now(),
    // Eval-only `startingFields` overlay; undefined on production (subject resolver reads anchors).
    evalFieldResolver: config.evalFieldResolver,
  }
  const ctx: ToolContext = {
    ...baseCtx,
    // Workflow AI nodes pass their live ExecutionContextManager via config.context;
    // every other caller gets a fresh store hydrated from domainState.__context.
    context:
      config.context ??
      new KopilotContextStore({
        ctx: baseCtx as ToolContext,
        initial: readContextSlice(state.domainState as Record<string, unknown>),
      }),
  }

  const minToolCalls = agent.minToolCalls ?? 0

  let currentState = state
  let iteration = 0
  let totalToolCallCount = 0
  let failingToolName: string | null = null
  let failingToolStreak = 0
  let repeatSuccessKey: string | null = null
  let repeatSuccessStreak = 0

  // Tools that terminate the turn when an iteration consists solely of
  // successful calls to them (see `AgentToolDefinition.endsTurn`).
  const endsTurnToolNames = new Set(agent.tools.filter((t) => t.endsTurn).map((t) => t.name))

  /** Per-turn cache of idempotent tool results. */
  const idempotentCache = new Map<string, ToolExecResult>()

  // Open a single assistant message for this entire agent run — or reuse
  // the paused message's id when resuming, so the frontend appends parts to
  // the existing bubble rather than rendering a new one.
  const messageId = resumeFrom?.messageId ?? generateId('msg')
  const parts: ContentPart[] = resumeFrom ? [...resumeFrom.parts] : []
  // Turn-total usage accumulator (rolled up onto the message metadata). On
  // resume we seed from the paused message's persisted usage so the metadata
  // stays cumulative across the pause boundary.
  const turnUsage: UsageMetrics = resumeFrom
    ? { ...resumeFrom.turnUsage }
    : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  // Per-LLM-call billing records, kept whole-turn for message metadata.
  const turnIterations: IterationUsage[] = resumeFrom ? [...resumeFrom.iterations] : []
  // Iterations executed in THIS segment only — what billing consumers drain
  // on the next `paused` / `finished` event. Reset across pause/resume so we
  // never double-charge for the pre-pause iterations.
  const segmentIterations: IterationUsage[] = []
  let lastModelId: string | undefined
  let truncated = false

  if (resumeFrom) {
    yield { type: 'assistant-message-resumed', messageId, agent: agent.name }
    logger.info('Agent resumed', {
      turnId,
      agent: agent.name,
      messageId,
      partsCarried: parts.length,
      maxIterations,
      toolCount: agent.tools.length,
    })
  } else {
    yield { type: 'agent-started', agent: agent.name }
    yield { type: 'assistant-message-started', messageId, agent: agent.name }
    logger.info('Agent started', {
      turnId,
      agent: agent.name,
      messageId,
      maxIterations,
      toolCount: agent.tools.length,
    })
  }

  /**
   * Commit the current parts into a draft assistant message so subsequent
   * `agent.buildMessages` calls see them — the wire-format helper expands
   * tool_call parts back into assistant+tool messages for the LLM.
   */
  const upsertAssistantMessage = (extra?: Partial<AssistantSessionMessage>): AgentState => {
    const draft: AssistantSessionMessage = {
      id: messageId,
      role: 'assistant',
      v: 1,
      parts: parts.map((p) => ({ ...p })),
      timestamp: Date.now(),
      metadata: {
        agent: agent.name,
        modelId: lastModelId,
      },
      ...extra,
    }
    const existing = currentState.messages.findIndex((m) => m.id === messageId)
    const next =
      existing === -1
        ? [...currentState.messages, draft]
        : currentState.messages.map((m) => (m.id === messageId ? draft : m))
    return { ...currentState, messages: next }
  }

  /**
   * Finalize the turn: run the domain post-process on the joined text
   * projection, collapse text parts if the rewrite differs, commit the
   * message with turn-total metadata, and return the terminal
   * `assistant-message-finished` event for the caller to yield before
   * breaking the loop. Pass `runProcessResult: false` on paths where
   * `agent.processResult` already ran for this iteration (the post-tool
   * paths call it right after tool execution) — it must not run twice.
   */
  const finalizeTurn = async (opts: {
    runProcessResult: boolean
    toolCalls: ToolCall[]
  }): Promise<AgentEvent> => {
    dropRestatedTextParts(parts)
    const joinedText = parts
      .filter((p): p is TextPart => p.type === 'text')
      .map((p) => p.text)
      .join('')

    let postProcessed: PostProcessResult | undefined
    if (config.domainConfig.postProcessFinalContent && joinedText.length > 0) {
      postProcessed = config.domainConfig.postProcessFinalContent(joinedText, currentState)
    }
    const finalText = postProcessed?.content ?? joinedText
    if (postProcessed && postProcessed.content !== joinedText) {
      collapseTextParts(parts, postProcessed.content, agent.name)
    }

    currentState = upsertAssistantMessage({
      linkSnapshots: postProcessed?.linkSnapshots,
      metadata: {
        agent: agent.name,
        modelId: lastModelId,
        usage: turnUsage,
        ...(truncated ? { truncated: true } : {}),
        ...(turnIterations.length > 0 ? { iterations: [...turnIterations] } : {}),
      },
    })
    if (opts.runProcessResult) {
      currentState = await agent.processResult(finalText, opts.toolCalls, currentState, ctx)
    }

    return {
      type: 'assistant-message-finished',
      messageId,
      agent: agent.name,
      parts: parts.map((p) => ({ ...p })),
      ...(postProcessed?.linkSnapshots ? { linkSnapshots: postProcessed.linkSnapshots } : {}),
      usage: turnUsage,
      ...(truncated ? { truncated: true } : {}),
      ...(segmentIterations.length > 0 ? { iterations: [...segmentIterations] } : {}),
    }
  }

  while (iteration < maxIterations) {
    if (config.signal?.aborted) {
      logger.info('Agent aborted', { turnId, agent: agent.name, iteration })
      break
    }

    iteration++

    // Push the in-progress assistant message into state so buildMessages
    // sees the prior parts of this same turn (multi-iteration tool chains).
    currentState = upsertAssistantMessage()

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
    lastModelId = `${callParams.provider}:${callParams.model}`

    // Per-iteration: open positions for text/thinking parts will be allocated
    // lazily on the first delta of each type.
    let openTextIdx = -1
    let openThinkingIdx = -1
    // Snapshot whether any thinking deltas streamed during this iteration —
    // governs the "trust deltas; fall back to terminal reasoning_content"
    // rule from §A.3.
    let sawThinkingDelta = false
    let content = ''
    let toolCalls: ToolCall[] = []
    let reasoningContent: string | undefined
    let iterUsage: UsageMetrics | undefined
    let finishReason: string | undefined

    try {
      for await (const event of config.callModel(callParams)) {
        switch (event.type) {
          case 'text-delta': {
            if (openTextIdx === -1 || parts[openTextIdx]?.type !== 'text') {
              const newPart: TextPart = {
                type: 'text',
                text: '',
                agent: agent.name,
              }
              parts.push(newPart)
              openTextIdx = parts.length - 1
            }
            const tp = parts[openTextIdx] as TextPart
            tp.text += event.delta
            yield {
              type: 'text-delta',
              messageId,
              partIndex: openTextIdx,
              delta: event.delta,
            }
            break
          }
          case 'reasoning-delta': {
            sawThinkingDelta = true
            if (openThinkingIdx === -1 || parts[openThinkingIdx]?.type !== 'thinking') {
              const newPart: ThinkingPart = {
                type: 'thinking',
                text: '',
                agent: agent.name,
              }
              parts.push(newPart)
              openThinkingIdx = parts.length - 1
            }
            const tp = parts[openThinkingIdx] as ThinkingPart
            tp.text += event.delta
            yield {
              type: 'thinking-delta',
              messageId,
              partIndex: openThinkingIdx,
              delta: event.delta,
            }
            break
          }
          case 'tool-call':
          case 'usage':
            break
          case 'done':
            content = event.content
            toolCalls = event.toolCalls
            reasoningContent = event.reasoning_content
            iterUsage = event.usage
            finishReason = event.finishReason
            // Capture per-call billing context. providerType / credentialSource
            // come from llm-adapter (set per-call by the underlying client).
            // Skip zero-usage iterations (cached / no-token calls).
            if (event.usage && (event.usage.total_tokens ?? 0) > 0) {
              const record: IterationUsage = {
                iteration,
                provider: callParams.provider,
                model: callParams.model,
                providerType: event.providerType as IterationUsage['providerType'],
                credentialSource: event.credentialSource as IterationUsage['credentialSource'],
                usage: event.usage,
                ...(event.finishReason ? { finishReason: event.finishReason } : {}),
              }
              turnIterations.push(record)
              segmentIterations.push(record)
            }
            // Provider-faithful: if content arrived only on `done` (no
            // streaming deltas), open a text part to carry it. Most
            // streaming providers will already have emitted text-deltas, so
            // this is the "buffered completion" fallback.
            if (
              event.content &&
              event.content.length > 0 &&
              (openTextIdx === -1 ||
                (parts[openTextIdx] as TextPart).text.length !== event.content.length)
            ) {
              if (openTextIdx === -1 || parts[openTextIdx]?.type !== 'text') {
                parts.push({ type: 'text', text: event.content, agent: agent.name })
                openTextIdx = parts.length - 1
              }
              // If the streamed deltas under-shot the final content (some
              // providers re-emit a fuller `done.content` than the deltas),
              // replace the part with the canonical full text. We do NOT
              // append, since the deltas were already a prefix of `content`.
              else if ((parts[openTextIdx] as TextPart).text.length < event.content.length) {
                ;(parts[openTextIdx] as TextPart).text = event.content
              }
            }
            // Reasoning fallback: trust streamed deltas; only fall back to
            // terminal `reasoning_content` when no thinking-delta arrived.
            if (!sawThinkingDelta && reasoningContent && reasoningContent.length > 0) {
              parts.push({ type: 'thinking', text: reasoningContent, agent: agent.name })
            }
            break
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('LLM error', { turnId, agent: agent.name, iteration, error: errorMessage })
      yield {
        type: 'turn-error',
        messageId,
        error: `LLM error in ${agent.name}: ${errorMessage}`,
      }
      // Flip any still-running tool_call parts to error so the persisted
      // shape doesn't carry zombies.
      markRunningPartsAsError(parts, 'LLM error mid-iteration')
      currentState = upsertAssistantMessage()
      return currentState
    }

    if (iterUsage) accumulateUsage(turnUsage, iterUsage)
    if (finishReason === 'length') truncated = true

    // No tool calls — one-shot or final response.
    if (toolCalls.length === 0) {
      if (totalToolCallCount < minToolCalls && iteration < maxIterations) {
        logger.warn('Agent returned text without meeting minimum tool calls, nudging', {
          turnId,
          agent: agent.name,
          minToolCalls,
          actualToolCalls: totalToolCallCount,
          iteration,
        })
        // Persist current assistant state, then append a synthetic user nudge
        // so the next iteration re-prompts the model.
        currentState = upsertAssistantMessage()
        currentState = {
          ...currentState,
          messages: [
            ...currentState.messages,
            {
              id: generateId('msg'),
              role: 'user',
              content:
                'You must use tools to complete this task. Do not write the result as text — call the appropriate tool now.',
              timestamp: Date.now(),
              metadata: { agent: agent.name, synthetic: true },
            },
          ],
        }
        // Reset open positions so next iteration opens fresh parts.
        openTextIdx = -1
        openThinkingIdx = -1
        // A zero-tool iteration breaks any identical-call repetition pattern.
        repeatSuccessKey = null
        repeatSuccessStreak = 0
        continue
      }

      logger.debug('Agent terminal iteration (no tool calls)', {
        turnId,
        agent: agent.name,
        contentLength: content.length,
      })

      // The LLM stopped calling tools — finalize the turn. Run the domain
      // post-process on the joined text projection, collapse all text parts
      // into a single canonical text part if the rewrite differs.
      yield await finalizeTurn({ runProcessResult: true, toolCalls })
      break
    }

    // Tool calls present — handle approval / capture / normal dispatch.
    totalToolCallCount += toolCalls.length
    logger.info('Executing tools', {
      turnId,
      agent: agent.name,
      tools: toolCalls.map((tc) => ({
        toolCallId: tc.id,
        name: tc.function.name,
        args: previewArgs(parseToolArgs(tc)),
      })),
    })

    // Allocate a tool_call part for each tool call BEFORE dispatch so we
    // can address them by `partIndex` in events.
    const toolPartIndexes: number[] = []
    for (const tc of toolCalls) {
      const args = parseToolArgs(tc)
      const part: ToolCallPart = {
        type: 'tool_call',
        toolCallId: tc.id,
        name: tc.function.name,
        args,
        status: 'running',
        agent: agent.name,
        ...(iterUsage ? { iterationUsage: iterUsage } : {}),
      }
      parts.push(part)
      toolPartIndexes.push(parts.length - 1)
    }

    // Emit tool-call-started for each.
    for (let k = 0; k < toolCalls.length; k++) {
      const tc = toolCalls[k]!
      const idx = toolPartIndexes[k]!
      const part = parts[idx] as ToolCallPart
      yield {
        type: 'tool-call-started',
        messageId,
        partIndex: idx,
        toolCallId: part.toolCallId,
        name: part.name,
        agent: agent.name,
        args: part.args,
      }
      // Mark unused
      void tc
    }

    // ===== CAPTURE MODE =====
    if (config.approvalMode === 'capture') {
      const captureRun = await processCaptureToolCalls(
        toolCalls,
        agent.tools,
        agent.name,
        ctx,
        idempotentCache,
        currentState.capturedActions ?? [],
        config.domainConfig.transformToolInput
          ? (toolName, args) =>
              config.domainConfig.transformToolInput!(toolName, args, currentState)
          : undefined,
        config.applyToolRestrictions
      )
      // Forward each event mapped onto the appropriate tool_call part.
      for (const ev of captureRun.events) {
        // Capture-mode emits framework-internal events; translate to
        // message-scoped variants.
        const mapped = translateCaptureEvent(ev, messageId, toolPartIndexes, toolCalls, agent.name)
        if (mapped) yield mapped
      }

      // Capture successful tool results into the context store (tool:*/call:*)
      // before domain hooks so `onToolResult` can read them back.
      for (const r of captureRun.results) {
        if (r.success) ctx.context.captureToolResult(r.toolCallId, r.toolName, r.output)
      }

      // Mine state updates.
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
      currentState = syncStoreSlice(ctx, currentState)

      // Update each tool_call part with the result.
      for (let k = 0; k < captureRun.results.length; k++) {
        const r = captureRun.results[k]!
        const idx = toolPartIndexes[k]!
        const part = parts[idx] as ToolCallPart
        if (r.success) {
          part.status = 'completed'
          part.output = r.output
          if (r.digest !== undefined) part.digest = r.digest
          if (r.captured) part.captured = true
        } else {
          part.status = 'error'
          part.error = r.error ?? 'Unknown error'
          if (r.output !== undefined) part.output = r.output
        }
      }

      currentState = {
        ...currentState,
        capturedActions: [...(currentState.capturedActions ?? []), ...captureRun.capturedActions],
      }
      currentState = upsertAssistantMessage()
      currentState = await agent.processResult(content, toolCalls, currentState, ctx)

      // endsTurn terminal tools apply in capture mode too — pure-UX tools
      // (no DB writes) execute here rather than being captured, so without
      // this check a simulated turn replays the same re-invoke loop.
      if (
        toolCalls.every((tc) => endsTurnToolNames.has(tc.function.name)) &&
        captureRun.results.every((r) => r.success)
      ) {
        logger.debug('All tool calls are endsTurn — finalizing turn (capture mode)', {
          turnId,
          agent: agent.name,
          tools: toolCalls.map((tc) => tc.function.name),
        })
        yield await finalizeTurn({ runProcessResult: false, toolCalls })
        break
      }
      continue
    }

    // ===== APPROVAL CHECK (pause mode) =====
    const approvalTool =
      config.approvalMode === 'auto' ? undefined : findApprovalTool(toolCalls, agent.tools)
    if (approvalTool) {
      const approvalIdx = toolCalls.findIndex((tc) => tc.id === approvalTool.id)
      const approvalPartIndex = toolPartIndexes[approvalIdx]!
      let approvalArgs = parseToolArgs(approvalTool)
      if (config.domainConfig.transformToolInput) {
        approvalArgs = config.domainConfig.transformToolInput(
          approvalTool.function.name,
          approvalArgs,
          currentState
        )
      }
      ;(parts[approvalPartIndex] as ToolCallPart).args = approvalArgs

      const toolDef = agent.tools.find((t) => t.name === approvalTool.function.name)
      const missingParams = validateRequiredParams(toolDef, approvalArgs)

      if (missingParams.length > 0) {
        const errorMessage = `Missing required parameters: ${missingParams.join(
          ', '
        )}. Please provide all required parameters.`
        logger.warn('Approval tool missing required params, returning error to LLM', {
          turnId,
          agent: agent.name,
          tool: approvalTool.function.name,
          missingParams,
        })
        // Flip the approval part to error so the LLM can retry. Other
        // tool_call parts in this iteration also need to be flipped — the
        // LLM only gets to retry once we have results for ALL of them.
        ;(parts[approvalPartIndex] as ToolCallPart).status = 'error'
        ;(parts[approvalPartIndex] as ToolCallPart).error = errorMessage
        yield {
          type: 'tool-call-failed',
          messageId,
          partIndex: approvalPartIndex,
          toolCallId: approvalTool.id,
          agent: agent.name,
          error: errorMessage,
        }
        // Flip every OTHER tool call to error too so the wire-format produces
        // a complete tool-result for each id. We treat them as "skipped due
        // to upstream validation failure" — matches old loop's behavior of
        // synthesizing a single error result and continuing.
        for (let k = 0; k < toolPartIndexes.length; k++) {
          if (k === approvalIdx) continue
          const idx = toolPartIndexes[k]!
          const p = parts[idx] as ToolCallPart
          if (p.status === 'running') {
            p.status = 'error'
            p.error = 'Skipped — upstream tool failed validation'
            yield {
              type: 'tool-call-failed',
              messageId,
              partIndex: idx,
              toolCallId: p.toolCallId,
              agent: agent.name,
              error: p.error,
            }
          }
        }
        currentState = upsertAssistantMessage()
        continue
      }

      // Per-agent restriction clamp (pre-pause) — pins / overrides args before
      // the approval card is shown and before validateInputs runs, so a pinned
      // arg can't be smuggled in via an amended approval.
      if (config.applyToolRestrictions) {
        const r = await config.applyToolRestrictions(approvalTool.function.name, approvalArgs, ctx)
        if (!r.ok) {
          logger.info('applyToolRestrictions refused approval-required call', {
            turnId,
            toolCallId: approvalTool.id,
            agent: agent.name,
            tool: approvalTool.function.name,
            error: r.error,
            args: previewArgs(approvalArgs),
          })
          ;(parts[approvalPartIndex] as ToolCallPart).status = 'error'
          ;(parts[approvalPartIndex] as ToolCallPart).error = r.error
          yield {
            type: 'tool-call-failed',
            messageId,
            partIndex: approvalPartIndex,
            toolCallId: approvalTool.id,
            agent: agent.name,
            error: r.error,
          }
          for (let k = 0; k < toolPartIndexes.length; k++) {
            if (k === approvalIdx) continue
            const idx = toolPartIndexes[k]!
            const p = parts[idx] as ToolCallPart
            if (p.status === 'running') {
              p.status = 'error'
              p.error = 'Skipped — upstream tool failed validation'
              yield {
                type: 'tool-call-failed',
                messageId,
                partIndex: idx,
                toolCallId: p.toolCallId,
                agent: agent.name,
                error: p.error,
              }
            }
          }
          currentState = upsertAssistantMessage()
          continue
        }
        approvalArgs = r.args
        ;(parts[approvalPartIndex] as ToolCallPart).args = approvalArgs
      }

      // Pre-pause input validation.
      if (toolDef?.validateInputs) {
        const v = await toolDef.validateInputs(approvalArgs, ctx)
        if (!v.ok) {
          logger.info('validateInputs rejected approval-required call', {
            turnId,
            toolCallId: approvalTool.id,
            agent: agent.name,
            tool: approvalTool.function.name,
            error: v.error,
            args: previewArgs(approvalArgs),
          })
          ;(parts[approvalPartIndex] as ToolCallPart).status = 'error'
          ;(parts[approvalPartIndex] as ToolCallPart).error = v.error
          yield {
            type: 'tool-call-failed',
            messageId,
            partIndex: approvalPartIndex,
            toolCallId: approvalTool.id,
            agent: agent.name,
            error: v.error,
          }
          for (let k = 0; k < toolPartIndexes.length; k++) {
            if (k === approvalIdx) continue
            const idx = toolPartIndexes[k]!
            const p = parts[idx] as ToolCallPart
            if (p.status === 'running') {
              p.status = 'error'
              p.error = 'Skipped — upstream tool failed validation'
              yield {
                type: 'tool-call-failed',
                messageId,
                partIndex: idx,
                toolCallId: p.toolCallId,
                agent: agent.name,
                error: p.error,
              }
            }
          }
          currentState = upsertAssistantMessage()
          continue
        }
        if (v.warnings?.length) {
          logger.info('validateInputs warnings (pre-pause)', {
            turnId,
            toolCallId: approvalTool.id,
            tool: approvalTool.function.name,
            warnings: v.warnings,
            args: previewArgs(approvalArgs),
          })
        }
        approvalArgs = v.args
        ;(parts[approvalPartIndex] as ToolCallPart).args = approvalArgs
      }

      logger.info('Approval required', {
        turnId,
        agent: agent.name,
        tool: approvalTool.function.name,
      })

      // Flip the approval part to awaiting-approval. Flip any sibling
      // tool_calls in the same iteration to error — the loop has never
      // executed sibling auto-tool-calls alongside an approval call.
      ;(parts[approvalPartIndex] as ToolCallPart).status = 'awaiting-approval'
      for (let k = 0; k < toolPartIndexes.length; k++) {
        if (k === approvalIdx) continue
        const idx = toolPartIndexes[k]!
        const p = parts[idx] as ToolCallPart
        if (p.status === 'running') {
          p.status = 'error'
          p.error = 'Skipped — paused on sibling approval'
          yield {
            type: 'tool-call-failed',
            messageId,
            partIndex: idx,
            toolCallId: p.toolCallId,
            agent: agent.name,
            error: p.error,
          }
        }
      }

      // Compute digest from args for the approval card (some tools want
      // to surface a preview before execution).
      const approvalDigest = toolDef?.buildDigest
        ? buildToolDigest(toolDef, approvalArgs, logger)
        : undefined
      if (approvalDigest !== undefined) {
        ;(parts[approvalPartIndex] as ToolCallPart).digest = approvalDigest
      }

      // Persist the approval card as its own system message alongside the
      // paused assistant message. Refresh-from-persistence and live-streaming
      // both render from this same record — the card no longer disappears on
      // F5. The client uses the same `approvalMessageId` when synthesizing
      // the card in its store from the SSE event.
      const approvalMessageId = generateId('msg')
      yield {
        type: 'approval-required',
        messageId,
        partIndex: approvalPartIndex,
        toolCallId: approvalTool.id,
        toolName: approvalTool.function.name,
        agent: agent.name,
        args: approvalArgs,
        approvalMessageId,
        ...(approvalDigest !== undefined ? { digest: approvalDigest } : {}),
      }
      yield {
        type: 'tool-call-status',
        messageId,
        partIndex: approvalPartIndex,
        toolCallId: approvalTool.id,
        agent: agent.name,
        status: 'awaiting-approval',
        ...(approvalDigest !== undefined ? { digest: approvalDigest } : {}),
      }

      // Pause-time persistence: carry billing context onto the paused message
      // so the iteration that proposed the approval is already accounted for
      // (resume runs in a separate query-loop with its own iterations).
      currentState = upsertAssistantMessage({
        metadata: {
          agent: agent.name,
          modelId: lastModelId,
          usage: turnUsage,
          ...(truncated ? { truncated: true } : {}),
          ...(turnIterations.length > 0 ? { iterations: [...turnIterations] } : {}),
        },
      })
      currentState = await agent.processResult(content, toolCalls, currentState, ctx)
      currentState = {
        ...currentState,
        messages: [
          ...currentState.messages,
          {
            id: approvalMessageId,
            role: 'system',
            content: `Approval needed: ${approvalTool.function.name}`,
            timestamp: Date.now(),
            parentId: messageId,
            approval: {
              toolName: approvalTool.function.name,
              toolCallId: approvalTool.id,
              args: approvalArgs,
              status: 'pending',
            },
          },
        ],
        waitingForApproval: true,
        pendingToolCall: {
          messageId,
          partIndex: approvalPartIndex,
          toolCallId: approvalTool.id,
          toolName: approvalTool.function.name,
          agentName: agent.name,
          args: approvalArgs,
        },
      }
      // Suspend the message but keep it open — resume runs the same agent
      // loop with a `resumeFrom` hint, appending more parts to this same
      // `messageId`. Billing consumers drain `iterations` here for the
      // pre-pause LLM calls; the resumed loop emits its own segment on the
      // next `finished` / `paused`.
      yield {
        type: 'assistant-message-paused',
        messageId,
        agent: agent.name,
        ...(segmentIterations.length > 0 ? { iterations: [...segmentIterations] } : {}),
      }
      return currentState
    }

    // ===== NORMAL TOOL EXECUTION =====
    const toolCallGen = executeToolCalls(
      toolCalls,
      toolPartIndexes,
      parts,
      agent.tools,
      agent.name,
      messageId,
      ctx,
      idempotentCache,
      config.domainConfig.transformToolInput
        ? (toolName, args) => config.domainConfig.transformToolInput!(toolName, args, currentState)
        : undefined,
      config.applyToolRestrictions
    )
    let collectedToolResults: ToolExecResult[] = []
    while (true) {
      const next = await toolCallGen.next()
      if (next.done) {
        collectedToolResults = next.value
        break
      }
      yield next.value
    }
    const toolResults = { results: collectedToolResults }

    // Capture successful tool results into the context store (tool:*/call:*)
    // before domain hooks. Captures the raw output, not the `transformToolResult`
    // rewrite (which only adjusts the LLM-visible payload).
    for (const r of toolResults.results) {
      if (r.success) ctx.context.captureToolResult(r.toolCallId, r.toolName, r.output)
    }

    // Domain `onToolResult` hook (state mining).
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
    currentState = syncStoreSlice(ctx, currentState)

    // Domain `transformToolResult` hook (rewrite LLM-visible payload).
    if (config.domainConfig.transformToolResult) {
      for (const r of toolResults.results) {
        if (!r.success) continue
        const transformed = config.domainConfig.transformToolResult(
          r.toolName,
          { success: r.success, output: r.output, error: r.error },
          currentState
        )
        if (transformed) {
          r.output = transformed.output
          if (!transformed.success) {
            r.success = false
            r.error = transformed.error
          }
        }
      }
    }

    // Stamp each tool_call part with the final result.
    for (let k = 0; k < toolResults.results.length; k++) {
      const r = toolResults.results[k]!
      const idx = toolPartIndexes[k]!
      const part = parts[idx] as ToolCallPart
      if (r.success) {
        part.status = 'completed'
        part.output = r.output
        if (r.digest !== undefined) part.digest = r.digest
      } else {
        part.status = 'error'
        part.error = r.error ?? 'Unknown error'
        if (r.output !== undefined) part.output = r.output
      }
      // Untrusted-output marker (MCP) — drives the wire-layer injection fence.
      if (r.outputBoundary) part.outputBoundary = r.outputBoundary
    }

    currentState = upsertAssistantMessage()
    currentState = await agent.processResult(content, toolCalls, currentState, ctx)

    // ===== endsTurn TERMINAL TOOLS =====
    // An iteration whose tool calls are ALL turn-terminal UI directives and
    // ALL succeeded ends the turn: their output is for the client, not the
    // model, so there is nothing for the LLM to read back — the text it
    // emitted alongside the calls is the final reply.
    if (
      toolCalls.every((tc) => endsTurnToolNames.has(tc.function.name)) &&
      toolResults.results.every((r) => r.success)
    ) {
      logger.debug('All tool calls are endsTurn — finalizing turn', {
        turnId,
        agent: agent.name,
        tools: toolCalls.map((tc) => tc.function.name),
      })
      yield await finalizeTurn({ runProcessResult: false, toolCalls })
      break
    }

    // Same-tool failure streak detector.
    const allFailed = toolResults.results.length > 0 && toolResults.results.every((r) => !r.success)
    const distinctNames = new Set(toolResults.results.map((r) => r.toolName))
    if (allFailed && distinctNames.size === 1) {
      const onlyName = [...distinctNames][0]
      if (failingToolName === onlyName) {
        failingToolStreak++
      } else {
        failingToolName = onlyName
        failingToolStreak = 1
      }
      if (failingToolStreak >= SAME_TOOL_FAILURE_LIMIT) {
        const lastError = toolResults.results.find((r) => !r.success)?.error ?? 'unknown error'
        logger.warn('Same-tool failure streak — aborting turn', {
          turnId,
          agent: agent.name,
          tool: onlyName,
          streak: failingToolStreak,
          iteration,
          lastError,
        })
        yield {
          type: 'turn-error',
          messageId,
          error: `Tool \`${onlyName}\` failed ${failingToolStreak} times in a row: ${lastError}`,
        }
        markRunningPartsAsError(parts, 'Same-tool failure streak')
        currentState = upsertAssistantMessage()
        return currentState
      }
    } else {
      failingToolName = null
      failingToolStreak = 0
    }

    // Same-tool identical-args SUCCESS streak — the model is plainly done and
    // repeating itself (wrap-up text + the same call, round after round).
    // Unlike the failure streak this is not an error: finalize gracefully and
    // commit its text as the final reply. Requiring assistant text in the
    // iteration matches that signature and keeps a hypothetical poll loop
    // (same read tool, identical args, no narration) out of the blast radius.
    const allSucceeded =
      toolResults.results.length > 0 && toolResults.results.every((r) => r.success)
    if (allSucceeded && distinctNames.size === 1 && content.length > 0) {
      // Sorted-key serialization so arg key order can't defeat the comparison.
      const streakKey = stableStringify([
        [...distinctNames][0],
        toolCalls.map((tc) => parseToolArgs(tc)),
      ])
      repeatSuccessStreak = streakKey === repeatSuccessKey ? repeatSuccessStreak + 1 : 1
      repeatSuccessKey = streakKey
      if (repeatSuccessStreak >= SAME_TOOL_SUCCESS_LIMIT) {
        logger.warn('Same-tool identical-args success streak — finalizing turn', {
          turnId,
          agent: agent.name,
          tool: [...distinctNames][0],
          streak: repeatSuccessStreak,
          iteration,
        })
        // Each redundant round repeated the wrap-up verbatim; drop the
        // duplicate text parts so the final reply carries it once.
        dedupeRepeatedTextParts(parts)
        yield await finalizeTurn({ runProcessResult: false, toolCalls })
        break
      }
    } else {
      repeatSuccessKey = null
      repeatSuccessStreak = 0
    }
  }

  // Loop exit (max iterations hit without natural termination, or aborted).
  // Make sure the persisted message reflects whatever we built; if no
  // assistant-message-finished was emitted yet, this is an abnormal exit —
  // mark any running parts as error, then commit.
  if (parts.some((p) => p.type === 'tool_call' && (p as ToolCallPart).status === 'running')) {
    markRunningPartsAsError(parts, 'Turn ended before tool completed')
  }
  currentState = upsertAssistantMessage({
    metadata: {
      agent: agent.name,
      modelId: lastModelId,
      usage: turnUsage,
      ...(truncated ? { truncated: true } : {}),
      ...(turnIterations.length > 0 ? { iterations: [...turnIterations] } : {}),
    },
  })

  logger.info('Agent completed', { turnId, agent: agent.name, iterations: iteration })

  return currentState
}

// ===== HELPERS =====

/**
 * Drop text parts whose content exactly repeats the previous text part's
 * (ignoring non-text parts between them). Used by the success-streak guard:
 * a model stuck repeating itself emits identical wrap-up text each round, and
 * joining the parts verbatim would put it in the final reply N times.
 */
function dedupeRepeatedTextParts(parts: ContentPart[]): void {
  let prevText: string | null = null
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!
    if (p.type !== 'text') continue
    if (p.text === prevText) {
      parts.splice(i, 1)
      i--
      continue
    }
    prevText = p.text
  }
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
  const toolMap = new Map(agentTools.map((t) => [t.name, t]))
  return toolCalls.find((tc) => {
    const tool = toolMap.get(tc.function.name)
    if (!tool) return false
    return needsApproval(tool, parseToolArgs(tc))
  })
}

function accumulateUsage(target: UsageMetrics, src: UsageMetrics): void {
  target.prompt_tokens = (target.prompt_tokens ?? 0) + (src.prompt_tokens ?? 0)
  target.completion_tokens = (target.completion_tokens ?? 0) + (src.completion_tokens ?? 0)
  target.total_tokens =
    (target.total_tokens ?? 0) +
    (src.total_tokens ?? (src.prompt_tokens ?? 0) + (src.completion_tokens ?? 0))
}

function markRunningPartsAsError(parts: ContentPart[], reason: string): void {
  for (const p of parts) {
    if (p.type === 'tool_call' && p.status === 'running') {
      p.status = 'error'
      p.error = reason
    }
  }
}

/**
 * Drop an earlier `text` part when a later text part of the same turn restates
 * it verbatim (normalized containment — whitespace squashed, markdown emphasis
 * stripped). A known model repetition mode: prose written alongside a tool call
 * gets re-emitted, lightly reformatted, after the result. Deliberately NOT
 * fuzzy — a paraphrase is left alone; only content fully contained in a later
 * part is dropped, so no words are ever lost. Min-length guard keeps short
 * legitimate echoes ("Done.") intact.
 */
export function dropRestatedTextParts(parts: ContentPart[]): void {
  const normalize = (s: string) => s.replace(/[*_]+/g, '').replace(/\s+/g, ' ').trim()
  const texts = parts
    .map((part, idx) =>
      part.type === 'text' ? { idx, norm: normalize((part as TextPart).text) } : null
    )
    .filter((t): t is { idx: number; norm: string } => t !== null)
  if (texts.length < 2) return

  const drop: number[] = []
  for (let a = 0; a < texts.length; a++) {
    const earlier = texts[a]!
    if (earlier.norm.length < 20) continue
    for (let b = a + 1; b < texts.length; b++) {
      if (texts[b]!.norm.includes(earlier.norm)) {
        drop.push(earlier.idx)
        break
      }
    }
  }
  for (let i = drop.length - 1; i >= 0; i--) parts.splice(drop[i]!, 1)
}

/**
 * Collapse every `text` part into a single canonical `text` part holding
 * the post-processed content. Placed at the index of the LAST text part;
 * earlier text parts are removed. Tool_call and thinking parts are
 * preserved in order.
 *
 * Last, not first: `finalText` is the answer the model produced AFTER its tool
 * calls resolved. Parking it at the first text part hoisted it in front of the
 * `tool_call` parts, so the replayed history showed the conclusion before the
 * evidence it came from — and the model, reading its own transcript back, would
 * contradict tool results that appear to postdate the answer.
 */
function collapseTextParts(parts: ContentPart[], finalText: string, agentName: string): void {
  // Manual reverse scan: `findLastIndex` needs lib es2023, which this package's
  // tsconfig target predates.
  let lastTextIdx = -1
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i]!.type === 'text') {
      lastTextIdx = i
      break
    }
  }
  if (lastTextIdx === -1) {
    parts.push({ type: 'text', text: finalText, agent: agentName })
    return
  }
  // Replace the last text part with the canonical text.
  ;(parts[lastTextIdx] as TextPart).text = finalText
  // Remove every earlier text part.
  for (let i = lastTextIdx - 1; i >= 0; i--) {
    if (parts[i]!.type === 'text') {
      parts.splice(i, 1)
    }
  }
}

/**
 * Translate a capture-mode internal `AgentEvent` (carries `tool`, `toolCallId`,
 * etc. — see capture-mode.ts) to the new message-scoped event variant.
 *
 * Capture-mode is a tier below query-loop. It doesn't know about messageId/
 * partIndex; query-loop owns that mapping.
 */
function translateCaptureEvent(
  ev: AgentEvent,
  messageId: string,
  toolPartIndexes: number[],
  toolCalls: ToolCall[],
  agentName: string
): AgentEvent | null {
  // We already emitted `tool-call-started` for every tool BEFORE calling
  // processCaptureToolCalls (query-loop owns part allocation), so drop the
  // duplicate `tool-call-started` events from capture mode.
  if (ev.type === 'tool-call-started') return null

  // The remaining capture-mode events use the new event shape with placeholder
  // (messageId='', partIndex=-1). Patch them based on toolCallId order.
  if (
    ev.type === 'tool-call-completed' ||
    ev.type === 'tool-call-failed' ||
    ev.type === 'tool-call-status' ||
    ev.type === 'tool-progress'
  ) {
    const toolCallId = (ev as { toolCallId?: string }).toolCallId
    if (!toolCallId) return ev
    const callIdx = toolCalls.findIndex((tc) => tc.id === toolCallId)
    const partIndex = callIdx >= 0 ? toolPartIndexes[callIdx]! : -1
    return { ...ev, messageId, partIndex, agent: agentName } as AgentEvent
  }
  return ev
}

/**
 * Async-generator tool dispatcher (message-scoped). Yields per-tool events
 * keyed by `messageId` + `partIndex` and returns the per-call results.
 */
async function* executeToolCalls(
  toolCalls: ToolCall[],
  toolPartIndexes: number[],
  parts: ContentPart[],
  agentTools: AgentToolDefinition[],
  agentName: string,
  messageId: string,
  ctx: ToolContext,
  idempotentCache: Map<string, ToolExecResult>,
  transformInput?: (toolName: string, args: Record<string, unknown>) => Record<string, unknown>,
  applyToolRestrictions?: AgentEngineConfig['applyToolRestrictions']
): AsyncGenerator<AgentEvent, ToolExecResult[]> {
  const toolMap = new Map(agentTools.map((t) => [t.name, t]))
  const results: ToolExecResult[] = []

  for (let i = 0; i < toolCalls.length; i++) {
    const toolCall = toolCalls[i]!
    const partIndex = toolPartIndexes[i]!
    const toolName = toolCall.function.name
    const tool = toolMap.get(toolName)
    let args = parseToolArgs(toolCall)
    if (transformInput) args = transformInput(toolName, args)
    ;(parts[partIndex] as ToolCallPart).args = args

    if (!tool) {
      const errorMsg = `Unknown tool: ${toolName}`
      yield {
        type: 'tool-call-failed',
        messageId,
        partIndex,
        toolCallId: toolCall.id,
        agent: agentName,
        error: errorMsg,
      }
      results.push({
        toolCallId: toolCall.id,
        toolName,
        output: { error: errorMsg },
        success: false,
        error: errorMsg,
      })
      continue
    }

    // Approval-required tools never reach here.
    if (needsApproval(tool, args)) continue

    // Per-agent restriction clamp — pins / overrides args before the tool
    // validates or executes. The rewritten object is the one that flows on.
    if (applyToolRestrictions) {
      const r = await applyToolRestrictions(toolName, args, ctx)
      if (!r.ok) {
        yield {
          type: 'tool-call-failed',
          messageId,
          partIndex,
          toolCallId: toolCall.id,
          agent: agentName,
          error: r.error,
        }
        logger.info('applyToolRestrictions refused call', {
          turnId: ctx.turnId,
          toolCallId: toolCall.id,
          agent: agentName,
          tool: toolName,
          error: r.error,
          args: previewArgs(args),
        })
        results.push({
          toolCallId: toolCall.id,
          toolName,
          output: { error: r.error },
          success: false,
          error: r.error,
        })
        continue
      }
      args = r.args
      ;(parts[partIndex] as ToolCallPart).args = args
    }

    // Input validation + normalization.
    if (tool.validateInputs) {
      const v = await tool.validateInputs(args, ctx)
      if (!v.ok) {
        yield {
          type: 'tool-call-failed',
          messageId,
          partIndex,
          toolCallId: toolCall.id,
          agent: agentName,
          error: v.error,
        }
        logger.info('validateInputs rejected', {
          turnId: ctx.turnId,
          toolCallId: toolCall.id,
          agent: agentName,
          tool: toolName,
          error: v.error,
          args: previewArgs(args),
        })
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
          turnId: ctx.turnId,
          toolCallId: toolCall.id,
          agent: agentName,
          tool: toolName,
          warnings: v.warnings,
          args: previewArgs(args),
        })
      }
      args = v.args
      ;(parts[partIndex] as ToolCallPart).args = args
    }

    const cacheKey = tool.idempotent ? `${toolName}::${stableStringify(args)}` : null
    if (cacheKey) {
      const cached = idempotentCache.get(cacheKey)
      if (cached) {
        yield {
          type: 'tool-call-completed',
          messageId,
          partIndex,
          toolCallId: toolCall.id,
          agent: agentName,
          output: cached.output,
          ...(cached.digest !== undefined ? { digest: cached.digest } : {}),
        }
        results.push({
          toolCallId: toolCall.id,
          toolName,
          output: cached.output,
          success: cached.success,
          error: cached.error,
          digest: cached.digest,
          ...(cached.outputBoundary ? { outputBoundary: cached.outputBoundary } : {}),
        })
        continue
      }
    }

    try {
      const exec = tool.execute(args, ctx)
      let result: AgentToolResult
      if (
        typeof exec === 'object' &&
        exec !== null &&
        typeof (exec as AsyncIterator<unknown>).next === 'function' &&
        typeof (exec as AsyncIterator<unknown>)[Symbol.asyncIterator as keyof object] === 'function'
      ) {
        const gen = exec as AsyncGenerator<
          import('./types').ToolProgressPayload,
          AgentToolResult,
          void
        >
        while (true) {
          const next = await gen.next()
          if (next.done) {
            result = next.value
            break
          }
          yield {
            type: 'tool-progress',
            messageId,
            partIndex,
            toolCallId: toolCall.id,
            agent: agentName,
            ...(next.value.kind ? { kind: next.value.kind } : {}),
            data: next.value.data,
          }
        }
      } else {
        result = await (exec as Promise<AgentToolResult>)
      }

      const digest = result.success ? buildToolDigest(tool, result.output, logger) : undefined
      if (result.success) {
        yield {
          type: 'tool-call-completed',
          messageId,
          partIndex,
          toolCallId: toolCall.id,
          agent: agentName,
          output: result.output,
          ...(digest !== undefined ? { digest } : {}),
        }
      } else {
        yield {
          type: 'tool-call-failed',
          messageId,
          partIndex,
          toolCallId: toolCall.id,
          agent: agentName,
          error: result.error ?? 'Unknown error',
        }
      }

      logger.info('Tool result', {
        turnId: ctx.turnId,
        toolCallId: toolCall.id,
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
        ...(tool.outputBoundary ? { outputBoundary: tool.outputBoundary } : {}),
      }
      results.push(execResult)
      if (cacheKey && result.success) idempotentCache.set(cacheKey, execResult)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      yield {
        type: 'tool-call-failed',
        messageId,
        partIndex,
        toolCallId: toolCall.id,
        agent: agentName,
        error: errorMsg,
      }
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

  return results
}
