// packages/lib/src/test/live-llm-orchestrator.ts

import Anthropic from '@anthropic-ai/sdk'
import { vi } from 'vitest'
import type { LLMClient } from '../ai/clients/base/llm-client'
import { DEFAULT_CLIENT_CONFIG } from '../ai/clients/base/types'
import type { LLMOrchestrator } from '../ai/orchestrator/llm-orchestrator'
import type { LLMInvocationRequest } from '../ai/orchestrator/types'
import { AnthropicLLMClient } from '../ai/providers/anthropic/anthropic-llm-client'
import { OpenAILLMClient } from '../ai/providers/openai/openai-llm-client'

/** The chat models the live decision suites run the LLM adapter against, with their keys. */
export const LIVE_DECISION_LLMS = [
  { provider: 'openai', model: 'gpt-5.4-nano', apiKey: process.env.OPENAI_API_KEY },
  {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
] as const

const CONFIG = {
  ...DEFAULT_CLIENT_CONFIG,
  retries: { ...DEFAULT_CLIENT_CONFIG.retries, maxAttempts: 1 },
}

async function llmClient(provider: string, apiKey: string): Promise<LLMClient> {
  if (provider === 'openai') {
    // `src/test/setup.ts` mocks `openai` globally; live calls need the real SDK.
    const { default: OpenAI } = await vi.importActual<typeof import('openai')>('openai')
    return new OpenAILLMClient(new OpenAI({ apiKey }), CONFIG)
  }
  if (provider === 'anthropic') return new AnthropicLLMClient(new Anthropic({ apiKey }), CONFIG)
  throw new Error(`No live client for ${provider}`)
}

/**
 * Stands in for `LLMOrchestrator` in live-API tests: the same invoke params and
 * structured-output parsing as `llm-orchestrator.ts`, without credentials, quota or metering.
 */
export async function liveOrchestrator(provider: string, apiKey: string): Promise<LLMOrchestrator> {
  const client = await llmClient(provider, apiKey)
  const invoke = async (request: LLMInvocationRequest) => {
    const schema = request.structuredOutput?.enabled ? request.structuredOutput.schema : undefined
    const response = await client.invoke({
      model: request.model,
      messages: request.messages,
      parameters: request.parameters,
      tools: [],
      stream: false,
      response_format: schema ? 'json_schema' : undefined,
      json_schema: schema ? JSON.stringify(schema) : undefined,
    })
    const cleaned = (response.content ?? '')
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\n?```\s*$/, '')
    return { ...response, structured_output: schema ? JSON.parse(cleaned) : undefined }
  }
  return { invoke } as unknown as LLMOrchestrator
}
