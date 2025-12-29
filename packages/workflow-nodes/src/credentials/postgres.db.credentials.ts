import type { ICredentialType, INodeProperty } from '../types'

export const sshTunnelProperties: INodeProperty[] = [
  { displayName: 'SSH Tunnel', name: 'sshTunnel', type: 'boolean', default: false },
  {
    displayName: 'SSH Authenticate with',
    name: 'sshAuthenticateWith',
    type: 'options',
    default: 'password',
    required: true,
    options: [
      { name: 'Password', value: 'password' },
      { name: 'Private Key', value: 'privateKey' },
    ],
    displayOptions: { show: { sshTunnel: [true] } },
  },
  {
    displayName: 'SSH Host',
    name: 'sshHost',
    type: 'string',
    default: 'localhost',
    required: true,
    placeholder: 'SSH server hostname or IP',
    displayOptions: { show: { sshTunnel: [true] } },
    validation: {
      minLength: 1,
      maxLength: 255,
    },
  },
  {
    displayName: 'SSH Port',
    name: 'sshPort',
    type: 'number',
    default: 22,
    placeholder: '22',
    displayOptions: { show: { sshTunnel: [true] } },
    validation: {
      port: true,
      min: 1,
      max: 65535,
    },
  },
  {
    displayName: 'SSH User',
    name: 'sshUser',
    type: 'string',
    default: 'root',
    required: true,
    placeholder: 'SSH username',
    displayOptions: { show: { sshTunnel: [true] } },
    validation: {
      minLength: 1,
      maxLength: 32,
    },
  },
  {
    displayName: 'SSH Password',
    name: 'sshPassword',
    type: 'password',
    default: '',
    required: true,
    placeholder: 'SSH password',
    displayOptions: { show: { sshTunnel: [true], sshAuthenticateWith: ['password'] } },
  },
  {
    displayName: 'Private Key',
    name: 'privateKey',
    type: 'string',
    typeOptions: { rows: 4 },
    default: '',
    required: true,
    placeholder: 'SSH private key content',
    displayOptions: { show: { sshTunnel: [true], sshAuthenticateWith: ['privateKey'] } },
    validation: {
      minLength: 100,
    },
  },
  {
    displayName: 'Passphrase',
    name: 'passphrase',
    type: 'string',
    default: '',
    description: 'Passphrase used to create the key, if no passphrase was used leave empty',
    displayOptions: { show: { sshTunnel: [true], sshAuthenticateWith: ['privateKey'] } },
  },
]

export class Postgres implements ICredentialType {
  name = 'postgres'

  displayName = 'Postgres'

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
      displayName: 'Maximum Number of Connections',
      name: 'maxConnections',
      type: 'number',
      default: 100,
      description:
        'Make sure this value times the number of workers you have is lower than the maximum number of connections your postgres instance allows.',
      validation: {
        min: 1,
        max: 10000,
      },
    },
    {
      displayName: 'Ignore SSL Issues (Insecure)',
      name: 'allowUnauthorizedCerts',
      type: 'boolean',
      default: false,
      description: 'Whether to connect even if SSL certificate validation is not possible',
    },
    {
      displayName: 'SSL',
      name: 'ssl',
      type: 'options',
      displayOptions: { show: { allowUnauthorizedCerts: [false] } },
      options: [
        { name: 'Allow', value: 'allow' },
        { name: 'Disable', value: 'disable' },
        { name: 'Require', value: 'require' },
      ],
      default: 'disable',
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
    ...sshTunnelProperties,
  ]
}
