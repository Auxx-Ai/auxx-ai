// packages/lib/src/ai/providers/typesafe/typesafe-client.ts

import type { BaseSpecializedClient } from '../../clients/base/base-specialized-client'
import type { DecisionClient } from '../../clients/base/decision-client'
import type { DecisionResult } from '../../decision/client'
import { ProviderClient } from '../base/provider-client'
import {
  type ConnectionTestResult,
  CredentialValidationError,
  type ProviderCredentials,
  ProviderError,
  type ValidationResult,
} from '../base/types'
import type { ModelCapabilities, ModelType } from '../types'
import { TypeSafeDecisionClient } from './typesafe-decision-client'
import { TYPESAFE_CAPABILITIES, TYPESAFE_MODELS } from './typesafe-defaults'

/** The fetch-based API handle `getApiClient` returns; Jev is one POST, so no SDK. */
export interface TypeSafeApi {
  decision: TypeSafeDecisionClient
}

/** TypeSafe (Jev) provider: decision-only, no LLM or other modality. */
export class TypeSafeClient extends ProviderClient {
  constructor(organizationId: string, userId: string, cache?: any) {
    super(TYPESAFE_CAPABILITIES, organizationId, userId, cache)
  }

  async validateCredentials(credentials: Record<string, any>): Promise<ValidationResult> {
    this.logOperationStart('validateCredentials')
    try {
      const testResult = await this.testConnection(credentials)
      if (testResult.success) {
        this.logOperationSuccess('validateCredentials', { responseTime: testResult.responseTime })
        return { isValid: true }
      }
      this.logOperationError('validateCredentials', testResult.error)
      return { isValid: false, error: testResult.error || 'Connection test failed' }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logOperationError('validateCredentials', errorMessage)
      throw new CredentialValidationError(
        `TypeSafe credential validation failed: ${errorMessage}`,
        this.getProviderId()
      )
    }
  }

  /** One `noul` question on a one-line state: the cheapest call that exercises the real path. */
  async testConnection(
    credentials: Record<string, any>,
    model?: string
  ): Promise<ConnectionTestResult> {
    const startTime = Date.now()
    const testModel = model || TYPESAFE_CAPABILITIES.defaultModel
    this.logOperationStart('testConnection', { model: testModel })

    try {
      const result: DecisionResult = await this.getDecisionClient(
        this.extractCredentials(credentials)
      ).evaluate({
        provider: this.getProviderId(),
        model: testModel,
        state: 'The sky is blue.',
        questions: { ping: { type: 'noul', instructions: 'Is the sky described as blue?' } },
      })
      const responseTime = Date.now() - startTime
      this.logOperationSuccess('testConnection', { model: result.model, responseTime })
      return { success: true, responseTime, modelsTested: [testModel] }
    } catch (error) {
      const responseTime = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logOperationError('testConnection', errorMessage, { responseTime, model: testModel })
      return { success: false, error: errorMessage, responseTime, modelsTested: [testModel] }
    }
  }

  extractCredentials(rawCredentials: Record<string, any>): ProviderCredentials {
    return { apiKey: String(rawCredentials.apiKey || '') }
  }

  getApiClient(credentials: ProviderCredentials): TypeSafeApi {
    return { decision: this.getDecisionClient(credentials) as TypeSafeDecisionClient }
  }

  getModels(): Record<string, ModelCapabilities> {
    return TYPESAFE_MODELS
  }

  getClient(modelType: ModelType, _credentials: ProviderCredentials): BaseSpecializedClient {
    throw new ProviderError(
      `TypeSafe does not support model type: ${modelType}; use getDecisionClient`,
      this.getProviderId(),
      'MODEL_TYPE_NOT_SUPPORTED'
    )
  }

  override getDecisionClient(credentials: ProviderCredentials): DecisionClient {
    return new TypeSafeDecisionClient(this.requireApiKey(credentials, 'apiKey'), this.logger)
  }
}
