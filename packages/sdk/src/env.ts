// packages/sdk/src/env.ts

/**
 * Environment mode detection
 * Defaults to development (localhost) unless explicitly set to production
 */
export const IS_PROD = process.env.AUXX_ENV === 'production'

/**
 * Main authenticated app URL (where better-auth is running)
 * Override with AUXX_APP_URL env var
 * Defaults to localhost for development
 */
export const APP_URL =
  process.env.AUXX_APP_URL || (IS_PROD ? 'https://app.auxx.ai' : 'http://localhost:3000')

/**
 * Developer portal frontend URL
 * Override with AUXX_PORTAL_URL env var
 * Defaults to localhost for development
 */
export const PORTAL_URL =
  process.env.AUXX_PORTAL_URL || (IS_PROD ? 'https://build.auxx.ai' : 'http://localhost:3006')

/**
 * Dedicated API server base URL - all SDK API calls go here
 * Override with AUXX_API_URL env var
 * Defaults to localhost for development
 */
export const API =
  process.env.AUXX_API_URL || (IS_PROD ? 'https://api.auxx.ai' : 'http://localhost:3007')

/** Authentication API base URL (better-auth endpoints) */
export const AUTH_API = `${APP_URL}/api/auth`

/** Feature flags */
export const USE_APP_TS = process.env.USE_APP_TS !== 'false'
export const USE_SETTINGS = process.env.USE_SETTINGS !== 'false'

// export const USE_APP_TS = process.env.USE_APP_TS === 'true'
// export const USE_SETTINGS = process.env.USE_SETTINGS === 'true'

/** SDK OAuth Client ID - this will be registered in better-auth */
export const SDK_CLIENT_ID = process.env.AUXX_SDK_CLIENT_ID || 'auxx-sdk-cli'
