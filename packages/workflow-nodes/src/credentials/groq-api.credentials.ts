// packages/workflow-nodes/src/credentials/groq-api.credentials.ts

import type { ICredentialType, INodeProperty } from '../types'

/**
 * Groq API credential type for fast AI inference
 * Supports both organization credentials (stored in database) and system credentials (environment variables)
 */
export class GroqApiCredentials implements ICredentialType {
  name = 'groqApi'

  displayName = 'Groq API'

  documentationUrl = 'https://console.groq.com/docs'

  /**
   * UI metadata for styling this credential type
   */
  uiMetadata = {
    icon: 'Zap',
    iconColor: 'text-purple-600',
    backgroundColor: 'from-purple-50 to-violet-50',
    borderColor: 'border-purple-200',
    category: 'ai' as const,
    brandColor: '#F55036', // Groq red/orange
  }

  /**
   * System credential mapping for environment variable fallback
   * When no organization credential is provided, these env vars will be used
   */
  systemCredentialMapping = {
    apiKey: 'GROQ_API_KEY',
  }

  /**
   * Form properties for creating/editing Groq credentials
   */
  properties: INodeProperty[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'password',
      default: '',
      required: true,
      placeholder: 'gsk_...',
      description: 'Your Groq API key from https://console.groq.com/keys',
      validation: {
        minLength: 20,
        pattern: /^gsk_[a-zA-Z0-9]+$/,
        errorMessage: 'Must be a valid Groq API key starting with gsk_',
      },
    },
  ]
}
