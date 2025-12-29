import type { ICredentialType, INodeProperty } from '../types'

export class HttpBasicAuth implements ICredentialType {
  name = 'httpBasicAuth'

  displayName = 'Basic Auth'

  uiMetadata = {
    icon: 'Key',
    iconColor: 'text-gray-500',
    backgroundColor: 'from-gray-50 to-slate-50',
    borderColor: 'border-gray-200',
    category: 'auth' as const,
    brandColor: '#6b7280', // Gray
  }

  properties: INodeProperty[] = [
    { displayName: 'User', name: 'user', type: 'string', default: '' },
    { displayName: 'Password', name: 'password', type: 'password', default: '' },
  ]
}
