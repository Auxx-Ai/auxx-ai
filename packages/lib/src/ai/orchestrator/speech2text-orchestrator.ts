// packages/lib/src/ai/orchestrator/speech2text-orchestrator.ts

import type { Database } from '@auxx/database'
import { createScopedLogger, type Logger } from '@auxx/logger'
import { getOrgCache } from '../../cache/singletons'
import { UsageLimitError } from '../../errors'
import { createUsageGuard } from '../../usage/create-usage-guard'
import type { Speech2TextClient } from '../clients/base/speech2text-client'
import { QuotaExceededError } from '../errors/quota-errors'
import { ProviderManager } from '../providers/provider-manager'
import { ProviderRegistry } from '../providers/provider-registry'
import { ModelType } from '../providers/types'
import { QuotaService } from '../quota/quota-service'
import type {
  CredentialSourceType,
  OrchestratorConfig,
  ProviderTypeValue,
  Speech2TextInvocationRequest,
  Speech2TextInvocationResponse,
  UsageTrackingService,
} from './types'
import { OrchestratorError } from './types'

/**
 * Orchestrator for speech-to-text (audio transcription) calls.
 * Mirrors {@link LLMOrchestrator}'s quota gate + usage tracking flow but stripped to a
 * single-shot transcribe — no streaming, tools, or structured output.
 *
 * v1 cost model: each call deducts 1 credit regardless of audio length, and consumes one
 * unit of the `aiTranscriptions` abuse rate-limit. Per-minute pricing is a future change.
 */
export class Speech2TextOrchestrator {
  private logger: Logger
  private config: OrchestratorConfig

  constructor(
    private usageService?: UsageTrackingService,
    private db?: Database,
    config?: Partial<OrchestratorConfig>,
    logger?: Logger
  ) {
    this.logger = logger || createScopedLogger('Speech2TextOrchestrator')
    this.config = {
      enableUsageTracking: true,
      enableQuotaEnforcement: true,
      ...config,
    }
  }

  async transcribe(request: Speech2TextInvocationRequest): Promise<Speech2TextInvocationResponse> {
    const { organizationId, userId, audio, language, mimeType, filename, context } = request
    const { provider, model } = await this.resolveProviderModel(request)

    this.logger.debug('Speech2Text invocation started', {
      provider,
      model,
      organizationId,
      userId,
      audioBytes: audio.length,
      source: context?.source,
    })

    const startTime = Date.now()

    try {
      const { client, providerType, credentialSource } = await this.enforceQuotaGate(
        provider,
        model,
        organizationId,
        userId
      )

      const result = await client.invoke({
        audio,
        model,
        language,
        mimeType,
        filename,
        response_format: 'verbose_json',
      })

      if (this.config.enableUsageTracking && this.usageService) {
        await this.usageService.trackUsage({
          organizationId,
          userId,
          provider,
          model,
          usage: result.usage,
          context: context?.source ?? 'transcription',
          timestamp: new Date(),
          metadata: {
            executionTime: Date.now() - startTime,
            audioBytes: audio.length,
          },
          providerType,
          credentialSource,
          // v1: every transcription call costs 1 credit, regardless of audio length.
          creditsUsed: 1,
          source: 'transcription',
        })
      }

      const lastSegment = result.segments?.[result.segments.length - 1]

      this.logger.info('Speech2Text invocation completed', {
        provider,
        model,
        organizationId,
        executionTime: Date.now() - startTime,
        textLength: result.text?.length ?? 0,
      })

      return {
        text: result.text,
        language: result.language,
        segments: result.segments,
        durationSeconds: lastSegment?.end,
        usage: result.usage,
        provider,
        model,
        providerType,
        credentialSource,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      this.logger.error('Speech2Text invocation failed', {
        error: errorMessage,
        provider,
        model,
        organizationId,
        userId,
        executionTime: Date.now() - startTime,
      })

      // Preserve quota/abuse errors so the route handler can map them to 402/429.
      if (error instanceof QuotaExceededError || error instanceof UsageLimitError) {
        throw error
      }

      throw new OrchestratorError(
        `Speech2Text invocation failed: ${errorMessage}`,
        'transcribe',
        provider,
        model,
        error as Error
      )
    }
  }

  /**
   * Resolve provider + model from the request, falling back to the org-default
   * configured for ModelType.SPEECH2TEXT.
   */
  private async resolveProviderModel(
    req: Speech2TextInvocationRequest
  ): Promise<{ provider: string; model: string }> {
    if (req.provider && req.model) return { provider: req.provider, model: req.model }

    const defaults = await getOrgCache().get(req.organizationId, 'aiDefaultModels')
    const entry = defaults[ModelType.SPEECH2TEXT]
    if (!entry) {
      throw new OrchestratorError(
        'No default speech-to-text model configured for organization',
        'transcribe'
      )
    }
    return {
      provider: req.provider ?? entry.provider,
      model: req.model ?? entry.model,
    }
  }

  /**
   * Single-pass gate:
   *   1. Resolve credentials + speech2text client.
   *   2. SYSTEM credit-pool check (skipped for CUSTOM credentials).
   *   3. abuse rate-limit consume on `aiTranscriptions`.
   */
  private async enforceQuotaGate(
    provider: string,
    model: string,
    organizationId: string,
    userId: string
  ): Promise<{
    client: Speech2TextClient
    providerType: ProviderTypeValue
    credentialSource: CredentialSourceType
  }> {
    const providerManager = new ProviderManager(this.db!, organizationId, userId)
    const credentials = await providerManager.getCurrentCredentials(
      provider,
      model,
      ModelType.SPEECH2TEXT,
      false
    )
    const providerClient = await ProviderRegistry.createClient(provider, organizationId, userId)
    const client = providerClient.getClient(
      ModelType.SPEECH2TEXT,
      credentials.credentials
    ) as Speech2TextClient

    const providerType: ProviderTypeValue = credentials.providerType ?? 'CUSTOM'
    const credentialSource: CredentialSourceType = credentials.credentialSource ?? 'CUSTOM'

    if (!this.config.enableQuotaEnforcement || !this.db) {
      return { client, providerType, credentialSource }
    }

    if (providerType === 'SYSTEM') {
      const quota = new QuotaService(this.db, organizationId)
      const status = await quota.getQuotaStatus()
      if (status?.isExceeded) {
        throw new QuotaExceededError(
          "You're out of AI credits. They'll refill at the start of your next billing cycle.",
          {
            provider,
            quotaUsed: status.quotaUsed,
            quotaLimit: status.quotaLimit,
            bonusCredits: status.bonusCredits,
            resetsAt: status.quotaPeriodEnd,
          }
        )
      }
    }

    const guard = await createUsageGuard(this.db)
    if (guard) {
      const usageResult = await guard.consume(organizationId, 'aiTranscriptions', { userId })
      if (!usageResult.allowed) {
        throw new UsageLimitError({
          metric: 'aiTranscriptions',
          current: usageResult.current ?? 0,
          limit: usageResult.limit ?? 0,
          message:
            'Transcription rate limit reached for this billing period. Please contact support if this is unexpected.',
        })
      }
    }

    return { client, providerType, credentialSource }
  }
}
