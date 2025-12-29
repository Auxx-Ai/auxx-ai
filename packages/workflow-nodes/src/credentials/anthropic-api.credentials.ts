// packages/workflow-nodes/src/credentials/anthropic-api.credentials.ts

import type { ICredentialType, INodeProperty } from '../types'

/**
 * Anthropic API credential type for Claude model operations
 * Supports both organization credentials (stored in database) and system credentials (environment variables)
 */
export class AnthropicApiCredentials implements ICredentialType {
  name = 'anthropicApi'

  displayName = 'Anthropic API'

  documentationUrl = 'https://docs.anthropic.com/en/api'

  /**
   * UI metadata for styling this credential type
   */
  uiMetadata = {
    icon: 'Bot',
    iconColor: 'text-amber-600',
    backgroundColor: 'from-amber-50 to-orange-50',
    borderColor: 'border-amber-200',
    category: 'ai' as const,
    brandColor: '#D4A574', // Anthropic tan
  }

  /**
   * System credential mapping for environment variable fallback
   * When no organization credential is provided, these env vars will be used
   */
  systemCredentialMapping = {
    apiKey: 'ANTHROPIC_API_KEY',
  }

  /**
   * Form properties for creating/editing Anthropic credentials
   */
  properties: INodeProperty[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'password',
      default: '',
      required: true,
      placeholder: 'sk-ant-...',
      description: 'Your Anthropic API key from https://console.anthropic.com/settings/keys',
      validation: {
        minLength: 20,
        pattern: /^sk-ant-[a-zA-Z0-9_-]+$/,
        errorMessage: 'Must be a valid Anthropic API key starting with sk-ant-',
      },
    },
  ]
}
