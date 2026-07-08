// packages/lib/src/ai/kopilot/runners/run-structured-output-pass.ts

import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { LLMOrchestrator } from '../../orchestrator/llm-orchestrator'
import { UsageTrackingService } from '../../usage/usage-tracking-service'

const logger = createScopedLogger('run-structured-output-pass')

export interface RunStructuredOutputPassArgs {
  organizationId: string
  userId: string
  /** Workflow run id — surfaces as `sessionId` in usage telemetry. */
  sessionId?: string
  /** Workflow id, for tracking. */
  workflowId?: string
  /** AI-node id, for tracking. */
  nodeId?: string
  /** Provider + model name. Same precedence as the tool-loop call. */
  model: { provider: string; model: string }
  /** JSON Schema describing the desired output shape. */
  schema: Record<string, unknown>
  /** The freeform assistant message produced by the tool loop. */
  sourceMessage: string
  /** Optional completion params (temperature, max_tokens, …). */
  parameters?: Record<string, unknown>
}

/**
 * Discriminated result of the structured-output second pass. Callers must
 * check `ok` — a failed pass carries a human-readable `reason` instead of
 * silently yielding an empty object.
 */
export type StructuredOutputPassResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: string }

/**
 * Second-pass LLM call that rewrites the tool loop's freeform final message
 * into JSON matching `schema`. Per `agent-tools-reuse-brainstorm.md §Q-7`:
 * we isolate JSON mode from the tool loop because providers don't all combine
 * tool-calling + strict JSON-mode cleanly.
 *
 * Returns `{ ok: true, value }` with the parsed JSON object on success, or
 * `{ ok: false, reason }` when the orchestrator couldn't produce / parse one.
 * Failures are logged but never throw — the workflow node still emits the
 * freeform `text`.
 */
export async function runStructuredOutputPass(
  args: RunStructuredOutputPassArgs
): Promise<StructuredOutputPassResult> {
  const { organizationId, userId, sessionId, workflowId, nodeId, model, schema, sourceMessage } =
    args

  const usageService = new UsageTrackingService(db)
  const orchestrator = new LLMOrchestrator(usageService, db)

  const system =
    'You will rewrite the assistant message below as a JSON object matching ' +
    'the provided schema. Do not invent fields. Return only valid JSON.'
  const user = `Schema:\n${JSON.stringify(schema)}\n\nMessage:\n${sourceMessage}`

  try {
    const response = await orchestrator.invoke({
      provider: model.provider,
      model: model.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      parameters: args.parameters,
      organizationId,
      userId,
      context: {
        source: 'workflow_ai_node_structured',
        sessionId,
        workflowId,
        nodeId,
      },
      structuredOutput: { enabled: true, schema },
    })

    if (response.structured_output && typeof response.structured_output === 'object') {
      return { ok: true, value: response.structured_output }
    }

    // Fall through: try to parse plain content as JSON.
    if (response.content) {
      try {
        const parsed = JSON.parse(response.content)
        if (parsed && typeof parsed === 'object') {
          return { ok: true, value: parsed as Record<string, unknown> }
        }
      } catch {
        // ignored — handled below
      }
    }

    logger.warn('Structured output pass returned no usable JSON', {
      nodeId,
      contentPreview: response.content?.slice(0, 200),
    })
    return { ok: false, reason: 'model returned no parseable JSON' }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.error('Structured output pass failed', { nodeId, error: reason })
    return { ok: false, reason }
  }
}
