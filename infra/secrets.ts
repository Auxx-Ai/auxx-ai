// infra/secrets.ts
/// <reference path="../.sst/platform/config.d.ts" />

import { getEnvVars, type AppType } from './env-config'
import { DATABASE_URL, REDIS_URL, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD } from './db'
import { getAppDomain } from './dns'

/**
 * Centralized secrets configuration
 * Maps environment variable names to SST Secret resources
 */
export const secretsConfig = {
  // Authentication & Security
  BETTER_AUTH_SECRET: {
    secret: new sst.Secret('BETTER_AUTH_SECRET'),
    description: 'Authentication secret for BetterAuth',
  },
  API_KEY_SALT: {
    secret: new sst.Secret('API_KEY_SALT'),
    description: 'Salt for API key generation',
  },

  // OAuth - GitHub
  AUTH_GITHUB_ID: {
    secret: new sst.Secret('AUTH_GITHUB_ID'),
    description: 'GitHub OAuth client ID',
  },
  AUTH_GITHUB_SECRET: {
    secret: new sst.Secret('AUTH_GITHUB_SECRET'),
    description: 'GitHub OAuth client secret',
  },

  // OAuth - Google
  AUTH_GOOGLE_ID: {
    secret: new sst.Secret('AUTH_GOOGLE_ID'),
    description: 'Google OAuth client ID',
  },
  AUTH_GOOGLE_SECRET: {
    secret: new sst.Secret('AUTH_GOOGLE_SECRET'),
    description: 'Google OAuth client secret',
  },

  // AI Services
  ANTHROPIC_API_KEY: {
    secret: new sst.Secret('ANTHROPIC_API_KEY'),
    description: 'Anthropic API key for Claude models',
  },
  OPENAI_API_KEY: {
    secret: new sst.Secret('OPENAI_API_KEY'),
    description: 'OpenAI API key for GPT models',
  },
  GROQ_API_KEY: {
    secret: new sst.Secret('GROQ_API_KEY'),
    description: 'Groq API key for LLM inference',
  },

  // AWS Services
  BEDROCK_ACCESS_KEY: {
    secret: new sst.Secret('BEDROCK_ACCESS_KEY'),
    description: 'AWS Bedrock access key',
  },
  BEDROCK_SECRET_KEY: {
    secret: new sst.Secret('BEDROCK_SECRET_KEY'),
    description: 'AWS Bedrock secret key',
  },

  // Google Services
  GOOGLE_API_KEY: {
    secret: new sst.Secret('GOOGLE_API_KEY'),
    description: 'Google API key',
  },
  GOOGLE_CLIENT_EMAIL: {
    secret: new sst.Secret('GOOGLE_CLIENT_EMAIL'),
    description: 'Google service account client email',
  },
  GOOGLE_CLIENT_ID: {
    secret: new sst.Secret('GOOGLE_CLIENT_ID'),
    description: 'Google OAuth client ID',
  },
  GOOGLE_CLIENT_SECRET: {
    secret: new sst.Secret('GOOGLE_CLIENT_SECRET'),
    description: 'Google OAuth client secret',
  },
  GOOGLE_PRIVATE_KEY: {
    secret: new sst.Secret('GOOGLE_PRIVATE_KEY'),
    description: 'Google service account private key',
  },
  GOOGLE_PROJECT_ID: {
    secret: new sst.Secret('GOOGLE_PROJECT_ID'),
    description: 'Google Cloud project ID',
  },
  GOOGLE_PUBSUB_VERIFICATION_TOKEN: {
    secret: new sst.Secret('GOOGLE_PUBSUB_VERIFICATION_TOKEN'),
    description: 'Google PubSub webhook verification token',
  },

  // Social Media - Facebook
  FACEBOOK_APP_ID: {
    secret: new sst.Secret('FACEBOOK_APP_ID'),
    description: 'Facebook application ID',
  },
  FACEBOOK_APP_SECRET: {
    secret: new sst.Secret('FACEBOOK_APP_SECRET'),
    description: 'Facebook application secret',
  },
  FACEBOOK_WEBHOOK_VERIFY_TOKEN: {
    secret: new sst.Secret('FACEBOOK_WEBHOOK_VERIFY_TOKEN'),
    description: 'Facebook webhook verification token',
  },

  // Outlook/Microsoft
  OUTLOOK_CLIENT_ID: {
    secret: new sst.Secret('OUTLOOK_CLIENT_ID'),
    description: 'Microsoft Outlook OAuth client ID',
  },
  OUTLOOK_CLIENT_SECRET: {
    secret: new sst.Secret('OUTLOOK_CLIENT_SECRET'),
    description: 'Microsoft Outlook OAuth client secret',
  },
  OUTLOOK_WEBHOOK_SECRET: {
    secret: new sst.Secret('OUTLOOK_WEBHOOK_SECRET'),
    description: 'Microsoft Outlook webhook secret',
  },

  // Dropbox
  DROPBOX_CLIENT_ID: {
    secret: new sst.Secret('DROPBOX_CLIENT_ID'),
    description: 'Dropbox OAuth client ID',
  },
  DROPBOX_CLIENT_SECRET: {
    secret: new sst.Secret('DROPBOX_CLIENT_SECRET'),
    description: 'Dropbox OAuth client secret',
  },

  // Shopify
  SHOPIFY_API_KEY: {
    secret: new sst.Secret('SHOPIFY_API_KEY'),
    description: 'Shopify API key',
  },
  SHOPIFY_API_SECRET: {
    secret: new sst.Secret('SHOPIFY_API_SECRET'),
    description: 'Shopify API secret',
  },

  // Stripe
  STRIPE_SECRET_KEY: {
    secret: new sst.Secret('STRIPE_SECRET_KEY'),
    description: 'Stripe secret API key',
  },
  STRIPE_WEBHOOK_SECRET: {
    secret: new sst.Secret('STRIPE_WEBHOOK_SECRET'),
    description: 'Stripe webhook endpoint secret',
  },
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: {
    secret: new sst.Secret('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'),
    isPublic: true,
    description: 'Stripe publishable key for client-side',
  },

  // Pusher
  PUSHER_APP_ID: {
    secret: new sst.Secret('PUSHER_APP_ID'),
    description: 'Pusher application ID',
  },
  PUSHER_KEY: {
    secret: new sst.Secret('PUSHER_KEY'),
    description: 'Pusher application key',
  },
  PUSHER_SECRET: {
    secret: new sst.Secret('PUSHER_SECRET'),
    description: 'Pusher application secret',
  },
  NEXT_PUBLIC_PUSHER_KEY: {
    secret: new sst.Secret('NEXT_PUBLIC_PUSHER_KEY'),
    isPublic: true,
    description: 'Pusher key for client-side',
  },

  // PostHog
  NEXT_PUBLIC_POSTHOG_KEY: {
    secret: new sst.Secret('NEXT_PUBLIC_POSTHOG_KEY'),
    isPublic: true,
    description: 'PostHog project API key for client-side',
  },

  // Mailgun
  MAILGUN_API_KEY: {
    secret: new sst.Secret('MAILGUN_API_KEY'),
    description: 'Mailgun API key for email sending',
  },

  // Bull Dashboard
  BULL_ADMIN_USER: {
    secret: new sst.Secret('BULL_ADMIN_USER'),
    description: 'Bull dashboard admin username',
  },
  BULL_ADMIN_PASS: {
    secret: new sst.Secret('BULL_ADMIN_PASS'),
    description: 'Bull dashboard admin password',
  },

  // Gravatar
  GRAVATAR_API_KEY: {
    secret: new sst.Secret('GRAVATAR_API_KEY'),
    description: 'Gravatar API key for avatar fetching',
  },

  // Admin Configuration
  SUPER_ADMIN_EMAIL: {
    secret: new sst.Secret('SUPER_ADMIN_EMAIL'),
    description: 'Email address of the user to promote to super admin on signup',
  },
} as const

/**
 * Type for secret configuration
 */
export type SecretConfig = {
  secret: ReturnType<typeof sst.Secret>
  isPublic?: boolean
  description: string
}

/**
 * Get all secret names for type safety
 */
export type SecretName = keyof typeof secretsConfig

/**
 * Derived list of secret keys for reuse (linking, tooling)
 */
export const SECRET_KEYS = Object.keys(secretsConfig) as SecretName[]

/**
 * Get all secrets for linking to resources
 * @returns Array of all secret resources
 */
export function getAllSecretsForLinking() {
  return Object.values(secretsConfig).map((c) => c.secret)
}

export function getHomepageSecretsForLinking() {
  return []
}

/**
 * Minimal Lambda environment for staying far under the 4KB limit.
 * Relies on `link: getAllSecretsForLinking()` for secret access via Resource.
 */
export function getSelectedEnvVars(app: AppType = 'web'): Record<string, string> {
  const vars = getEnvVars(app)
  return {
    // Mark SST runtime explicitly for the env proxy
    SST: '1',

    // Node runtime tweaks
    NODE_ENV: 'production',
    NODE_NO_DEPRECATION: vars.NODE_NO_DEPRECATION || '1',
    NODE_NO_WARNINGS: vars.NODE_NO_WARNINGS || '1',

    // Authentication (needed at module load time, can't wait for async Resource access)
    BETTER_AUTH_SECRET: getSecretValue('BETTER_AUTH_SECRET'),
    //BETTER_AUTH_URL: `https://${getAppDomain()}`, //vars.NEXT_PUBLIC_BASE_URL,
    //NEXT_PUBLIC_BETTER_AUTH_URL: `https://${getAppDomain()}`, //vars.NEXT_PUBLIC_BASE_URL,
    // Database and cache (drizzle/Redis need these at boot)
    DATABASE_URL,
    REDIS_URL,
    REDIS_HOST,
    REDIS_PORT,
    REDIS_PASSWORD,
    ELASTICACHE_TLS: vars.ELASTICACHE_TLS,
    // Public URLs used by web/clients
    NEXT_PUBLIC_BASE_URL: `https://${getAppDomain()}`,
    // NEXT_PUBLIC_BASE_URL: vars.NEXT_PUBLIC_BASE_URL,
    NEXT_PUBLIC_APP_URL: vars.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_HOMEPAGE_URL: vars.NEXT_PUBLIC_HOMEPAGE_URL,

    // Core service configuration
    EMAIL_PROVIDER: vars.EMAIL_PROVIDER,
    FILE_STORAGE_TYPE: vars.FILE_STORAGE_TYPE,
    CACHE_PROVIDER: vars.CACHE_PROVIDER,

    // Model defaults
    ANTHROPIC_MODEL: vars.ANTHROPIC_MODEL,
    OPENAI_MODEL: vars.OPENAI_MODEL,

    // Admin configuration
    SUPER_ADMIN_EMAIL: getSecretValue('SUPER_ADMIN_EMAIL'),
  }
}

/**
 * Helper to get specific secret value by name
 * @param name - Secret name from secretsConfig
 * @returns Secret value or empty string
 */
export function getSecretValue(name: keyof typeof secretsConfig): string {
  return secretsConfig[name]?.secret.value || ''
}

/**
 * Helper to get specific env var value by name
 * @param name - Environment variable name
 * @returns Environment variable value or empty string
 */
export function getEnvValue(name: string): string {
  const envVars = getEnvVars()
  return (envVars as any)[name] || ''
}
