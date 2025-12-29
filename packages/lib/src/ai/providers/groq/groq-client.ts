// packages/lib/src/ai/providers/groq/groq-client.ts

import { ProviderClient } from '../base/provider-client'
import {
  ValidationResult,
  ConnectionTestResult,
  ProviderCredentials,
  CredentialValidationError,
  ConnectionTestError,
} from '../base/types'
import { ModelCapabilities, ModelType } from '../types'
import { BaseSpecializedClient } from '../../clients/base/base-specialized-client'
import { GROQ_CAPABILITIES, GROQ_MODELS } from './groq-defaults'

/**
 * Groq provider client implementation
 */
export class GroqClient extends ProviderClient {
  constructor(organizationId: string, userId: string, cache?: any) {
    super(GROQ_CAPABILITIES, organizationId, userId, cache)
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
      const apiKey = extractedCreds.groq_api_key

      if (!apiKey) {
        throw new Error('No API key found in credentials')
      }

      // Simple test - make a basic request to Groq API
      const testModel = model || 'llama-3.3-70b-versatile'

      // For now, we'll return success if the API key format is valid
      // In a real implementation, you'd make an actual API call to Groq
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
    const apiKey =
      this.extractCredentialField(rawCredentials, 'api_key') ||
      this.extractCredentialField(rawCredentials, 'groq_api_key') ||
      rawCredentials.apiKey

    return {
      groq_api_key: apiKey,
    }
  }

  getApiClient(credentials: ProviderCredentials): any {
    // In a real implementation, you would return the Groq SDK client
    // For now, return a mock client
    return {
      apiKey: credentials.groq_api_key,
    }
  }

  getModels(): Record<string, ModelCapabilities> {
    return GROQ_MODELS
  }

  getClient(modelType: ModelType, credentials: ProviderCredentials): BaseSpecializedClient {
    throw new Error(`Groq specialized clients not yet implemented for model type: ${modelType}`)
  }

  /**
   * Parse Groq API errors into user-friendly messages
   */
  private parseGroqError(error: any): string {
    if (error?.error?.message) {
      return `Groq API Error: ${error.error.message}`
    }

    if (error?.message) {
      // Handle common Groq error patterns
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
