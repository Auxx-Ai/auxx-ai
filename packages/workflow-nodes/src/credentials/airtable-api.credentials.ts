import type { ICredentialType, INodeProperty } from '../types'

export class AirtableApi implements ICredentialType {
  name = 'airtableApi'

  displayName = 'Airtable API'

  uiMetadata = {
    icon: 'Database',
    iconColor: 'text-orange-500',
    backgroundColor: 'from-orange-50 to-yellow-50',
    borderColor: 'border-orange-200',
    category: 'data' as const,
    brandColor: '#fcb401', // Airtable orange
  }

  properties: INodeProperty[] = [
    {
      displayName:
        "This type of connection (API Key) was deprecated and can't be used anymore. Please create a new credential of type 'Access Token' instead.",
      name: 'deprecated',
      type: 'notice',
      default: '',
    },
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'password',
      default: '',
      required: true,
      placeholder: 'keyXXXXXXXXXXXXXX',
      validation: {
        minLength: 17,
        maxLength: 17,
        pattern: /^key[a-zA-Z0-9]{14}$/,
        errorMessage: 'API Key must be in format: keyXXXXXXXXXXXXXX',
      },
    },
  ]
}
