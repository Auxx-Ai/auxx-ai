// packages/workflow-nodes/src/credentials/box-oauth2.credentials.ts

import type { ICredentialType, INodeProperty } from '../types'
import type { OAuth2Config } from '../types/oauth2'

/**
 * Box OAuth2 credential type for storage operations
 * Provides access to Box API for file storage and management
 */
export class BoxOAuth2 implements ICredentialType {
  name = 'BOX'

  displayName = 'Box OAuth2'

  documentationUrl = 'box-oauth2'

  /**
   * UI metadata for styling this credential type
   */
  uiMetadata = {
    icon: 'Package',
    iconColor: 'text-blue-700',
    backgroundColor: 'from-blue-50 to-indigo-50',
    borderColor: 'border-blue-300',
    category: 'storage' as const,
    brandColor: '#0061D5', // Box blue
  }

  /**
   * OAuth2 provider configuration for Box
   */
  oauth2Config: OAuth2Config = {
    providerName: 'box',
    icon: 'Package',
    authUrl: 'https://account.box.com/api/oauth2/authorize',
    tokenUrl: 'https://api.box.com/oauth2/token',
    systemClientIdEnv: 'BOX_CLIENT_ID',
    systemClientSecretEnv: 'BOX_CLIENT_SECRET',

    // Box OAuth2 doesn't use traditional scopes, but we can specify the response_type
    scopes: [], // Box uses response_type=code by default

    // Box-specific OAuth parameters
    additionalAuthParams: {
      // Box doesn't require additional auth params for basic OAuth2 flow
    },

    // Provider-specific styling
    providerStyling: {
      iconColor: 'text-blue-700',
      backgroundColor: 'from-blue-50 to-indigo-50',
      borderColor: 'border-blue-300',
      brandColor: '#0061D5',
    },
  }

  /**
   * System credential mapping for environment variable fallback
   */
  systemCredentialMapping = {
    clientId: 'BOX_CLIENT_ID',
    clientSecret: 'BOX_CLIENT_SECRET',
    redirectUri: 'BOX_REDIRECT_URI',
  }

  /**
   * No form properties needed - OAuth flow handled by generic components
   */
  properties: INodeProperty[] = []

  /**
   * Test credential connection for Box
   */
  // test = {
  //   async execute(credentials: Record<string, any>): Promise<{ success: boolean; message: string }> {
  //     try {
  //       // Test connection using Box API
  //       const userResponse = await fetch('https://api.box.com/2.0/users/me', {
  //         headers: {
  //           'Authorization': `Bearer ${credentials.accessToken}`,
  //           'Content-Type': 'application/json',
  //         },
  //       })

  //       if (!userResponse.ok) {
  //         const errorData = await userResponse.json().catch(() => ({}))
  //         throw new Error(errorData.message || errorData.error_description || `HTTP ${userResponse.status}: ${userResponse.statusText}`)
  //       }

  //       const userData = await userResponse.json()

  //       // Get root folder information to verify file access
  //       const folderResponse = await fetch('https://api.box.com/2.0/folders/0', {
  //         headers: {
  //           'Authorization': `Bearer ${credentials.accessToken}`,
  //           'Content-Type': 'application/json',
  //         },
  //       })

  //       let storageInfo = ''
  //       if (folderResponse.ok) {
  //         const folderData = await folderResponse.json()

  //         // Get user's space quota information if available
  //         if (userData.space_amount && userData.space_used) {
  //           const usedGB = Math.round(userData.space_used / (1024 ** 3) * 100) / 100
  //           const totalGB = Math.round(userData.space_amount / (1024 ** 3) * 100) / 100
  //           storageInfo = ` Storage: ${usedGB}GB / ${totalGB}GB used.`
  //         }
  //       }

  //       return {
  //         success: true,
  //         message: `Successfully connected to Box for ${userData.name} (${userData.login}).${storageInfo}`,
  //       }
  //     } catch (error) {
  //       const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

  //       // Provide helpful error messages for common Box API issues
  //       if (errorMessage.includes('invalid_grant') || errorMessage.includes('unauthorized')) {
  //         return {
  //           success: false,
  //           message: 'Access token has expired or is invalid. Please re-authorize your Box connection.',
  //         }
  //       }

  //       if (errorMessage.includes('insufficient_scope') || errorMessage.includes('forbidden')) {
  //         return {
  //           success: false,
  //           message: 'Insufficient permissions. Please re-authorize with required Box permissions.',
  //         }
  //       }

  //       if (errorMessage.includes('invalid_client')) {
  //         return {
  //           success: false,
  //           message: 'Invalid client credentials. Please check your Box OAuth configuration.',
  //         }
  //       }

  //       if (errorMessage.includes('NetworkingError') || errorMessage.includes('ENOTFOUND')) {
  //         return {
  //           success: false,
  //           message: 'Unable to connect to Box API. Please check your network connection.',
  //         }
  //       }

  //       return {
  //         success: false,
  //         message: `Connection test failed: ${errorMessage}`,
  //       }
  //     }
  //   },
  // }

  /**
   * Transform credentials for workflow execution
   */
  authenticate?(credentials: Record<string, any>): Record<string, any> {
    return {
      ...credentials,
      // Add provider-specific identifier
      provider: 'BOX',
      // Ensure proper token format
      accessToken: credentials.access_token || credentials.accessToken,
      refreshToken: credentials.refresh_token || credentials.refreshToken,
    }
  }
}
