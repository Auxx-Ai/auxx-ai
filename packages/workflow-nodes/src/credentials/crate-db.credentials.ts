import type { ICredentialType, INodeProperty } from '../types'

export class CrateDb implements ICredentialType {
  name = 'crateDb'

  displayName = 'CrateDB'

  documentationUrl = 'crateDb'

  uiMetadata = {
    icon: 'Database',
    iconColor: 'text-teal-500',
    backgroundColor: 'from-teal-50 to-cyan-50',
    borderColor: 'border-teal-200',
    category: 'database' as const,
    brandColor: '#14b8a6', // Teal
  }

  properties: INodeProperty[] = [
    { displayName: 'Host', name: 'host', type: 'string', default: 'localhost' },
    { displayName: 'Database', name: 'database', type: 'string', default: 'doc' },
    { displayName: 'User', name: 'user', type: 'string', default: 'crate' },
    {
      displayName: 'Password',
      name: 'password',
      type: 'string',
      typeOptions: { password: true },
      default: '',
    },
    {
      displayName: 'SSL',
      name: 'ssl',
      type: 'options',
      options: [
        { name: 'Allow', value: 'allow' },
        { name: 'Disable', value: 'disable' },
        { name: 'Require', value: 'require' },
      ],
      default: 'disable',
    },
    { displayName: 'Port', name: 'port', type: 'number', default: 5432 },
  ]
}
