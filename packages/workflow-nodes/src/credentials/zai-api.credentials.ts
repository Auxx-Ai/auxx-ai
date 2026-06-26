// packages/workflow-nodes/src/credentials/zai-api.credentials.ts

import type { ICredentialType, INodeProperty } from '../types'

/**
 * Z.AI (Zhipu / GLM) API credential type for AI model operations
 * Supports both organization credentials (stored in database) and system credentials (environment variables)
 */
export class ZaiApiCredentials implements ICredentialType {
  name = 'zaiApi'

  displayName = 'Z.AI API'

  documentationUrl = 'https://docs.z.ai/api-reference/introduction'

  /**
   * UI metadata for styling this credential type
   */
  uiMetadata = {
    icon: 'Bot',
    iconColor: 'text-blue-600',
    backgroundColor: 'from-blue-50 to-indigo-50',
    borderColor: 'border-blue-200',
    category: 'ai' as const,
    brandColor: '#3859FF',
  }

  /**
   * System credential mapping for environment variable fallback
   * When no organization credential is provided, these env vars will be used
   */
  systemCredentialMapping = {
    apiKey: 'ZAI_API_KEY',
  }

  /**
   * Form properties for creating/editing Z.AI credentials
   */
  properties: INodeProperty[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'password',
      default: '',
      required: true,
      placeholder: '<id>.<secret>',
      description: 'Your Z.AI API key from https://z.ai/manage-apikey/apikey-list',
      validation: {
        minLength: 20,
        errorMessage: 'Must be a valid Z.AI API key',
      },
    },
  ]
}
