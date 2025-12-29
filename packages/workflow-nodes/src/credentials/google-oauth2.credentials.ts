// packages/workflow-nodes/src/credentials/google-oauth2.credentials.ts

import type { ICredentialType, INodeProperty } from '../types'
import type { OAuth2Config } from '../types/oauth2'

/**
 * Google OAuth2 credential type for workflow integrations
 * Uses system-wide Google OAuth client credentials with predefined scopes
 */
export class GoogleOAuth2Api implements ICredentialType {
  name = 'googleOAuth2Api'

  displayName = 'Google OAuth2'

  documentationUrl = 'google-oauth2'

  /**
   * UI metadata for styling this credential type
   */
  uiMetadata = {
    icon: 'Chrome',
    iconColor: 'text-red-500',
    backgroundColor: 'from-red-50 to-orange-50',
    borderColor: 'border-red-200',
    category: 'auth' as const,
    brandColor: '#db4437', // Google red
  }

  /**
   * OAuth2 provider configuration - defines everything needed for generic OAuth flow
   */
  oauth2Config: OAuth2Config = {
    providerName: 'google',
    icon: 'Chrome', // Lucide icon name for UI
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    systemClientIdEnv: 'GOOGLE_CLIENT_ID',
    systemClientSecretEnv: 'GOOGLE_CLIENT_SECRET',

    // Fixed scopes - covers common Google API integrations
    scopes: [
      'https://www.googleapis.com/auth/gmail.modify', // Gmail read/write
      'https://www.googleapis.com/auth/drive', // Google Drive
      'https://www.googleapis.com/auth/spreadsheets', // Google Sheets
      'https://www.googleapis.com/auth/calendar', // Google Calendar
      'https://www.googleapis.com/auth/userinfo.email', // User email info
      'https://www.googleapis.com/auth/userinfo.profile', // User profile info
    ],

    // Google-specific OAuth parameters
    additionalAuthParams: {
      access_type: 'offline', // Required for refresh tokens
      prompt: 'consent', // Force consent to get refresh token
      include_granted_scopes: 'true', // Include previously granted scopes
    },

    // Provider-specific styling (overrides uiMetadata for OAuth2 specifics)
    providerStyling: {
      iconColor: 'text-red-500',
      backgroundColor: 'from-red-50 to-orange-50',
      borderColor: 'border-red-200',
      brandColor: '#db4437',
    },
  }

  /**
   * No form properties needed - OAuth flow handled by generic components
   * The OAuth2Button component will handle authentication flow
   */
  properties: INodeProperty[] = []

  /**
   * Optional: Custom authentication method for workflow execution
   * This could be used to refresh tokens or validate credentials
   */
  authenticate?(credentials: Record<string, any>): Record<string, any> {
    // The OAuth2WorkflowService will handle token refresh automatically
    // This method could add computed fields if needed
    return credentials
  }
}
