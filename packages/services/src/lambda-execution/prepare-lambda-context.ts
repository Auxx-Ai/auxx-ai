// packages/services/src/lambda-execution/prepare-lambda-context.ts

import { LAMBDA_API_URL } from '@auxx/config/urls'
import { type CallbackScope, createCallbackToken } from '@auxx/credentials/lambda-auth'

/**
 * Build standardized Lambda execution context from installation and user/org info.
 * This context is passed to all Lambda executions (server functions, workflow blocks, etc.)
 *
 * Generates scoped callback tokens for SDK → API authentication when
 * LAMBDA_INVOKE_SECRET is available.
 */
export function prepareLambdaContext(params: {
  appId: string
  installationId: string
  organizationId: string
  organizationHandle: string | null
  userId: string
  userEmail: string | null
  userName: string | null
  userConnection?: any
  organizationConnection?: any
}) {
  // Generate scoped callback tokens for SDK → API authentication
  const secret = process.env.LAMBDA_INVOKE_SECRET
  let callbackTokens: Record<CallbackScope, string> | undefined

  if (secret) {
    const scopes: CallbackScope[] = ['webhooks', 'settings']
    callbackTokens = {} as Record<CallbackScope, string>
    for (const scope of scopes) {
      callbackTokens[scope] = createCallbackToken({
        installationId: params.installationId,
        organizationId: params.organizationId,
        scope,
        secret,
      })
    }
  }

  return {
    organizationId: params.organizationId,
    organizationHandle: params.organizationHandle,
    userId: params.userId,
    userEmail: params.userEmail,
    userName: params.userName,
    appId: params.appId,
    apiUrl: LAMBDA_API_URL,
    appInstallationId: params.installationId,
    userConnection: params.userConnection,
    organizationConnection: params.organizationConnection,
    callbackTokens,
  }
}
