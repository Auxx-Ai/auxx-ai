// packages/lib/src/ai/providers/cohere/cohere-client.ts

import { CohereClient as CohereAPIClient } from 'cohere-ai'
import type { BaseSpecializedClient } from '../../clients/base/base-specialized-client'
import { DEFAULT_CLIENT_CONFIG } from '../../clients/base/types'
import { ProviderClient } from '../base/provider-client'
import {
  type ConnectionTestResult,
  CredentialValidationError,
  type ProviderCredentials,
  type ValidationResult,
} from '../base/types'
import { type ModelCapabilities, ModelType } from '../types'
import { CohereTextEmbeddingClient } from './cohere-embedding-client'

// Define Cohere capabilities and models
const COHERE_CAPABILITIES = {
  id: 'cohere',
  name: 'Cohere',
  description: 'Cohere AI platform for embeddings and language models',
  icon: 'cohere',
  color: '#FF6B35',
  supported_model_types: [ModelType.TEXT_EMBEDDING],
  configurable: true,
  credential_form_schema: {
    api_key: {
      type: 'secret-input',
      required: true,
      label: 'API Key',
      placeholder: 'Enter your Cohere API key',
    },
  },
}

const COHERE_MODELS: Record<string, ModelCapabilities> = {
  'embed-english-v3.0': {
    provider: 'cohere',
    modelId: 'embed-english-v3.0',
    displayName: 'Embed English v3.0',
    icon: 'cohere',
    color: '#FF6B35',
    contextLength: 512,
    maxTokens: 512,
    modelType: ModelType.TEXT_EMBEDDING,
    fetchFrom: 'predefined-model' as any,
    features: ['high-performance', 'english-optimized'],
    supports: {
      streaming: false,
      structured: false,
      vision: false,
      toolCalling: false,
      systemMessages: false,
    },
    costPer1kTokens: { input: 0.0001, output: 0 },
    parameterRules: [],
  },
  'embed-multilingual-v3.0': {
    provider: 'cohere',
    modelId: 'embed-multilingual-v3.0',
    displayName: 'Embed Multilingual v3.0',
    icon: 'cohere',
    color: '#FF6B35',
    contextLength: 512,
    maxTokens: 512,
    modelType: ModelType.TEXT_EMBEDDING,
    fetchFrom: 'predefined-model' as any,
    features: ['multilingual', 'high-performance'],
    supports: {
      streaming: false,
      structured: false,
      vision: false,
      toolCalling: false,
      systemMessages: false,
    },
    costPer1kTokens: { input: 0.0001, output: 0 },
    parameterRules: [],
  },
}

/**
 * Cohere provider client implementation
 */
export class CohereClient extends ProviderClient {
  private embeddingClient?: CohereTextEmbeddingClient

  constructor(organizationId: string, userId: string, cache?: any) {
    super(COHERE_CAPABILITIES, organizationId, userId, cache)
  }

  async validateCredentials(credentials: Record<string, any>): Promise<ValidationResult> {
    this.logOperationStart('validateCredentials')

    // First validate schema
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
      const errorMessage = this.parseCohereError(error)
      this.logOperationError('validateCredentials', errorMessage)
      return {
        isValid: false,
        error: errorMessage,
      }
    }
  }

  async testConnection(
    credentials: Record<string, any>,
    model?: string
  ): Promise<ConnectionTestResult> {
    const startTime = Date.now()
    const testModel = model || 'embed-english-v3.0'

    try {
      this.logOperationStart('testConnection', { model: testModel })

      // Create Cohere client and test with a simple embedding request
      const cohereClient = new CohereAPIClient({
        token: credentials.api_key || credentials.cohere_api_key,
      })

      // Test with a simple text
      await cohereClient.embed({
        texts: ['test'],
        model: testModel,
        inputType: 'search_document',
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
      const errorMessage = this.parseCohereError(error)

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
      this.extractCredentialField(rawCredentials, 'cohere_api_key') ||
      rawCredentials.apiKey

    return {
      cohere_api_key: apiKey,
    }
  }

  getApiClient(credentials: ProviderCredentials): CohereAPIClient {
    return new CohereAPIClient({
      token: credentials.cohere_api_key as string,
    })
  }

  getModels(): Record<string, ModelCapabilities> {
    return COHERE_MODELS
  }

  getClient(modelType: ModelType, credentials: ProviderCredentials): BaseSpecializedClient {
    switch (modelType) {
      case ModelType.TEXT_EMBEDDING:
        if (!this.embeddingClient) {
          this.embeddingClient = new CohereTextEmbeddingClient(
            this.getApiClient(credentials),
            DEFAULT_CLIENT_CONFIG,
            this.logger
          )
        }
        return this.embeddingClient

      default:
        throw new Error(
          `Cohere specialized clients not yet implemented for model type: ${modelType}`
        )
    }
  }

  /**
   * Parse Cohere API errors into user-friendly messages
   */
  private parseCohereError(error: any): string {
    if (error?.response?.data?.message) {
      return `Cohere API Error: ${error.response.data.message}`
    }

    if (error?.message) {
      // Handle common Cohere error patterns
      if (error.message.includes('401') || error.message.includes('unauthorized')) {
        return 'Invalid API key. Please check your Cohere API key.'
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

    return 'Unknown Cohere API error occurred'
  }
}
