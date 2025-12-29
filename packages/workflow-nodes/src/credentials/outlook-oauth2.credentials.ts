// packages/workflow-nodes/src/credentials/outlook-oauth2.credentials.ts

import type { ICredentialType, INodeProperty } from '../types'
import type { OAuth2Config } from '../types/oauth2'

/**
 * Microsoft Outlook OAuth2 credential type for workflow integrations
 * Uses system-wide Outlook OAuth client credentials with Microsoft Graph scopes
 */
export class OutlookOAuth2Api implements ICredentialType {
  name = 'outlookOAuth2Api'

  displayName = 'Microsoft Outlook OAuth2'

  documentationUrl = 'outlook-oauth2'

  /**
   * UI metadata for styling this credential type
   */
  uiMetadata = {
    icon: 'Mail',
    iconColor: 'text-blue-600',
    backgroundColor: 'from-blue-50 to-indigo-50',
    borderColor: 'border-blue-200',
    category: 'email' as const,
    brandColor: '#0078d4', // Microsoft blue
  }

  /**
   * OAuth2 provider configuration - defines everything needed for generic OAuth flow
   */
  oauth2Config: OAuth2Config = {
    providerName: 'outlook',
    icon: 'Mail', // Lucide icon name for UI
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    systemClientIdEnv: 'OUTLOOK_CLIENT_ID',
    systemClientSecretEnv: 'OUTLOOK_CLIENT_SECRET',

    // Microsoft Graph scopes for email access
    scopes: [
      'https://graph.microsoft.com/Mail.ReadWrite', // Email read/write
      'https://graph.microsoft.com/Mail.Send', // Send emails
      'https://graph.microsoft.com/User.Read', // User profile info
      'offline_access', // Refresh tokens
    ],

    // Microsoft-specific OAuth parameters
    additionalAuthParams: {
      response_type: 'code',
      response_mode: 'query',
      prompt: 'consent', // Force consent to get refresh token
    },

    // Provider-specific styling (overrides uiMetadata for OAuth2 specifics)
    providerStyling: {
      iconColor: 'text-blue-600',
      backgroundColor: 'from-blue-50 to-indigo-50',
      borderColor: 'border-blue-200',
      brandColor: '#0078d4',
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
