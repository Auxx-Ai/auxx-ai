import type { ICredentialType, INodeProperty } from '../types'

const scopes = ['schema.bases:read', 'data.records:read', 'data.records:write']

export class AirtableOAuth2Api implements ICredentialType {
  name = 'airtableOAuth2Api'

  extends = ['oAuth2Api']

  displayName = 'Airtable OAuth2 API'

  documentationUrl = 'airtable'

  uiMetadata = {
    icon: 'Database',
    iconColor: 'text-orange-500',
    backgroundColor: 'from-orange-50 to-yellow-50',
    borderColor: 'border-orange-200',
    category: 'data' as const,
    brandColor: '#fcb401', // Airtable orange
  }

  properties: INodeProperty[] = [
    { displayName: 'Grant Type', name: 'grantType', type: 'hidden', default: 'pkce' },
    {
      displayName: 'Authorization URL',
      name: 'authUrl',
      type: 'hidden',
      default: 'https://airtable.com/oauth2/v1/authorize',
    },
    {
      displayName: 'Access Token URL',
      name: 'accessTokenUrl',
      type: 'hidden',
      default: 'https://airtable.com/oauth2/v1/token',
    },
    { displayName: 'Scope', name: 'scope', type: 'hidden', default: `${scopes.join(' ')}` },
    {
      displayName: 'Auth URI Query Parameters',
      name: 'authQueryParameters',
      type: 'hidden',
      default: '',
    },
    { displayName: 'Authentication', name: 'authentication', type: 'hidden', default: 'header' },
  ]
}
