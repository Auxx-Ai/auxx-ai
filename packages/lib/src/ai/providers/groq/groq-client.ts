// packages/lib/src/ai/providers/groq/groq-client.ts

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
import { GROQ_CAPABILITIES, GROQ_MODELS } from './groq-defaults'
import { GroqLLMClient } from './groq-llm-client'

/** Groq's OpenAI-compatible endpoint. https://console.groq.com/docs/openai */
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'

/**
 * Groq provider client implementation.
 * Uses the OpenAI SDK with a custom base URL since Groq's API is OpenAI-compatible.
 */
export class GroqClient extends ProviderClient {
  private llmClient?: GroqLLMClient

  constructor(organizationId: string, userId: string, cache?: any) {
    super(GROQ_CAPABILITIES, organizationId, userId, cache)
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
        `Groq credential validation failed: ${errorMessage}`,
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
      const testModel = model || 'llama-3.3-70b-versatile'

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
      const errorMessage = this.parseGroqError(error)

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
      baseURL: GROQ_BASE_URL,
      // Retry policy lives in RetryManager — don't stack the SDK's 2 internal retries.
      maxRetries: 0,
      fetch: createObservingFetch('groq'),
    })
  }

  getModels(): Record<string, ModelCapabilities> {
    return GROQ_MODELS
  }

  getClient(modelType: ModelType, credentials: ProviderCredentials): BaseSpecializedClient {
    if (modelType === ModelType.LLM) {
      if (!this.llmClient) {
        this.llmClient = new GroqLLMClient(
          this.getApiClient(credentials),
          DEFAULT_CLIENT_CONFIG,
          this.logger
        )
      }
      return this.llmClient
    }

    throw new Error(`Groq does not support model type: ${modelType}`)
  }

  /**
   * Parse Groq API errors into user-friendly messages
   */
  private parseGroqError(error: any): string {
    if (error?.error?.message) {
      return `Groq API Error: ${error.error.message}`
    }

    if (error?.message) {
      if (error.message.includes('401')) {
        return 'Invalid API key. Please check your Groq API key.'
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

    return 'Unknown Groq API error occurred'
  }
}
