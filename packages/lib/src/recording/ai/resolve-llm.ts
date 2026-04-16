// packages/lib/src/recording/ai/resolve-llm.ts

import type { Database } from '@auxx/database'
import { LLMOrchestrator } from '../../ai/orchestrator/llm-orchestrator'
import { ModelType } from '../../ai/providers/types'
import { UsageTrackingService } from '../../ai/usage/usage-tracking-service'
import { getCachedDefaultModel } from '../../cache/org-cache-helpers'

const FALLBACK_PROVIDER = 'anthropic'
const FALLBACK_MODEL = 'claude-sonnet-4-5'

export interface ResolvedRecordingLLM {
  orchestrator: LLMOrchestrator
  provider: string
  model: string
}

/**
 * Build an LLM orchestrator for a recording AI operation using the org's default
 * LLM model (or a hardcoded fallback if none is configured).
 */
export async function resolveRecordingLLM(
  db: Database,
  organizationId: string
): Promise<ResolvedRecordingLLM> {
  const systemDefault = await getCachedDefaultModel(organizationId, ModelType.LLM)
  const provider = systemDefault?.provider ?? FALLBACK_PROVIDER
  const model = systemDefault?.model ?? FALLBACK_MODEL

  const usageService = new UsageTrackingService(db)
  const orchestrator = new LLMOrchestrator(usageService, db, {
    enableUsageTracking: true,
  })

  return { orchestrator, provider, model }
}
