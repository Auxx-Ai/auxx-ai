// packages/workflow-nodes/src/credentials/grok-api.credentials.ts

import type { ICredentialType, INodeProperty } from '../types'

/**
 * xAI (Grok) API credential type for AI model operations
 * Supports both organization credentials (stored in database) and system credentials (environment variables)
 */
export class GrokApiCredentials implements ICredentialType {
  name = 'grokApi'

  displayName = 'xAI (Grok) API'

  documentationUrl = 'https://docs.x.ai/docs/overview'

  /**
   * UI metadata for styling this credential type
   */
  uiMetadata = {
    icon: 'Bot',
    iconColor: 'text-neutral-900',
    backgroundColor: 'from-neutral-50 to-gray-100',
    borderColor: 'border-neutral-200',
    category: 'ai' as const,
    brandColor: '#000000', // xAI black
  }

  /**
   * System credential mapping for environment variable fallback
   * When no organization credential is provided, these env vars will be used
   */
  systemCredentialMapping = {
    apiKey: 'XAI_API_KEY',
  }

  /**
   * Form properties for creating/editing Grok credentials
   */
  properties: INodeProperty[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'password',
      default: '',
      required: true,
      placeholder: 'xai-...',
      description: 'Your xAI API key from https://console.x.ai',
      validation: {
        minLength: 20,
        errorMessage: 'Must be a valid xAI API key',
      },
    },
  ]
}
