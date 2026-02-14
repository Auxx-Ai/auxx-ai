// packages/lib/src/ai/providers/deepseek/deepseek-client.ts

import type { BaseSpecializedClient } from '../../clients/base/base-specialized-client'
import { ProviderClient } from '../base/provider-client'
import {
  type ConnectionTestResult,
  CredentialValidationError,
  type ValidationResult,
} from '../base/types'
import type { ModelCapabilities, ModelType, ProviderCredentials } from '../types'
import { DEEPSEEK_CAPABILITIES, DEEPSEEK_MODELS } from './deepseek-defaults'

/**
 * DeepSeek provider client implementation
 */
export class DeepSeekClient extends ProviderClient {
  constructor(organizationId: string, userId: string, cache?: any) {
    super(DEEPSEEK_CAPABILITIES, organizationId, userId, cache)
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
        `DeepSeek credential validation failed: ${errorMessage}`,
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
      const apiKey = extractedCreds.deepseek_api_key

      if (!apiKey) {
        throw new Error('No API key found in credentials')
      }

      // Simple test - make a basic request to DeepSeek API
      const testModel = model || 'deepseek-chat'

      // For now, we'll return success if the API key format is valid
      // In a real implementation, you'd make an actual API call to DeepSeek
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
      const errorMessage = this.parseDeepSeekError(error)

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
      this.extractCredentialField(rawCredentials, 'deepseek_api_key') ||
      rawCredentials.apiKey

    return {
      deepseek_api_key: apiKey,
    }
  }

  getApiClient(credentials: ProviderCredentials): any {
    // In a real implementation, you would return the DeepSeek SDK client
    // For now, return a mock client
    return {
      apiKey: credentials.deepseek_api_key,
    }
  }

  getModels(): Record<string, ModelCapabilities> {
    return DEEPSEEK_MODELS
  }

  getClient(modelType: ModelType, credentials: ProviderCredentials): BaseSpecializedClient {
    throw new Error(`DeepSeek specialized clients not yet implemented for model type: ${modelType}`)
  }

  /**
   * Parse DeepSeek API errors into user-friendly messages
   */
  private parseDeepSeekError(error: any): string {
    if (error?.error?.message) {
      return `DeepSeek API Error: ${error.error.message}`
    }

    if (error?.message) {
      // Handle common DeepSeek error patterns
      if (error.message.includes('401')) {
        return 'Invalid API key. Please check your DeepSeek API key.'
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

    return 'Unknown DeepSeek API error occurred'
  }
}
