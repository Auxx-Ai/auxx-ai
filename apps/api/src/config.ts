// apps/api/src/config.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { configService } from '@auxx/credentials'

/**
 * API server configuration
 * Uses @auxx/config for environment variables and SST secrets
 */

/** Server port */
export const PORT = configService.get<number>('API_PORT') ?? 3007

/** Node environment */
export const NODE_ENV = configService.get<string>('NODE_ENV') || 'development'

/** Database URL (from configService) */
export const DATABASE_URL = configService.get<string>('DATABASE_URL')

/** Better-auth base URL for authentication endpoints */
export const BETTER_AUTH_BASE_URL = `${WEBAPP_URL}/api/auth`

/** Better-auth session endpoint (legacy - use BETTER_AUTH_BASE_URL instead) */
export const BETTER_AUTH_SESSION_URL = `${BETTER_AUTH_BASE_URL}/session`

/** Better-auth UserInfo endpoint for OAuth access token validation */
export const BETTER_AUTH_USERINFO_URL = `${BETTER_AUTH_BASE_URL}/oauth2/userinfo`

/** Better-auth secret (optional, for JWT verification if needed) */
export const BETTER_AUTH_SECRET = configService.get<string>('BETTER_AUTH_SECRET')

/** SDK Client Secret (for OIDC token signing) */
export const SDK_CLIENT_SECRET =
  configService.get<string>('SDK_CLIENT_SECRET') || 'auxx-sdk-cli-secret-for-jwt-signing'

/** Is production environment */
export const isProduction = NODE_ENV === 'production'
