// packages/workflow-nodes/src/credentials/facebook-oauth2.credentials.ts

import type { ICredentialType, INodeProperty } from '../types'
import type { OAuth2Config } from '../types/oauth2'

/**
 * Facebook OAuth2 credential type for workflow integrations
 * Uses system-wide Facebook OAuth client credentials with Facebook Graph API scopes
 */
export class FacebookOAuth2Api implements ICredentialType {
  name = 'facebookOAuth2Api'

  displayName = 'Facebook OAuth2'

  documentationUrl = 'facebook-oauth2'

  /**
   * UI metadata for styling this credential type
   */
  uiMetadata = {
    icon: 'Facebook',
    iconColor: 'text-blue-600',
    backgroundColor: 'from-blue-50 to-indigo-50',
    borderColor: 'border-blue-200',
    category: 'social' as const,
    brandColor: '#1877f2', // Facebook blue
  }

  /**
   * OAuth2 provider configuration - defines everything needed for generic OAuth flow
   */
  oauth2Config: OAuth2Config = {
    providerName: 'facebook',
    icon: 'Facebook', // Lucide icon name for UI
    authUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
    systemClientIdEnv: 'FACEBOOK_CLIENT_ID',
    systemClientSecretEnv: 'FACEBOOK_CLIENT_SECRET',

    // Facebook Graph API scopes
    scopes: [
      'pages_manage_metadata', // Manage page metadata
      'pages_read_engagement', // Read page engagement
      'pages_manage_posts', // Manage page posts
      'pages_messaging', // Send/receive messages
      'pages_show_list', // Access to pages list
      'business_management', // Business management
    ],

    // Facebook-specific OAuth parameters
    additionalAuthParams: {
      response_type: 'code',
      display: 'popup',
    },

    // Provider-specific styling (overrides uiMetadata for OAuth2 specifics)
    providerStyling: {
      iconColor: 'text-blue-600',
      backgroundColor: 'from-blue-50 to-indigo-50',
      borderColor: 'border-blue-200',
      brandColor: '#1877f2',
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
