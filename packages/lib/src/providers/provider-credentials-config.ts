// packages/lib/src/providers/provider-credentials-config.ts

/**
 * Maps channel providers to their OAuth config variable keys.
 * Used by both frontend (credential form) and backend (credential resolution).
 */
export const PROVIDER_CREDENTIAL_CONFIG = {
  google: {
    clientIdKey: 'GOOGLE_CLIENT_ID',
    clientSecretKey: 'GOOGLE_CLIENT_SECRET',
    approvalFlagKey: 'GOOGLE_PLATFORM_CREDENTIALS_APPROVED',
    callbackPath: '/api/google/oauth2/callback',
    displayName: 'Google',
    /** Docs path relative to docsUrl — use with useEnv().docsUrl to build full URL */
    helpDocsPath: '/help/channels/gmail',
  },
  outlook: {
    clientIdKey: 'OUTLOOK_CLIENT_ID',
    clientSecretKey: 'OUTLOOK_CLIENT_SECRET',
    approvalFlagKey: 'OUTLOOK_PLATFORM_CREDENTIALS_APPROVED',
    callbackPath: '/api/outlook/oauth2/callback',
    displayName: 'Microsoft Outlook',
    /** Docs path relative to docsUrl — use with useEnv().docsUrl to build full URL */
    helpDocsPath: '/help/channels/outlook',
  },
} as const

export type BYOCProvider = keyof typeof PROVIDER_CREDENTIAL_CONFIG
