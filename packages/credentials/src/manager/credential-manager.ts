// packages/credentials/src/manager/credential-manager.ts

import type { NodeData } from '@auxx/workflow-nodes/types'
import type {
  ICredentialManager,
  ProviderAuth,
  ProviderInfo,
  CredentialReference,
  SystemCredentialInfo,
  ConnectionTestResult,
  ValidationResult,
} from '../types'
import {
  ProviderNotFoundError,
  CredentialNotFoundError,
  NoCredentialsAvailableError,
  OrganizationRequiredError,
  CredentialConnectionError,
  CredentialTransformError,
} from '../types/errors'
import {} from // transformOrgCredentialToAuth,
// transformSystemCredentialToAuth,
// validateProviderAuth,
'../types/provider-auth'
import { CredentialTypeRegistry } from './credential-type-registry'
import { SystemCredentialService } from './system-credential-service'
import { CredentialService } from '../service/credential-service'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('credential-manager')

/**
 * Unified credential manager that orchestrates organization and system credentials
 */
export class CredentialManager implements ICredentialManager {
  private credentialTypeRegistry: CredentialTypeRegistry
  private systemCredentialService: SystemCredentialService
  private orgCredentialService: typeof CredentialService

  constructor() {
    this.credentialTypeRegistry = new CredentialTypeRegistry()
    this.systemCredentialService = new SystemCredentialService(this.credentialTypeRegistry)
    this.orgCredentialService = CredentialService
  }

  /**
   * Get credentials with smart fallback: org credential -> system credential -> error
   */
  async getCredentials(
    providerId: string,
    organizationId?: string,
    credentialId?: string
  ): Promise<ProviderAuth> {
    // 1. Validate provider exists
    const provider = this.credentialTypeRegistry.getProvider(providerId)
    if (!provider) {
      throw new ProviderNotFoundError(providerId)
    }

    // 2. If specific credential requested, try organization credentials first
    if (credentialId && organizationId) {
      try {
        const orgCredential = await this.orgCredentialService.loadCredential(
          credentialId,
          organizationId
        )
        // const providerAuth = this.transformOrgCredentialToAuth(provider, orgCredential)

        return orgCredential
      } catch (error) {
        logger.warn('Failed to load organization credential, trying system fallback', {
          providerId,
          credentialId: '***',
          error: error instanceof Error ? error.message : String(error),
        })

        // Don't throw here - fall through to system credentials
      }
    }

    if (this.systemCredentialService.hasSystemCredentials(providerId)) {
      try {
        const systemCredential = await this.systemCredentialService.getSystemCredentials(providerId)
        if (systemCredential) {
          return systemCredential
        }
      } catch (error) {}
    } else {
      logger.warn('⚠️ NO SYSTEM CREDENTIALS AVAILABLE', { providerId })
    }

    // 4. No credentials available
    const missingContext = []
    if (credentialId && !organizationId) {
      missingContext.push('organization ID required for credential lookup')
    }
    if (!this.systemCredentialService.hasSystemCredentials(providerId)) {
      missingContext.push('no system credentials configured')
    }

    throw new NoCredentialsAvailableError(
      providerId,
      missingContext.length > 0 ? missingContext.join(', ') : undefined
    )
  }

  /**
   * Check if system credentials are available for a provider
   */
  hasSystemCredentials(providerId: string): boolean {
    return this.systemCredentialService.hasSystemCredentials(providerId)
  }

  /**
   * List available system credentials
   */
  async listSystemCredentials(): Promise<SystemCredentialInfo[]> {
    return await this.systemCredentialService.listAvailableSystemCredentials()
  }

  /**
   * List organization credentials for a provider
   */
  async listOrgCredentials(
    providerId: string,
    organizationId: string
  ): Promise<CredentialReference[]> {
    if (!organizationId) {
      throw new OrganizationRequiredError('listOrgCredentials')
    }

    try {
      // Get credentials by type/provider
      const credentials = await this.orgCredentialService.listCredentials(
        organizationId,
        providerId
      )

      return credentials.map((cred) => ({
        id: cred.id,
        name: cred.name,
        type: 'org' as const,
        providerId: providerId,
        organizationId: organizationId,
        metadata: {
          createdBy: cred.createdBy?.name ?? undefined,
          // Add more metadata if available from the credential
        },
      }))
    } catch (error) {
      logger.error('Failed to list organization credentials', {
        providerId,
        organizationId: '***',
        error: error instanceof Error ? error.message : String(error),
      })

      return []
    }
  }

  /**
   * Test credential connection
   */
  async testCredentials(
    providerId: string,
    credentialId?: string,
    organizationId?: string
  ): Promise<ConnectionTestResult> {
    const provider = this.credentialTypeRegistry.getProvider(providerId)
    if (!provider) {
      throw new ProviderNotFoundError(providerId)
    }

    if (!provider.test) {
      return {
        success: false,
        message: `Provider '${providerId}' does not support connection testing`,
      }
    }

    try {
      // Get credentials for testing
      const providerAuth = await this.getCredentials(providerId, organizationId, credentialId)

      // Run the provider's test with ProviderAuth directly
      const startTime = Date.now()
      const testResult = await provider.test.test(providerAuth)
      const latency = Date.now() - startTime

      logger.info('Credential connection test completed', {
        providerId,
        credentialId: credentialId ? '***' : undefined,
        success: testResult.success,
        latency,
      })

      return {
        success: testResult.success,
        message: testResult.message,
        latency,
        metadata: {
          provider: providerId,
          credentialType: credentialId ? 'org' : 'system',
        },
      }
    } catch (error) {
      logger.error('Credential connection test failed', {
        providerId,
        credentialId: credentialId ? '***' : undefined,
        error: error instanceof Error ? error.message : String(error),
      })

      throw new CredentialConnectionError(
        providerId,
        error instanceof Error ? error : new Error(String(error)),
        credentialId
      )
    }
  }

  /**
   * Validate credential data format
   */
  async validateCredentials(
    providerId: string,
    credentialData: unknown
  ): Promise<ValidationResult> {
    const provider = this.credentialTypeRegistry.getProvider(providerId)
    if (!provider) {
      throw new ProviderNotFoundError(providerId)
    }

    const errors: Array<{ field: string; message: string }> = []

    // Validate required properties
    for (const property of provider.properties) {
      if (property.required) {
        const value = (credentialData as any)?.[property.name]
        if (value === undefined || value === null || value === '') {
          errors.push({
            field: property.name,
            message: `${property.displayName} is required`,
          })
        }
      }
    }

    // Additional validation can be added here based on property validation rules

    return {
      isValid: errors.length === 0,
      errors,
    }
  }

  /**
   * Get provider information
   */
  getProviderInfo(providerId: string): ProviderInfo | null {
    return this.credentialTypeRegistry.getProviderInfo(providerId)
  }

  /**
   * List all supported providers
   */
  listSupportedProviders(): ProviderInfo[] {
    return this.credentialTypeRegistry
      .listProviders()
      .map((provider) => this.credentialTypeRegistry.getProviderInfo(provider.name))
      .filter((info): info is ProviderInfo => info !== null)
  }

  /**
   * Get credential manager statistics
   */
  getStats(): {
    providers: {
      total: number
      withSystemSupport: number
      withConnectionTest: number
    }
    systemCredentials: {
      available: number
    }
  } {
    const providers = this.credentialTypeRegistry.listProviders()
    const systemCredentials = this.credentialTypeRegistry.getProvidersWithSystemCredentials()

    return {
      providers: {
        total: providers.length,
        withSystemSupport: systemCredentials.length,
        withConnectionTest: providers.filter((p) => Boolean(p.test)).length,
      },
      systemCredentials: {
        available: systemCredentials.filter((p) =>
          this.systemCredentialService.hasSystemCredentials(p.name)
        ).length,
      },
    }
  }
}
