// packages/lib/src/ai/providers/openai/openai-client.ts

import { configService } from '@auxx/credentials'
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
import { OPENAI_CAPABILITIES, OPENAI_MODELS } from './openai-defaults'
import {
  OpenAILLMClient,
  OpenAIModerationClient,
  OpenAISpeech2TextClient,
  OpenAITextEmbeddingClient,
  OpenAITTSClient,
} from './specialized-clients'

/**
 * OpenAI provider client implementation
 */
export class OpenAIClient extends ProviderClient {
  private llmClient?: OpenAILLMClient
  private embeddingClient?: OpenAITextEmbeddingClient
  private speech2textClient?: OpenAISpeech2TextClient
  private moderationClient?: OpenAIModerationClient
  private ttsClient?: OpenAITTSClient

  constructor(organizationId: string, userId: string, cache?: any, db?: any) {
    super(OPENAI_CAPABILITIES, organizationId, userId, cache, db)
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
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logOperationError('validateCredentials', errorMessage)

      throw new CredentialValidationError(
        `OpenAI credential validation failed: ${errorMessage}`,
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
      const openai = this.getApiClient(extractedCreds)

      if (model) {
        // Test specific model with a minimal chat completion
        await openai.chat.completions.create({
          model,
          messages: [{ role: 'user', content: 'Test' }],
          max_tokens: 1,
          temperature: 0,
        })

        this.logOperationSuccess('testConnection', {
          model,
          responseTime: Date.now() - startTime,
        })

        return {
          success: true,
          responseTime: Date.now() - startTime,
          modelsTested: [model],
        }
      } else {
        // Test general API access by listing models
        await openai.models.list()

        this.logOperationSuccess('testConnection', {
          responseTime: Date.now() - startTime,
        })

        return {
          success: true,
          responseTime: Date.now() - startTime,
        }
      }
    } catch (error) {
      const responseTime = Date.now() - startTime
      const errorMessage = this.parseOpenAIError(error)

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
      this.extractCredentialField(rawCredentials, 'openai_api_key') ||
      rawCredentials.apiKey

    const organization =
      this.extractCredentialField(rawCredentials, 'organization') ||
      this.extractCredentialField(rawCredentials, 'openai_organization') ||
      rawCredentials.organization

    const apiBase =
      this.extractCredentialField(rawCredentials, 'api_base') ||
      this.extractCredentialField(rawCredentials, 'openai_api_base') ||
      rawCredentials.baseURL ||
      'https://api.openai.com/v1'

    return {
      openai_api_key: apiKey,
      openai_organization: organization,
      openai_api_base: apiBase,
    }
  }

  getApiClient(credentials: ProviderCredentials): OpenAI {
    const config: any = {
      apiKey: credentials.openai_api_key,
    }

    if (credentials.openai_organization) {
      config.organization = credentials.openai_organization
    }

    if (
      credentials.openai_api_base &&
      credentials.openai_api_base !== 'https://api.openai.com/v1'
    ) {
      config.baseURL = credentials.openai_api_base
    }

    return new OpenAI(config)
  }

  getModels(): Record<string, ModelCapabilities> {
    return OPENAI_MODELS
  }

  getClient(modelType: ModelType, credentials: ProviderCredentials): BaseSpecializedClient {
    switch (modelType) {
      case ModelType.LLM:
        if (!this.llmClient) {
          this.llmClient = new OpenAILLMClient(
            this.getApiClient(credentials),
            DEFAULT_CLIENT_CONFIG,
            this.logger
          )
        }
        return this.llmClient

      case ModelType.TEXT_EMBEDDING:
        if (!this.embeddingClient) {
          this.embeddingClient = new OpenAITextEmbeddingClient(
            this.getApiClient(credentials),
            DEFAULT_CLIENT_CONFIG,
            this.logger
          )
        }
        return this.embeddingClient

      case ModelType.SPEECH2TEXT:
        if (!this.speech2textClient) {
          this.speech2textClient = new OpenAISpeech2TextClient(
            this.getApiClient(credentials),
            DEFAULT_CLIENT_CONFIG,
            this.logger
          )
        }
        return this.speech2textClient

      case ModelType.MODERATION:
        if (!this.moderationClient) {
          this.moderationClient = new OpenAIModerationClient(
            this.getApiClient(credentials),
            DEFAULT_CLIENT_CONFIG,
            this.logger
          )
        }
        return this.moderationClient

      case ModelType.TTS:
        if (!this.ttsClient) {
          this.ttsClient = new OpenAITTSClient(
            this.getApiClient(credentials),
            DEFAULT_CLIENT_CONFIG,
            this.logger
          )
        }
        return this.ttsClient

      default:
        throw new Error(`Unsupported model type: ${modelType}`)
    }
  }

  private getStoredCredentials(): ProviderCredentials {
    // This is a placeholder - in practice, credentials would be retrieved from
    // the provider manager or stored securely
    return {
      openai_api_key: configService.get<string>('OPENAI_API_KEY') || '',
      openai_organization: configService.get<string>('OPENAI_ORGANIZATION'),
      openai_api_base: 'https://api.openai.com/v1',
    }
  }

  /**
   * Parse OpenAI API errors into user-friendly messages
   */
  private parseOpenAIError(error: any): string {
    if (error?.error?.message) {
      return `OpenAI API Error: ${error.error.message}`
    }

    if (error?.message) {
      // Handle common OpenAI error patterns
      if (error.message.includes('401')) {
        return 'Invalid API key. Please check your OpenAI API key.'
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

    return 'Unknown OpenAI API error occurred'
  }
}
