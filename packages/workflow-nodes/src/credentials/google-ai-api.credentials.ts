// packages/workflow-nodes/src/credentials/google-ai-api.credentials.ts

import type { ICredentialType, INodeProperty } from '../types'

/**
 * Google AI (Gemini) API credential type for AI model operations
 * Supports both organization credentials (stored in database) and system credentials (environment variables)
 */
export class GoogleAIApiCredentials implements ICredentialType {
  name = 'googleAiApi'

  displayName = 'Google AI API'

  documentationUrl = 'https://ai.google.dev/docs'

  /**
   * UI metadata for styling this credential type
   */
  uiMetadata = {
    icon: 'Sparkles',
    iconColor: 'text-blue-600',
    backgroundColor: 'from-blue-50 to-indigo-50',
    borderColor: 'border-blue-200',
    category: 'ai' as const,
    brandColor: '#4285F4', // Google blue
  }

  /**
   * System credential mapping for environment variable fallback
   * When no organization credential is provided, these env vars will be used
   */
  systemCredentialMapping = {
    apiKey: 'GOOGLE_AI_API_KEY',
  }

  /**
   * Form properties for creating/editing Google AI credentials
   */
  properties: INodeProperty[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'password',
      default: '',
      required: true,
      placeholder: 'AIza...',
      description: 'Your Google AI API key from https://aistudio.google.com/app/apikey',
      validation: {
        minLength: 20,
        errorMessage: 'Must be a valid Google AI API key',
      },
    },
  ]
}
