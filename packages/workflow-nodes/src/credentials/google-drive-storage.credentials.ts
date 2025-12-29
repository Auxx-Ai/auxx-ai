// packages/workflow-nodes/src/credentials/google-drive-storage.credentials.ts

import type { ICredentialType, INodeProperty } from '../types'
import type { OAuth2Config } from '../types/oauth2'

/**
 * Google Drive OAuth2 credential type specifically for storage operations
 * Focused on Drive API scopes for file storage and management
 */
export class GoogleDriveStorageOAuth2 implements ICredentialType {
  name = 'GOOGLE_DRIVE'

  displayName = 'Google Drive Storage'

  documentationUrl = 'google-drive-storage'

  /**
   * UI metadata for styling this credential type
   */
  uiMetadata = {
    icon: 'HardDrive',
    iconColor: 'text-blue-500',
    backgroundColor: 'from-blue-50 to-indigo-50',
    borderColor: 'border-blue-200',
    category: 'storage' as const,
    brandColor: '#4285f4', // Google blue
  }

  /**
   * OAuth2 provider configuration for Google Drive storage
   */
  oauth2Config: OAuth2Config = {
    providerName: 'google-drive',
    icon: 'HardDrive',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    systemClientIdEnv: 'GOOGLE_DRIVE_CLIENT_ID',
    systemClientSecretEnv: 'GOOGLE_DRIVE_CLIENT_SECRET',

    // Drive-specific scopes for storage operations
    scopes: [
      'https://www.googleapis.com/auth/drive', // Full Drive access
      'https://www.googleapis.com/auth/drive.file', // Files created by app
      'https://www.googleapis.com/auth/userinfo.email', // User identification
    ],

    // Google-specific OAuth parameters
    additionalAuthParams: {
      access_type: 'offline', // Required for refresh tokens
      prompt: 'consent', // Force consent to get refresh token
      include_granted_scopes: 'true', // Include previously granted scopes
    },

    // Provider-specific styling for Drive
    providerStyling: {
      iconColor: 'text-blue-500',
      backgroundColor: 'from-blue-50 to-indigo-50',
      borderColor: 'border-blue-200',
      brandColor: '#4285f4',
    },
  }

  /**
   * System credential mapping for environment variable fallback
   */
  systemCredentialMapping = {
    clientId: 'GOOGLE_DRIVE_CLIENT_ID',
    clientSecret: 'GOOGLE_DRIVE_CLIENT_SECRET',
    redirectUri: 'GOOGLE_DRIVE_REDIRECT_URI',
  }

  /**
   * No form properties needed - OAuth flow handled by generic components
   * The OAuth2Button component will handle authentication flow
   */
  properties: INodeProperty[] = []

  /**
   * Test credential connection for Google Drive
   */
  // test = {
  //   async execute(credentials: Record<string, any>): Promise<{ success: boolean; message: string }> {
  //     try {
  //       // Import Google APIs dynamically
  //       const { google } = await import('googleapis')

  //       // Create OAuth2 client
  //       const oauth2Client = new google.auth.OAuth2()
  //       oauth2Client.setCredentials({
  //         access_token: credentials.accessToken,
  //         refresh_token: credentials.refreshToken,
  //       })

  //       // Create Drive API client
  //       const drive = google.drive({ version: 'v3', auth: oauth2Client })

  //       // Test connection by getting user's Drive information
  //       const response = await drive.about.get({
  //         fields: 'user(displayName,emailAddress),storageQuota(limit,usage)',
  //       })

  //       const user = response.data.user
  //       const quota = response.data.storageQuota

  //       const usedGB = quota?.usage ? Math.round(parseInt(quota.usage) / (1024 ** 3) * 100) / 100 : 0
  //       const limitGB = quota?.limit ? Math.round(parseInt(quota.limit) / (1024 ** 3) * 100) / 100 : 'Unlimited'

  //       return {
  //         success: true,
  //         message: `Successfully connected to Google Drive for ${user?.displayName} (${user?.emailAddress}). Storage: ${usedGB}GB / ${limitGB}GB used.`,
  //       }
  //     } catch (error) {
  //       const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

  //       // Provide helpful error messages for common OAuth issues
  //       if (errorMessage.includes('invalid_grant')) {
  //         return {
  //           success: false,
  //           message: 'OAuth token has expired or is invalid. Please re-authorize your Google Drive connection.',
  //         }
  //       }

  //       if (errorMessage.includes('insufficient_scope')) {
  //         return {
  //           success: false,
  //           message: 'Insufficient permissions. Please re-authorize with Google Drive access.',
  //         }
  //       }

  //       if (errorMessage.includes('invalid_client')) {
  //         return {
  //           success: false,
  //           message: 'Invalid client credentials. Please check your Google Drive OAuth configuration.',
  //         }
  //       }

  //       if (errorMessage.includes('NetworkingError') || errorMessage.includes('ENOTFOUND')) {
  //         return {
  //           success: false,
  //           message: 'Unable to connect to Google Drive API. Please check your network connection.',
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
   * Add any Google Drive-specific transformations
   */
  authenticate?(credentials: Record<string, any>): Record<string, any> {
    return {
      ...credentials,
      // Add provider-specific identifier
      provider: 'google-drive',
      // Ensure proper token format
      accessToken: credentials.access_token || credentials.accessToken,
      refreshToken: credentials.refresh_token || credentials.refreshToken,
    }
  }
}
