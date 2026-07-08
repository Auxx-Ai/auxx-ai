// packages/lib/src/ai/providers/google/google-client.ts

import { GoogleGenerativeAI } from '@google/generative-ai'
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
import { GOOGLE_CAPABILITIES, GOOGLE_MODELS } from './google-defaults'
import { GoogleTextEmbeddingClient } from './google-embedding-client'
import { GoogleLLMClient } from './google-llm-client'

/**
 * Gemini's OpenAI-compatible endpoint — chat completions for all Gemini models.
 * https://ai.google.dev/gemini-api/docs/openai
 */
const GOOGLE_OPENAI_COMPAT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'

/**
 * Google provider client implementation.
 * LLM traffic goes through Gemini's OpenAI-compatible endpoint via the OpenAI
 * SDK; embeddings use the native Google Generative AI SDK.
 */
export class GoogleClient extends ProviderClient {
  private llmClient?: GoogleLLMClient

  constructor(organizationId: string, userId: string, cache?: any) {
    super(GOOGLE_CAPABILITIES, organizationId, userId, cache)
  }

  async validateCredentials(credentials: Record<string, any>): Promise<ValidationResult> {
    this.logOperationStart('validateCredentials')

    try {
      // Test the API connection
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
        `Google credential validation failed: ${errorMessage}`,
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
      const client = this.getOpenAiCompatClient(extractedCreds)
      const testModel = model || 'gemini-2.5-flash'

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
      const errorMessage = this.parseGoogleError(error)

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

  getApiClient(credentials: ProviderCredentials): GoogleGenerativeAI {
    return new GoogleGenerativeAI(this.requireApiKey(credentials, 'apiKey'))
  }

  /**
   * OpenAI SDK client pointed at Gemini's OpenAI-compatible endpoint.
   * The API key rides in the standard `Authorization: Bearer` header.
   */
  getOpenAiCompatClient(credentials: ProviderCredentials): OpenAI {
    return new OpenAI({
      apiKey: this.requireApiKey(credentials, 'apiKey'),
      baseURL: GOOGLE_OPENAI_COMPAT_BASE_URL,
      // Retry policy lives in RetryManager — don't stack the SDK's 2 internal retries.
      maxRetries: 0,
      fetch: createObservingFetch('google'),
    })
  }

  getModels(): Record<string, ModelCapabilities> {
    return GOOGLE_MODELS
  }

  getClient(modelType: ModelType, credentials: ProviderCredentials): BaseSpecializedClient {
    switch (modelType) {
      case ModelType.LLM:
        if (!this.llmClient) {
          this.llmClient = new GoogleLLMClient(
            this.getOpenAiCompatClient(credentials),
            DEFAULT_CLIENT_CONFIG,
            this.logger
          )
        }
        return this.llmClient

      case ModelType.TEXT_EMBEDDING:
        return new GoogleTextEmbeddingClient(
          this.getApiClient(credentials),
          { timeout: 30000, maxRetries: 3 },
          this.logger
        )

      default:
        throw new Error(`Google does not support model type: ${modelType}`)
    }
  }

  /**
   * Parse Google AI API errors into user-friendly messages
   */
  private parseGoogleError(error: any): string {
    if (error?.error?.message) {
      return `Google AI API Error: ${error.error.message}`
    }

    if (error?.message) {
      // Handle common Google AI error patterns
      if (error.message.includes('401')) {
        return 'Invalid API key. Please check your Google AI API key.'
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

    return 'Unknown Google AI API error occurred'
  }
}
