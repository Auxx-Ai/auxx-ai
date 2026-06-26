// packages/lib/src/ai/providers/zai/zai-client.ts

import OpenAI from 'openai'
import { type BaseSpecializedClient, DEFAULT_CLIENT_CONFIG } from '../../clients/base/types'
import { ProviderClient } from '../base/provider-client'
import {
  type ConnectionTestResult,
  CredentialValidationError,
  type ProviderCredentials,
  type ValidationResult,
} from '../base/types'
import { type ModelCapabilities, ModelType } from '../types'
import { createObservingFetch } from '../utils'
import { ZAI_CAPABILITIES, ZAI_MODELS } from './zai-defaults'
import { ZaiLLMClient } from './zai-llm-client'

const ZAI_BASE_URL = 'https://api.z.ai/api/paas/v4'

/**
 * Z.AI (Zhipu / GLM) provider client implementation.
 * Uses the OpenAI SDK with a custom base URL since Z.AI's API is OpenAI-compatible.
 * Auth is a plain Bearer API key (the international z.ai platform does not require JWT signing).
 */
export class ZaiClient extends ProviderClient {
  private llmClient?: ZaiLLMClient

  constructor(organizationId: string, userId: string, cache?: any) {
    super(ZAI_CAPABILITIES, organizationId, userId, cache)
  }

  async validateCredentials(credentials: Record<string, any>): Promise<ValidationResult> {
    this.logOperationStart('validateCredentials')

    try {
      const testResult = await this.testConnection(credentials)

      if (testResult.success) {
        this.logOperationSuccess('validateCredentials', {
          responseTime: testResult.responseTime,
        })
        return { isValid: true }
      } else {
        this.logOperationError('validateCredentials', testResult.error)
        return {
          isValid: false,
          error: testResult.error || 'Connection test failed',
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logOperationError('validateCredentials', errorMessage)

      throw new CredentialValidationError(
        `Z.AI credential validation failed: ${errorMessage}`,
        this.getProviderId()
      )
    }
  }

  async testConnection(
    credentials: Record<string, any>,
    model?: string
  ): Promise<ConnectionTestResult> {
    const startTime = Date.now()
    this.logOperationStart('testConnection', { model })

    try {
      const extractedCreds = this.extractCredentials(credentials)
      const client = this.getApiClient(extractedCreds)
      const testModel = model || 'glm-5.2'

      await client.chat.completions.create({
        model: testModel,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      })

      const responseTime = Date.now() - startTime

      this.logOperationSuccess('testConnection', {
        model: testModel,
        responseTime,
      })

      return {
        success: true,
        responseTime,
        modelsTested: [testModel],
      }
    } catch (error) {
      const responseTime = Date.now() - startTime
      const errorMessage = this.parseZaiError(error)

      this.logOperationError('testConnection', errorMessage, {
        responseTime,
        model,
      })

      return {
        success: false,
        error: errorMessage,
        responseTime,
        modelsTested: model ? [model] : [],
      }
    }
  }

  extractCredentials(rawCredentials: Record<string, any>): ProviderCredentials {
    return {
      apiKey: String(rawCredentials.apiKey || ''),
    }
  }

  getApiClient(credentials: ProviderCredentials): OpenAI {
    return new OpenAI({
      apiKey: this.requireApiKey(credentials, 'apiKey'),
      baseURL: ZAI_BASE_URL,
      // Retry policy lives in RetryManager — don't stack the SDK's 2 internal retries.
      maxRetries: 0,
      fetch: createObservingFetch('zai'),
    })
  }

  getModels(): Record<string, ModelCapabilities> {
    return ZAI_MODELS
  }

  getClient(modelType: ModelType, credentials: ProviderCredentials): BaseSpecializedClient {
    if (modelType === ModelType.LLM) {
      if (!this.llmClient) {
        this.llmClient = new ZaiLLMClient(
          this.getApiClient(credentials),
          DEFAULT_CLIENT_CONFIG,
          this.logger
        )
      }
      return this.llmClient
    }

    throw new Error(`Z.AI does not support model type: ${modelType}`)
  }

  /**
   * Parse Z.AI API errors into user-friendly messages
   */
  private parseZaiError(error: any): string {
    if (error?.error?.message) {
      return `Z.AI API Error: ${error.error.message}`
    }

    if (error?.message) {
      if (error.message.includes('401')) {
        return 'Invalid API key. Please check your Z.AI API key.'
      }
      if (error.message.includes('429')) {
        return 'Rate limit exceeded. Please try again later.'
      }
      if (error.message.includes('404')) {
        return 'Model not found or not accessible with your API key.'
      }
      if (error.message.includes('timeout')) {
        return 'Request timed out. Please check your connection.'
      }

      return error.message
    }

    return 'Unknown Z.AI API error occurred'
  }
}
