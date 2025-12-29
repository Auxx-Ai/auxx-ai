// packages/lib/src/ai/providers/anthropic/anthropic-client.ts

import Anthropic from '@anthropic-ai/sdk'
import { ProviderClient } from '../base/provider-client'
import {
  ValidationResult,
  ConnectionTestResult,
  ProviderCredentials,
  CredentialValidationError,
} from '../base/types'
import { ModelCapabilities, ModelType } from '../types'
import { ANTHROPIC_CAPABILITIES, ANTHROPIC_MODELS } from './anthropic-defaults'
import { BaseSpecializedClient } from '../../clients/base/base-specialized-client'
import { AnthropicLLMClient } from './anthropic-llm-client'
import { VoyageEmbeddingClient } from './voyage-embedding-client'
import { DEFAULT_CLIENT_CONFIG } from '../../clients/base/types'

/**
 * Anthropic provider client implementation
 */
export class AnthropicClient extends ProviderClient {
  private llmClient?: AnthropicLLMClient
  private embeddingClient?: VoyageEmbeddingClient
  
  constructor(organizationId: string, userId: string, cache?: any) {
    super(ANTHROPIC_CAPABILITIES, organizationId, userId, cache)
  }

  async validateCredentials(credentials: Record<string, any>): Promise<ValidationResult> {
    this.logOperationStart('validateCredentials')

    // DEBUG: Log the incoming credentials to see what we're receiving
    console.log(
      '🔍 Anthropic validateCredentials - received credentials:',
      JSON.stringify(credentials, null, 2)
    )

    // First validate schema
    const schemaResult = this.validateSchema(credentials)
    if (!schemaResult.isValid) {
      this.logOperationError('validateCredentials', schemaResult.error)
      console.log(
        '❌ Anthropic schema validation failed:',
        schemaResult.error,
        schemaResult.fieldErrors
      )
      return {
        isValid: false,
        error: schemaResult.error,
        details: { fieldErrors: schemaResult.fieldErrors },
      }
    }

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
        `Anthropic credential validation failed: ${errorMessage}`,
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
      const anthropic = this.getApiClient(extractedCreds)
      
      const testModel = model || 'claude-3-5-sonnet-20240620'
      
      // Test with minimal message to verify API access
      await anthropic.messages.create({
        model: testModel,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }]
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
      const errorMessage = this.parseAnthropicError(error)

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
      String(this.extractCredentialField(rawCredentials, 'api_key') || '') ||
      String(this.extractCredentialField(rawCredentials, 'anthropic_api_key') || '') ||
      String(rawCredentials.apiKey || '')

    // DEBUG: Log credential extraction process
    console.log('🔍 Anthropic extractCredentials - raw:', JSON.stringify(rawCredentials, null, 2))
    console.log(
      '🔍 Anthropic extractCredentials - extracted apiKey:',
      apiKey ? 'Found (' + apiKey.substring(0, 10) + '...)' : 'Not found'
    )

    return {
      anthropic_api_key: apiKey,
    }
  }

  getApiClient(credentials: ProviderCredentials): Anthropic {
    return new Anthropic({
      apiKey: credentials.anthropic_api_key,
    })
  }

  getModels(): Record<string, ModelCapabilities> {
    return ANTHROPIC_MODELS
  }

  getClient(modelType: ModelType, credentials: ProviderCredentials): BaseSpecializedClient {
    switch (modelType) {
      case ModelType.LLM:
        if (!this.llmClient) {
          this.llmClient = new AnthropicLLMClient(
            this.getApiClient(credentials),
            DEFAULT_CLIENT_CONFIG,
            this.logger
          )
        }
        return this.llmClient
      
      case ModelType.TEXT_EMBEDDING:
        if (!this.embeddingClient) {
          // Voyage AI requires separate API key - check for voyage_api_key in credentials
          const voyageApiKey = credentials.voyage_api_key || credentials.anthropic_api_key
          this.embeddingClient = new VoyageEmbeddingClient(
            { apiKey: voyageApiKey as string },
            DEFAULT_CLIENT_CONFIG,
            this.logger
          )
        }
        return this.embeddingClient
      
      default:
        throw new Error(`Unsupported model type: ${modelType}`)
    }
  }

  /**
   * Parse Anthropic API errors into user-friendly messages
   */
  private parseAnthropicError(error: any): string {
    if (error?.error?.message) {
      return `Anthropic API Error: ${error.error.message}`
    }

    if (error?.message) {
      // Handle common Anthropic error patterns
      if (error.message.includes('401')) {
        return 'Invalid API key. Please check your Anthropic API key.'
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

    return 'Unknown Anthropic API error occurred'
  }
}
