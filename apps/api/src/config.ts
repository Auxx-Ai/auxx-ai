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

/** Parsed allowed origins for CORS */
export const allowedOrigins = (configService.get<string>('ALLOWED_ORIGINS') || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

/** SDK Client Secret (for OIDC token signing) */
export const SDK_CLIENT_SECRET =
  configService.get<string>('SDK_CLIENT_SECRET') || 'auxx-sdk-cli-secret-for-jwt-signing'

/** Is development environment */
export const isDevelopment = NODE_ENV === 'development'

/** Is production environment */
export const isProduction = NODE_ENV === 'production'

/** Custom S3 endpoint for non-AWS providers (R2, DO Spaces, etc.) */
export const S3_ENDPOINT = configService.get<string>('S3_ENDPOINT')

/** AWS Region for S3 */
export const AWS_REGION = configService.get<string>('S3_REGION') || 'us-west-1'

/** AWS Access Key ID for S3 */
export const AWS_ACCESS_KEY_ID = configService.get<string>('S3_ACCESS_KEY_ID')

/** AWS Secret Access Key for S3 */
export const AWS_SECRET_ACCESS_KEY = configService.get<string>('S3_SECRET_ACCESS_KEY')

/** S3 Bucket name for app bundles (private) */
export const S3_BUCKET_NAME = configService.get<string>('S3_PRIVATE_BUCKET') || 'auxx-private-local'

/** Development user ID for bypassing auth in development mode */
export const DEV_USER_ID = configService.get<string>('DEV_USER_ID')
