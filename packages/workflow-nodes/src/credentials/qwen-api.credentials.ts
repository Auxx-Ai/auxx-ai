// packages/workflow-nodes/src/credentials/qwen-api.credentials.ts

import type { ICredentialType, INodeProperty } from '../types'

/**
 * Qwen API credential type for AI model operations via DashScope
 * Supports both organization credentials (stored in database) and system credentials (environment variables)
 */
export class QwenApiCredentials implements ICredentialType {
  name = 'qwenApi'

  displayName = 'Qwen API'

  documentationUrl = 'https://www.alibabacloud.com/help/en/model-studio/'

  /**
   * UI metadata for styling this credential type
   */
  uiMetadata = {
    icon: 'Sparkles',
    iconColor: 'text-violet-600',
    backgroundColor: 'from-violet-50 to-purple-50',
    borderColor: 'border-violet-200',
    category: 'ai' as const,
    brandColor: '#615EFF',
  }

  /**
   * System credential mapping for environment variable fallback
   * When no organization credential is provided, these env vars will be used
   */
  systemCredentialMapping = {
    apiKey: 'QWEN_API_KEY',
  }

  /**
   * Form properties for creating/editing Qwen credentials
   */
  properties: INodeProperty[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'password',
      default: '',
      required: true,
      placeholder: 'sk-...',
      description: 'Your DashScope API key from https://dashscope.console.aliyun.com/apiKey',
      validation: {
        minLength: 20,
        errorMessage: 'Must be a valid DashScope API key',
      },
    },
  ]
}
