// packages/workflow-nodes/src/credentials/onedrive-oauth2.credentials.ts

import type { ICredentialType, INodeProperty } from '../types'
import type { OAuth2Config } from '../types/oauth2'

/**
 * Microsoft OneDrive OAuth2 credential type for storage operations
 * Provides access to OneDrive API for file storage and management
 */
export class OneDriveOAuth2 implements ICredentialType {
  name = 'ONEDRIVE'

  displayName = 'OneDrive OAuth2'

  documentationUrl = 'onedrive-oauth2'

  /**
   * UI metadata for styling this credential type
   */
  uiMetadata = {
    icon: 'Cloud',
    iconColor: 'text-blue-500',
    backgroundColor: 'from-blue-50 to-sky-50',
    borderColor: 'border-blue-200',
    category: 'storage' as const,
    brandColor: '#0078d4', // Microsoft blue
  }

  /**
   * OAuth2 provider configuration for OneDrive
   */
  oauth2Config: OAuth2Config = {
    providerName: 'onedrive',
    icon: 'Cloud',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    systemClientIdEnv: 'ONEDRIVE_CLIENT_ID',
    systemClientSecretEnv: 'ONEDRIVE_CLIENT_SECRET',

    // OneDrive/Microsoft Graph scopes
    scopes: [
      'https://graph.microsoft.com/Files.ReadWrite.All', // Read/write files
      'https://graph.microsoft.com/User.Read', // User profile info
      'offline_access', // Refresh token support
    ],

    // Microsoft-specific OAuth parameters
    additionalAuthParams: {
      response_mode: 'query',
    },

    // Provider-specific styling
    providerStyling: {
      iconColor: 'text-blue-500',
      backgroundColor: 'from-blue-50 to-sky-50',
      borderColor: 'border-blue-200',
      brandColor: '#0078d4',
    },
  }

  /**
   * System credential mapping for environment variable fallback
   */
  systemCredentialMapping = {
    clientId: 'ONEDRIVE_CLIENT_ID',
    clientSecret: 'ONEDRIVE_CLIENT_SECRET',
    redirectUri: 'ONEDRIVE_REDIRECT_URI',
  }

  /**
   * No form properties needed - OAuth flow handled by generic components
   */
  properties: INodeProperty[] = []

  /**
   * Test credential connection for OneDrive
   */
  // test = {
  //   async execute(credentials: Record<string, any>): Promise<{ success: boolean; message: string }> {
  //     try {
  //       // Test connection using Microsoft Graph API
  //       const userResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
  //         headers: {
  //           'Authorization': `Bearer ${credentials.accessToken}`,
  //           'Content-Type': 'application/json',
  //         },
  //       })

  //       if (!userResponse.ok) {
  //         const errorData = await userResponse.json().catch(() => ({}))
  //         throw new Error(errorData.error?.message || `HTTP ${userResponse.status}: ${userResponse.statusText}`)
  //       }

  //       const userData = await userResponse.json()

  //       // Get OneDrive information
  //       const driveResponse = await fetch('https://graph.microsoft.com/v1.0/me/drive', {
  //         headers: {
  //           'Authorization': `Bearer ${credentials.accessToken}`,
  //           'Content-Type': 'application/json',
  //         },
  //       })

  //       let driveInfo = ''
  //       if (driveResponse.ok) {
  //         const driveData = await driveResponse.json()
  //         const quota = driveData.quota
  //         if (quota) {
  //           const usedGB = Math.round(quota.used / (1024 ** 3) * 100) / 100
  //           const totalGB = Math.round(quota.total / (1024 ** 3) * 100) / 100
  //           driveInfo = ` Storage: ${usedGB}GB / ${totalGB}GB used.`
  //         }
  //       }

  //       return {
  //         success: true,
  //         message: `Successfully connected to OneDrive for ${userData.displayName} (${userData.userPrincipalName}).${driveInfo}`,
  //       }
  //     } catch (error) {
  //       const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

  //       // Provide helpful error messages for common Microsoft Graph issues
  //       if (errorMessage.includes('InvalidAuthenticationToken') || errorMessage.includes('ExpiredAuthenticationToken')) {
  //         return {
  //           success: false,
  //           message: 'Authentication token has expired or is invalid. Please re-authorize your OneDrive connection.',
  //         }
  //       }

  //       if (errorMessage.includes('Forbidden') || errorMessage.includes('insufficient_scope')) {
  //         return {
  //           success: false,
  //           message: 'Insufficient permissions. Please re-authorize with required OneDrive permissions.',
  //         }
  //       }

  //       if (errorMessage.includes('invalid_client')) {
  //         return {
  //           success: false,
  //           message: 'Invalid client credentials. Please check your Microsoft OAuth configuration.',
  //         }
  //       }

  //       if (errorMessage.includes('NetworkingError') || errorMessage.includes('ENOTFOUND')) {
  //         return {
  //           success: false,
  //           message: 'Unable to connect to Microsoft Graph API. Please check your network connection.',
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
      provider: 'onedrive',
      // Ensure proper token format
      accessToken: credentials.access_token || credentials.accessToken,
      refreshToken: credentials.refresh_token || credentials.refreshToken,
    }
  }
}
