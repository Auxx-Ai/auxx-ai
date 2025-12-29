// packages/services/src/lambda-execution/prepare-lambda-context.ts

import { LAMBDA_API_URL } from '@auxx/config/urls'

/**
 * Build standardized Lambda execution context from installation and user/org info
 * This context is passed to all Lambda executions (server functions, workflow blocks, etc.)
 *
 * @param params - Object containing context information
 * @returns Lambda context object
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
  }
}
