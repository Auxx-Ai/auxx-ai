// packages/lib/src/ai/providers/kimi/kimi-client.ts

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
import { KIMI_CAPABILITIES, KIMI_MODELS } from './kimi-defaults'
import { KimiLLMClient } from './kimi-llm-client'

const KIMI_BASE_URL = 'https://api.moonshot.ai/v1'

/**
 * Kimi (Moonshot AI) provider client implementation.
 * Uses the OpenAI SDK with a custom base URL since Kimi's API is OpenAI-compatible.
 */
export class KimiClient extends ProviderClient {
  private llmClient?: KimiLLMClient

  constructor(organizationId: string, userId: string, cache?: any) {
    super(KIMI_CAPABILITIES, organizationId, userId, cache)
  }

  async validateCredentials(credentials: Record<string, any>): Promise<ValidationResult> {
    this.logOperationStart('validateCredentials')

    const schemaResult = this.validateSchema(credentials)
    if (!schemaResult.isValid) {
      this.logOperationError('validateCredentials', schemaResult.error)
      return {
        isValid: false,
        error: schemaResult.error,
        details: { fieldErrors: schemaResult.fieldErrors },
      }
    }

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
        `Kimi credential validation failed: ${errorMessage}`,
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
      const testModel = model || 'kimi-k2.5'

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
      const errorMessage = this.parseKimiError(error)

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
    const apiKey =
      this.extractCredentialField(rawCredentials, 'api_key') ||
      this.extractCredentialField(rawCredentials, 'kimi_api_key') ||
      rawCredentials.apiKey

    return {
      kimi_api_key: apiKey,
    }
  }

  getApiClient(credentials: ProviderCredentials): OpenAI {
    return new OpenAI({
      apiKey: credentials.kimi_api_key as string,
      baseURL: KIMI_BASE_URL,
    })
  }

  getModels(): Record<string, ModelCapabilities> {
    return KIMI_MODELS
  }

  getClient(modelType: ModelType, credentials: ProviderCredentials): BaseSpecializedClient {
    if (modelType === ModelType.LLM) {
      if (!this.llmClient) {
        this.llmClient = new KimiLLMClient(
          this.getApiClient(credentials),
          DEFAULT_CLIENT_CONFIG,
          this.logger
        )
      }
      return this.llmClient
    }

    throw new Error(`Kimi does not support model type: ${modelType}`)
  }

  /**
   * Parse Kimi API errors into user-friendly messages
   */
  private parseKimiError(error: any): string {
    if (error?.error?.message) {
      return `Kimi API Error: ${error.error.message}`
    }

    if (error?.message) {
      if (error.message.includes('401')) {
        return 'Invalid API key. Please check your Kimi API key.'
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

    return 'Unknown Kimi API error occurred'
  }
}
