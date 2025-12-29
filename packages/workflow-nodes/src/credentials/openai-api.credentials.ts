// packages/workflow-nodes/src/credentials/openai-api.credentials.ts

import type { ICredentialType, INodeProperty } from '../types'

/**
 * OpenAI API credential type for AI model operations
 * Supports both organization credentials (stored in database) and system credentials (environment variables)
 */
export class OpenAIApiCredentials implements ICredentialType {
  name = 'openaiApi'

  displayName = 'OpenAI API'

  documentationUrl = 'https://platform.openai.com/docs/api-reference'

  /**
   * UI metadata for styling this credential type
   */
  uiMetadata = {
    icon: 'Sparkles',
    iconColor: 'text-green-600',
    backgroundColor: 'from-green-50 to-emerald-50',
    borderColor: 'border-green-200',
    category: 'ai' as const,
    brandColor: '#10A37F', // OpenAI green
  }

  /**
   * System credential mapping for environment variable fallback
   * When no organization credential is provided, these env vars will be used
   */
  systemCredentialMapping = {
    apiKey: 'OPENAI_API_KEY',
    organization: 'OPENAI_ORGANIZATION',
  }

  /**
   * Optional system credential mapping for advanced configurations
   */
  optionalSystemCredentialMapping = {
    apiBase: 'OPENAI_API_BASE',
  }

  /**
   * Form properties for creating/editing OpenAI credentials
   */
  properties: INodeProperty[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'password',
      default: '',
      required: true,
      placeholder: 'sk-...',
      description: 'Your OpenAI API key from https://platform.openai.com/api-keys',
      validation: {
        minLength: 20,
        pattern: /^sk-[a-zA-Z0-9_-]+$/,
        errorMessage: 'Must be a valid OpenAI API key starting with sk-',
      },
    },
    {
      displayName: 'Organization ID (Optional)',
      name: 'organization',
      type: 'string',
      default: '',
      required: false,
      placeholder: 'org-...',
      description: 'OpenAI Organization ID for usage tracking (optional)',
      validation: {
        pattern: /^org-[a-zA-Z0-9]+$/,
        errorMessage: 'Must be a valid OpenAI Organization ID starting with org-',
      },
    },
    {
      displayName: 'API Base URL (Optional)',
      name: 'apiBase',
      type: 'string',
      default: 'https://api.openai.com/v1',
      required: false,
      placeholder: 'https://api.openai.com/v1',
      description: 'Custom API base URL for OpenAI-compatible endpoints',
      validation: {
        url: true,
        errorMessage: 'Must be a valid URL',
      },
    },
  ]
}
