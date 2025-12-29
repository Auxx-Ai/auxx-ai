// packages/workflow-nodes/src/credentials/instagram-oauth2.credentials.ts

import type { ICredentialType, INodeProperty } from '../types'
import type { OAuth2Config } from '../types/oauth2'

/**
 * Instagram OAuth2 credential type for workflow integrations
 * Uses system-wide Instagram OAuth client credentials with Instagram Basic Display API scopes
 */
export class InstagramOAuth2Api implements ICredentialType {
  name = 'instagramOAuth2Api'

  displayName = 'Instagram OAuth2'

  documentationUrl = 'instagram-oauth2'

  /**
   * UI metadata for styling this credential type
   */
  uiMetadata = {
    icon: 'Instagram',
    iconColor: 'text-pink-500',
    backgroundColor: 'from-pink-50 to-purple-50',
    borderColor: 'border-pink-200',
    category: 'social' as const,
    brandColor: '#e4405f', // Instagram pink
  }

  /**
   * OAuth2 provider configuration - defines everything needed for generic OAuth flow
   */
  oauth2Config: OAuth2Config = {
    providerName: 'instagram',
    icon: 'Instagram', // Lucide icon name for UI
    authUrl: 'https://api.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token',
    systemClientIdEnv: 'INSTAGRAM_CLIENT_ID',
    systemClientSecretEnv: 'INSTAGRAM_CLIENT_SECRET',

    // Instagram Basic Display API scopes
    scopes: [
      'user_profile', // Access to user profile info
      'user_media', // Access to user media (photos/videos)
    ],

    // Instagram-specific OAuth parameters
    additionalAuthParams: {
      response_type: 'code',
    },

    // Provider-specific styling (overrides uiMetadata for OAuth2 specifics)
    providerStyling: {
      iconColor: 'text-pink-500',
      backgroundColor: 'from-pink-50 to-purple-50',
      borderColor: 'border-pink-200',
      brandColor: '#e4405f',
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
