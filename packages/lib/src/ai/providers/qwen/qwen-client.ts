// packages/lib/src/ai/providers/qwen/qwen-client.ts

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
import { QWEN_CAPABILITIES, QWEN_MODELS } from './qwen-defaults'
import { QwenLLMClient } from './qwen-llm-client'

const QWEN_DEFAULT_BASE_URL = 'https://dashscope-us.aliyuncs.com/compatible-mode/v1'

/**
 * Qwen provider client implementation.
 * Uses the OpenAI SDK with a custom base URL since Qwen's DashScope API is OpenAI-compatible.
 */
export class QwenClient extends ProviderClient {
  private llmClient?: QwenLLMClient

  constructor(organizationId: string, userId: string, cache?: any) {
    super(QWEN_CAPABILITIES, organizationId, userId, cache)
  }

  async validateCredentials(credentials: Record<string, any>): Promise<ValidationResult> {
    this.logOperationStart('validateCredentials')

    const schemaResult = this.validateSchema(credentials)
    if (!schemaResult.isValid) {
      this.logOperationError('validateCredentials', schemaResult.error, {
        fieldErrors: schemaResult.fieldErrors,
        credentialKeys: Object.keys(credentials),
      })
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
        `Qwen credential validation failed: ${errorMessage}`,
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
      const baseUrl = (extractedCreds.qwen_api_base as string) || QWEN_DEFAULT_BASE_URL
      const isUsRegion = baseUrl.includes('dashscope-us')
      const testModel = model || (isUsRegion ? 'qwen-plus-us' : 'qwen-plus-latest')

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
      const errorMessage = this.parseQwenError(error)

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
      this.extractCredentialField(rawCredentials, 'qwen_api_key') ||
      rawCredentials.apiKey

    const apiBase =
      this.extractCredentialField(rawCredentials, 'api_base') ||
      this.extractCredentialField(rawCredentials, 'qwen_api_base') ||
      rawCredentials.apiBase

    return {
      qwen_api_key: apiKey,
      qwen_api_base: apiBase,
    }
  }

  getApiClient(credentials: ProviderCredentials): OpenAI {
    return new OpenAI({
      apiKey: this.requireApiKey(credentials, 'qwen_api_key'),
      baseURL: (credentials.qwen_api_base as string) || QWEN_DEFAULT_BASE_URL,
    })
  }

  getModels(): Record<string, ModelCapabilities> {
    return QWEN_MODELS
  }

  getClient(modelType: ModelType, credentials: ProviderCredentials): BaseSpecializedClient {
    if (modelType === ModelType.LLM) {
      if (!this.llmClient) {
        this.llmClient = new QwenLLMClient(
          this.getApiClient(credentials),
          DEFAULT_CLIENT_CONFIG,
          this.logger
        )
      }
      return this.llmClient
    }

    throw new Error(`Qwen does not support model type: ${modelType}`)
  }

  /**
   * Parse Qwen API errors into user-friendly messages
   */
  private parseQwenError(error: any): string {
    const rawMessage = error?.error?.message || error?.message || ''

    if (rawMessage.includes('Access denied') || rawMessage.includes('access-denied')) {
      return 'Access denied. This usually means the model is not available in your selected region. US region only supports models ending in "-us" (e.g. qwen-plus-us). International models like qwen-plus-latest require the Singapore or China endpoint.'
    }

    if (error?.error?.message) {
      return `Qwen API Error: ${error.error.message}`
    }

    if (error?.message) {
      if (error.message.includes('401')) {
        return 'Invalid API key. Please check your DashScope API key.'
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

    return 'Unknown Qwen API error occurred'
  }
}
