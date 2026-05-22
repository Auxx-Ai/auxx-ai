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
 * Second-pass LLM call that rewrites the tool loop's freeform final message
 * into JSON matching `schema`. Per `agent-tools-reuse-brainstorm.md §Q-7`:
 * we isolate JSON mode from the tool loop because providers don't all combine
 * tool-calling + strict JSON-mode cleanly.
 *
 * Returns the parsed JSON object on success, or `{}` if the orchestrator
 * couldn't produce / parse one. Failure to parse is logged but never throws —
 * the workflow node still emits the freeform `text`.
 */
export async function runStructuredOutputPass(
  args: RunStructuredOutputPassArgs
): Promise<Record<string, unknown>> {
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
      return response.structured_output
    }

    // Fall through: try to parse plain content as JSON.
    if (response.content) {
      try {
        const parsed = JSON.parse(response.content)
        if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
      } catch {
        // ignored — handled below
      }
    }

    logger.warn('Structured output pass returned no usable JSON', {
      nodeId,
      contentPreview: response.content?.slice(0, 200),
    })
    return {}
  } catch (error) {
    logger.error('Structured output pass failed', {
      nodeId,
      error: error instanceof Error ? error.message : String(error),
    })
    return {}
  }
}
