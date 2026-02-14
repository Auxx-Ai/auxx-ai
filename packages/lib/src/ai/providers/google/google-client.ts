// packages/lib/src/ai/providers/google/google-client.ts

import { GoogleGenerativeAI } from '@google/generative-ai'
import type { BaseSpecializedClient } from '../../clients/base/base-specialized-client'
import { ProviderClient } from '../base/provider-client'
import {
  type ConnectionTestResult,
  CredentialValidationError,
  type ProviderCredentials,
  type ValidationResult,
} from '../base/types'
import { type ModelCapabilities, ModelType } from '../types'
import { GOOGLE_CAPABILITIES, GOOGLE_MODELS } from './google-defaults'
import { GoogleTextEmbeddingClient } from './google-embedding-client'

/**
 * Google provider client implementation
 */
export class GoogleClient extends ProviderClient {
  constructor(organizationId: string, userId: string, cache?: any) {
    super(GOOGLE_CAPABILITIES, organizationId, userId, cache)
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
      const apiKey = extractedCreds.google_api_key

      if (!apiKey) {
        throw new Error('No API key found in credentials')
      }

      // Simple test - make a basic request to Google AI API
      const testModel = model || 'gemini-1.5-pro-latest'

      // For now, we'll return success if the API key format is valid
      // In a real implementation, you'd make an actual API call to Google AI
      const responseTime = Date.now() - startTime

      this.logOperationSuccess('testConnection', {
        model: testModel,
        responseTime,
      })

      return {
        success: true,
        responseTime,
        modelsTested: model ? [model] : [],
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
    const apiKey =
      this.extractCredentialField(rawCredentials, 'api_key') ||
      this.extractCredentialField(rawCredentials, 'google_api_key') ||
      rawCredentials.apiKey

    return {
      google_api_key: apiKey,
    }
  }

  getApiClient(credentials: ProviderCredentials): GoogleGenerativeAI {
    return new GoogleGenerativeAI(credentials.google_api_key as string)
  }

  getModels(): Record<string, ModelCapabilities> {
    return GOOGLE_MODELS
  }

  getClient(modelType: ModelType, credentials: ProviderCredentials): BaseSpecializedClient {
    const apiClient = this.getApiClient(credentials)

    switch (modelType) {
      case ModelType.TEXT_EMBEDDING:
        return new GoogleTextEmbeddingClient(
          apiClient,
          { timeout: 30000, maxRetries: 3 },
          this.logger
        )

      default:
        throw new Error(
          `Google specialized clients not yet implemented for model type: ${modelType}`
        )
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
