// packages/workflow-nodes/src/credentials/deepseek-api.credentials.ts

import type { ICredentialType, INodeProperty } from '../types'

/**
 * DeepSeek API credential type for AI model operations
 * Supports both organization credentials (stored in database) and system credentials (environment variables)
 */
export class DeepSeekApiCredentials implements ICredentialType {
  name = 'deepseekApi'

  displayName = 'DeepSeek API'

  documentationUrl = 'https://platform.deepseek.com/api-docs'

  /**
   * UI metadata for styling this credential type
   */
  uiMetadata = {
    icon: 'Search',
    iconColor: 'text-cyan-600',
    backgroundColor: 'from-cyan-50 to-teal-50',
    borderColor: 'border-cyan-200',
    category: 'ai' as const,
    brandColor: '#0EA5E9', // DeepSeek blue
  }

  /**
   * System credential mapping for environment variable fallback
   * When no organization credential is provided, these env vars will be used
   */
  systemCredentialMapping = {
    apiKey: 'DEEPSEEK_API_KEY',
  }

  /**
   * Form properties for creating/editing DeepSeek credentials
   */
  properties: INodeProperty[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'password',
      default: '',
      required: true,
      placeholder: 'sk-...',
      description: 'Your DeepSeek API key from https://platform.deepseek.com/api_keys',
      validation: {
        minLength: 20,
        errorMessage: 'Must be a valid DeepSeek API key',
      },
    },
  ]
}
