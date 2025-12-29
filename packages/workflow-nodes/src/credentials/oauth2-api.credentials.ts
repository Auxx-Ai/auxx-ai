import type { ICredentialType, INodeProperty } from '../types'

export class OAuth2Api implements ICredentialType {
  name = 'oAuth2Api'

  displayName = 'OAuth2 API'

  documentationUrl = 'httpRequest'

  genericAuth = true

  uiMetadata = {
    icon: 'Shield',
    iconColor: 'text-blue-500',
    backgroundColor: 'from-blue-50 to-indigo-50',
    borderColor: 'border-blue-200',
    category: 'auth' as const,
    brandColor: '#3b82f6', // Generic blue
  }

  properties: INodeProperty[] = [
    {
      displayName: 'Grant Type',
      name: 'grantType',
      type: 'options',
      options: [
        { name: 'Authorization Code', value: 'authorizationCode' },
        { name: 'Client Credentials', value: 'clientCredentials' },
        { name: 'PKCE', value: 'pkce' },
      ],
      default: 'authorizationCode',
    },
    {
      displayName: 'Authorization URL',
      name: 'authUrl',
      type: 'string',
      displayOptions: { show: { grantType: ['authorizationCode', 'pkce'] } },
      default: '',
      required: true,
      placeholder: 'https://example.com/oauth/authorize',
      validation: {
        url: true,
        minLength: 10,
      },
    },
    {
      displayName: 'Access Token URL',
      name: 'accessTokenUrl',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'https://example.com/oauth/token',
      validation: {
        url: true,
        minLength: 10,
      },
    },
    {
      displayName: 'Client ID',
      name: 'clientId',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'Your OAuth2 client ID',
      validation: {
        minLength: 1,
        maxLength: 255,
      },
    },
    {
      displayName: 'Client Secret',
      name: 'clientSecret',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      placeholder: 'Your OAuth2 client secret',
      validation: {
        minLength: 1,
        maxLength: 512,
      },
    },
    { displayName: 'Scope', name: 'scope', type: 'string', default: '' },
    {
      displayName: 'Auth URI Query Parameters',
      name: 'authQueryParameters',
      type: 'string',
      displayOptions: { show: { grantType: ['authorizationCode', 'pkce'] } },
      default: '',
      description:
        'For some services additional query parameters have to be set which can be defined here',
      placeholder: 'access_type=offline',
    },
    {
      displayName: 'Authentication',
      name: 'authentication',
      type: 'options',
      options: [
        { name: 'Body', value: 'body', description: 'Send credentials in body' },
        { name: 'Header', value: 'header', description: 'Send credentials as Basic Auth header' },
      ],
      default: 'header',
    },
    {
      displayName: 'Ignore SSL Issues (Insecure)',
      name: 'ignoreSSLIssues',
      type: 'boolean',
      default: false,
      doNotInherit: true,
    },
  ]
}
