// apps/api/src/config.ts

import { env, WEBAPP_URL } from '@auxx/config/server'

/**
 * API server configuration
 * Uses @auxx/config for environment variables and SST secrets
 */

/** Server port */
export const PORT = env.PORT || 3007

/** Node environment */
export const NODE_ENV = env.NODE_ENV || 'development'

/** Database URL (from @auxx/config) */
export const DATABASE_URL = env.DATABASE_URL

/** Better-auth base URL for authentication endpoints */
export const BETTER_AUTH_BASE_URL = `${WEBAPP_URL}/api/auth`

/** Better-auth session endpoint (legacy - use BETTER_AUTH_BASE_URL instead) */
export const BETTER_AUTH_SESSION_URL = `${BETTER_AUTH_BASE_URL}/session`

/** Better-auth UserInfo endpoint for OAuth access token validation */
export const BETTER_AUTH_USERINFO_URL = `${BETTER_AUTH_BASE_URL}/oauth2/userinfo`

/** Better-auth secret (optional, for JWT verification if needed) */
export const BETTER_AUTH_SECRET = env.BETTER_AUTH_SECRET

/** Parsed allowed origins for CORS */
export const allowedOrigins = (env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

/** SDK Client Secret (for OIDC token signing) */
export const SDK_CLIENT_SECRET = env.SDK_CLIENT_SECRET || 'auxx-sdk-cli-secret-for-jwt-signing'

/** Is development environment */
export const isDevelopment = NODE_ENV === 'development'

/** Is production environment */
export const isProduction = NODE_ENV === 'production'

/** Custom S3 endpoint for non-AWS providers (R2, DO Spaces, etc.) */
export const S3_ENDPOINT = env.S3_ENDPOINT

/** AWS Region for S3 */
export const AWS_REGION = env.S3_REGION || 'us-west-1'

/** AWS Access Key ID for S3 */
export const AWS_ACCESS_KEY_ID = env.S3_ACCESS_KEY_ID

/** AWS Secret Access Key for S3 */
export const AWS_SECRET_ACCESS_KEY = env.S3_SECRET_ACCESS_KEY

/** S3 Bucket name for app bundles (private) */
export const S3_BUCKET_NAME = env.S3_PRIVATE_BUCKET || 'auxx-private-local'

/** Development user ID for bypassing auth in development mode */
export const DEV_USER_ID = env.DEV_USER_ID
