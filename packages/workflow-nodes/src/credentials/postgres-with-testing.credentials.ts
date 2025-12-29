// packages/workflow-nodes/src/credentials/postgres-with-testing.credentials.ts

import type { ICredentialType, INodeProperty } from '../types'

export class PostgresWithTesting implements ICredentialType {
  name = 'postgresWithTesting'
  displayName = 'PostgreSQL Database (with testing)'

  uiMetadata = {
    icon: 'Database',
    iconColor: 'text-blue-600',
    backgroundColor: 'from-blue-50 to-indigo-50',
    borderColor: 'border-blue-200',
    category: 'database' as const,
    brandColor: '#336791', // PostgreSQL blue
  }

  properties: INodeProperty[] = [
    {
      displayName: 'Host',
      name: 'host',
      type: 'string',
      default: 'localhost',
      required: true,
      placeholder: 'localhost or IP address',
      validation: {
        minLength: 1,
        maxLength: 255,
      },
    },
    {
      displayName: 'Port',
      name: 'port',
      type: 'number',
      default: 5432,
      placeholder: '5432',
      validation: {
        port: true,
        min: 1,
        max: 65535,
      },
    },
    {
      displayName: 'Database',
      name: 'database',
      type: 'string',
      default: 'postgres',
      required: true,
      placeholder: 'Database name',
      validation: {
        minLength: 1,
        maxLength: 63,
      },
    },
    {
      displayName: 'User',
      name: 'user',
      type: 'string',
      default: 'postgres',
      required: true,
      placeholder: 'Username',
      validation: {
        minLength: 1,
        maxLength: 63,
      },
    },
    {
      displayName: 'Password',
      name: 'password',
      type: 'password',
      default: '',
      required: true,
      placeholder: 'Password',
    },
    {
      displayName: 'SSL Mode',
      name: 'ssl',
      type: 'options',
      options: [
        { name: 'Disable', value: 'disable' },
        { name: 'Allow', value: 'allow' },
        { name: 'Prefer', value: 'prefer' },
        { name: 'Require', value: 'require' },
      ],
      default: 'prefer',
      description: 'SSL connection mode',
    },
  ]
}
