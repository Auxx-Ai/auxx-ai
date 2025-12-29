import type { ICredentialType, INodeProperty } from '../types'

export class HttpHeaderAuth implements ICredentialType {
  name = 'httpHeaderAuth'

  displayName = 'Header Auth'

  uiMetadata = {
    icon: 'Hash',
    iconColor: 'text-purple-500',
    backgroundColor: 'from-purple-50 to-violet-50',
    borderColor: 'border-purple-200',
    category: 'auth' as const,
    brandColor: '#8b5cf6', // Purple
  }

  properties: INodeProperty[] = [
    { displayName: 'Name', name: 'name', type: 'string', default: '' },
    { displayName: 'Value', name: 'value', type: 'password', default: '' },
    {
      displayName: 'To send multiple headers, use a "Custom Auth" credential instead',
      name: 'useCustomAuth',
      type: 'notice',
      default: '',
    },
  ]
}
