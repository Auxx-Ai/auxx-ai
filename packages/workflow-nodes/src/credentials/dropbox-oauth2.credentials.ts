// packages/workflow-nodes/src/credentials/dropbox-oauth2.credentials.ts

import type { ICredentialType, INodeProperty } from '../types'
import type { OAuth2Config } from '../types/oauth2'

/**
 * Dropbox OAuth2 credential type for storage operations
 * Provides access to Dropbox API for file storage and management
 */
export class DropboxOAuth2 implements ICredentialType {
  name = 'DROPBOX'

  displayName = 'Dropbox OAuth2'

  documentationUrl = 'dropbox-oauth2'

  /**
   * UI metadata for styling this credential type
   */
  uiMetadata = {
    icon: 'Droplets',
    iconColor: 'text-blue-600',
    backgroundColor: 'from-blue-50 to-cyan-50',
    borderColor: 'border-blue-300',
    category: 'storage' as const,
    brandColor: '#0061FF', // Dropbox blue
  }

  /**
   * OAuth2 provider configuration for Dropbox
   */
  oauth2Config: OAuth2Config = {
    providerName: 'dropbox',
    icon: 'Droplets',
    authUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    systemClientIdEnv: 'DROPBOX_CLIENT_ID',
    systemClientSecretEnv: 'DROPBOX_CLIENT_SECRET',

    // Dropbox scopes - note that Dropbox uses space-separated scopes
    scopes: [
      // 'files.metadata.write',
      'account_info.read',
      'files.metadata.read',
      // 'files.content.write',
      'files.content.read',
      // 'sharing.write',
      'account_info.read',
    ],

    // Dropbox-specific OAuth parameters
    additionalAuthParams: {
      token_access_type: 'offline', // Required for refresh tokens
      force_reapprove: 'false', // Don't force re-approval unless needed
    },

    // Provider-specific styling
    providerStyling: {
      iconColor: 'text-blue-600',
      backgroundColor: 'from-blue-50 to-cyan-50',
      borderColor: 'border-blue-300',
      brandColor: '#0061FF',
    },
  }

  /**
   * System credential mapping for environment variable fallback
   */
  systemCredentialMapping = {
    clientId: 'DROPBOX_CLIENT_ID',
    clientSecret: 'DROPBOX_CLIENT_SECRET',
    redirectUri: 'DROPBOX_REDIRECT_URI',
  }

  /**
   * No form properties needed - OAuth flow handled by generic components
   */
  properties: INodeProperty[] = []

  /**
   * Test credential connection for Dropbox
   */
  // test = {
  //   async execute(credentials: Record<string, any>): Promise<{ success: boolean; message: string }> {
  //     try {
  //       // Test connection using Dropbox API
  //       const response = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
  //         method: 'POST',
  //         headers: {
  //           'Authorization': `Bearer ${credentials.accessToken}`,
  //           'Content-Type': 'application/json',
  //         },
  //       })

  //       if (!response.ok) {
  //         const errorData = await response.json().catch(() => ({}))
  //         throw new Error(errorData.error_summary || `HTTP ${response.status}: ${response.statusText}`)
  //       }

  //       const userData = await response.json()

  //       // Get space usage information
  //       const spaceResponse = await fetch('https://api.dropboxapi.com/2/users/get_space_usage', {
  //         method: 'POST',
  //         headers: {
  //           'Authorization': `Bearer ${credentials.accessToken}`,
  //           'Content-Type': 'application/json',
  //         },
  //       })

  //       let spaceInfo = ''
  //       if (spaceResponse.ok) {
  //         const spaceData = await spaceResponse.json()
  //         const usedGB = Math.round(spaceData.used / (1024 ** 3) * 100) / 100
  //         const allocatedGB = Math.round(spaceData.allocation.allocated / (1024 ** 3) * 100) / 100
  //         spaceInfo = ` Storage: ${usedGB}GB / ${allocatedGB}GB used.`
  //       }

  //       return {
  //         success: true,
  //         message: `Successfully connected to Dropbox for ${userData.name.display_name} (${userData.email}).${spaceInfo}`,
  //       }
  //     } catch (error) {
  //       const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

  //       // Provide helpful error messages for common Dropbox issues
  //       if (errorMessage.includes('invalid_access_token') || errorMessage.includes('expired_access_token')) {
  //         return {
  //           success: false,
  //           message: 'Access token has expired or is invalid. Please re-authorize your Dropbox connection.',
  //         }
  //       }

  //       if (errorMessage.includes('insufficient_scope')) {
  //         return {
  //           success: false,
  //           message: 'Insufficient permissions. Please re-authorize with required Dropbox scopes.',
  //         }
  //       }

  //       if (errorMessage.includes('invalid_client')) {
  //         return {
  //           success: false,
  //           message: 'Invalid client credentials. Please check your Dropbox OAuth configuration.',
  //         }
  //       }

  //       if (errorMessage.includes('NetworkingError') || errorMessage.includes('ENOTFOUND')) {
  //         return {
  //           success: false,
  //           message: 'Unable to connect to Dropbox API. Please check your network connection.',
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
      provider: 'dropbox',
      // Ensure proper token format
      accessToken: credentials.access_token || credentials.accessToken,
      refreshToken: credentials.refresh_token || credentials.refreshToken,
    }
  }
}
