// packages/lib/src/ai/decision/evaluate.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { getCachedDefaultModel } from '../../cache'
import { NotFoundError } from '../../errors'
import { LLMOrchestrator } from '../orchestrator/llm-orchestrator'
import type { UsageSource, UsageTrackingRequest } from '../orchestrator/types'
import { ProviderConfigurationError } from '../providers/base/types'
import { getCredentials, getSystemCredentials } from '../providers/config'
import { ProviderRegistry } from '../providers/provider-registry'
import { type CredentialsResponse, ModelType } from '../providers/types'
import { enforceAiQuota } from '../quota/enforce-ai-quota'
import { UsageTrackingService } from '../usage/usage-tracking-service'
import type { DecisionQuestion, DecisionResult, DecisionState } from './client'
import { isDecisionFallbackTrigger } from './fallback'
import { LlmDecisionClient } from './llm-decision-client'

const logger = createScopedLogger('ai-decision')

/** Input for {@link evaluate}; `userId` is null for background work, never `''` (FK). */
export interface EvaluateDecisionInput {
  organizationId: string
  userId: string | null
  state: DecisionState
  questions: Record<string, DecisionQuestion>
  source: UsageSource
  sourceId?: string
  model?: ModelRef
  /** Retried on a fallback trigger instead of the org's LLM default. */
  fallbackModel?: ModelRef
  /** Platform SYSTEM credentials regardless of the org's provider preference; billed to its credits. */
  forceSystem?: boolean
}

type ModelRef = { provider: string; model: string }

/**
 * Answer typed questions on the org's decision model, falling back to its LLM default (D9).
 * With `model` + `fallbackModel` the org's defaults are never read.
 */
export async function evaluate(
  db: Database,
  input: EvaluateDecisionInput
): Promise<Result<DecisionResult, Error>> {
  try {
    const { organizationId } = input
    const llmDefault = () => getCachedDefaultModel(organizationId, ModelType.LLM)
    const resolved =
      input.model ??
      (await getCachedDefaultModel(organizationId, ModelType.DECISION)) ??
      (await llmDefault())
    if (!resolved) return err(new NotFoundError('No decision or language model configured'))

    try {
      return ok(await attempt(db, input, resolved))
    } catch (error) {
      const fallback = input.fallbackModel ?? (await llmDefault())
      const sameModel =
        fallback?.provider === resolved.provider && fallback.model === resolved.model
      if (!fallback || sameModel || !isDecisionFallbackTrigger(error)) {
        return err(toError(error))
      }
      logger.warn('Decision model unavailable, falling back', {
        organizationId,
        from: `${resolved.provider}/${resolved.model}`,
        to: `${fallback.provider}/${fallback.model}`,
        reason: toError(error).message,
      })
      return ok(await runAdapter(db, input, fallback))
    }
  } catch (error) {
    return err(toError(error))
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function attempt(db: Database, input: EvaluateDecisionInput, ref: ModelRef) {
  const native = ProviderRegistry.getModelCapabilities(ref.model)?.modelType === ModelType.DECISION
  return native ? runNative(db, input, ref) : runAdapter(db, input, ref)
}

function runAdapter(db: Database, input: EvaluateDecisionInput, ref: ModelRef) {
  const { organizationId, userId, source, sourceId, state, questions, forceSystem } = input
  const orchestrator = new LLMOrchestrator(new UsageTrackingService(db), db)
  const client = new LlmDecisionClient(orchestrator, {
    organizationId,
    userId,
    source,
    sourceId,
    forceSystem,
  })
  return client.evaluate({ provider: ref.provider, model: ref.model, state, questions })
}

// Same pick as the orchestrator's private `pickPoolCredentials`.
function pickPoolCredentials(credentials: CredentialsResponse): Record<string, any> {
  const members = (credentials.load_balancing?.configs ?? []).filter(
    (c) => c.enabled && !c.in_cooldown
  )
  if (members.length <= 1) return credentials.credentials
  return members[Math.floor(Math.random() * members.length)]!.credentials
}

async function runNative(
  db: Database,
  input: EvaluateDecisionInput,
  ref: ModelRef
): Promise<DecisionResult> {
  const { organizationId, userId, state, questions } = input
  const { provider, model } = ref
  // `userId ?? ''` only for credential lookup and the rate-limit key; the usage insert gets the real value.
  const lookupUserId = userId ?? ''

  const ctx = { db, organizationId, userId: lookupUserId }
  const credentials = input.forceSystem
    ? await getSystemCredentials(ctx, provider)
    : await getCredentials(ctx, provider, model, ModelType.DECISION)
  // resolveCredentials swallows its failures into an empty map, so "no key" is detected here.
  if (Object.keys(credentials.credentials ?? {}).length === 0) {
    throw new ProviderConfigurationError(
      `No credentials configured for decision provider '${provider}'`,
      provider,
      'CREDENTIALS_MISSING'
    )
  }
  const providerType = credentials.providerType ?? 'CUSTOM'

  await enforceAiQuota(db, {
    provider,
    organizationId,
    userId: lookupUserId,
    providerType,
    forceSystem: input.forceSystem,
  })

  const startTime = Date.now()
  const client = await ProviderRegistry.createClient(provider, organizationId, lookupUserId)
  const result = await client
    .getDecisionClient(pickPoolCredentials(credentials))
    .evaluate({ provider, model, state, questions })

  const { inputTokens, outputTokens } = result.usage
  const request: UsageTrackingRequest = {
    organizationId,
    userId,
    provider,
    model,
    modelType: 'decision',
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
    context: input.source,
    timestamp: new Date(),
    metadata: {
      executionTime: Date.now() - startTime,
      questionCount: Object.keys(questions).length,
    },
    providerType,
    credentialSource: credentials.credentialSource ?? 'CUSTOM',
    source: input.source,
    sourceId: input.sourceId,
  }
  await new UsageTrackingService(db).trackUsage(request)

  return result
}
