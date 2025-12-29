// packages/workflow-nodes/src/credentials/smtp.credentials.ts

import type { ICredentialType, INodeProperty } from '../types'

export class SmtpCredentials implements ICredentialType {
  name = 'smtp'
  displayName = 'SMTP Email Account'

  uiMetadata = {
    icon: 'Mail',
    iconColor: 'text-green-500',
    backgroundColor: 'from-green-50 to-emerald-50',
    borderColor: 'border-green-200',
    category: 'email' as const,
    brandColor: '#10b981', // Green
  }

  properties: INodeProperty[] = [
    {
      displayName: 'Host',
      name: 'host',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'smtp.gmail.com',
      validation: {
        minLength: 1,
        maxLength: 255,
      },
    },
    {
      displayName: 'Port',
      name: 'port',
      type: 'number',
      default: 587,
      required: true,
      placeholder: '587',
      validation: {
        port: true,
        min: 1,
        max: 65535,
      },
    },
    {
      displayName: 'Username',
      name: 'username',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'your-email@gmail.com',
      validation: {
        email: true,
        minLength: 1,
        maxLength: 255,
      },
    },
    {
      displayName: 'Password',
      name: 'password',
      type: 'password',
      default: '',
      required: true,
      placeholder: 'App password or account password',
    },
    {
      displayName: 'Use TLS',
      name: 'secure',
      type: 'boolean',
      default: true,
      description: 'Whether to use TLS encryption (recommended for most providers)',
    },
    {
      displayName: 'Ignore SSL Issues (Insecure)',
      name: 'ignoreTLS',
      type: 'boolean',
      default: false,
      description: 'Whether to ignore SSL certificate validation (not recommended for production)',
    },
  ]
}
