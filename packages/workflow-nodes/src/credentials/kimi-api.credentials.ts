// packages/workflow-nodes/src/credentials/kimi-api.credentials.ts

import type { ICredentialType, INodeProperty } from '../types'

/**
 * Kimi (Moonshot AI) API credential type for AI model operations
 * Supports both organization credentials (stored in database) and system credentials (environment variables)
 */
export class KimiApiCredentials implements ICredentialType {
  name = 'kimiApi'

  displayName = 'Kimi API'

  documentationUrl = 'https://platform.moonshot.ai/docs/overview'

  /**
   * UI metadata for styling this credential type
   */
  uiMetadata = {
    icon: 'Bot',
    iconColor: 'text-blue-600',
    backgroundColor: 'from-blue-50 to-indigo-50',
    borderColor: 'border-blue-200',
    category: 'ai' as const,
    brandColor: '#027AFF',
  }

  /**
   * System credential mapping for environment variable fallback
   * When no organization credential is provided, these env vars will be used
   */
  systemCredentialMapping = {
    apiKey: 'KIMI_API_KEY',
  }

  /**
   * Form properties for creating/editing Kimi credentials
   */
  properties: INodeProperty[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'password',
      default: '',
      required: true,
      placeholder: 'sk-...',
      description: 'Your Kimi API key from https://platform.moonshot.ai/console/api-keys',
      validation: {
        minLength: 20,
        errorMessage: 'Must be a valid Kimi API key',
      },
    },
  ]
}
