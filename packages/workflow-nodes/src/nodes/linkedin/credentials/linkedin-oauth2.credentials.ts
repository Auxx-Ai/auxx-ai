// packages/workflow-nodes/src/nodes/linkedin/credentials/linkedin-oauth2.credentials.ts

import type { ICredentialType, INodeProperty } from '../../../types'

/**
 * Professional Network OAuth2 Authentication
 * Handles secure authentication with LinkedIn API
 */
export class ProfessionalNetworkAuth implements ICredentialType {
  name = 'professionalNetworkOAuth2'
  extends = ['oAuth2Api']
  displayName = 'Professional Network Authentication'
  documentationUrl = 'professional-network-auth'

  properties: INodeProperty[] = [
    {
      displayName: 'Client ID',
      name: 'clientId',
      type: 'string' as const,
      required: true,
      default: '',
      description: 'The Client ID from your LinkedIn app registration',
    },
    {
      displayName: 'Client Secret',
      name: 'clientSecret',
      type: 'string' as const,
      required: true,
      default: '',
      typeOptions: {
        password: true,
      },
      description: 'The Client Secret from your LinkedIn app registration',
    },
    {
      displayName: 'Authorization URL',
      name: 'authUrl',
      type: 'hidden' as const,
      default: 'https://www.linkedin.com/oauth/v2/authorization',
    },
    {
      displayName: 'Access Token URL',
      name: 'accessTokenUrl',
      type: 'hidden' as const,
      default: 'https://www.linkedin.com/oauth/v2/accessToken',
    },
    {
      displayName: 'API Permissions',
      name: 'scope',
      type: 'string' as const,
      default: 'w_member_social r_liteprofile',
      description: 'Required permissions for content publishing and profile access',
    },
    {
      displayName: 'Grant Type',
      name: 'grantType',
      type: 'hidden' as const,
      default: 'authorizationCode',
    },
  ]
}
