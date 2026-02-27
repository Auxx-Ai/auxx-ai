// infra/secrets.ts
/// <reference path="../.sst/platform/config.d.ts" />

import { DATABASE_URL, REDIS_HOST, REDIS_PASSWORD, REDIS_PORT, REDIS_URL } from './db'
import { domain, getAppDomain } from './dns'
import { type AppType, getAppUrl } from './env-config'

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
  LAMBDA_INVOKE_SECRET: {
    secret: new sst.Secret('LAMBDA_INVOKE_SECRET'),
    description: 'Shared secret for authenticating lambda invocations',
  },
  WORKFLOW_CREDENTIAL_ENCRYPTION_KEY: {
    secret: new sst.Secret('WORKFLOW_CREDENTIAL_ENCRYPTION_KEY'),
    description: 'Encryption key for workflow credential storage',
  },
  PUBLIC_WORKFLOW_JWT_SECRET: {
    secret: new sst.Secret('PUBLIC_WORKFLOW_JWT_SECRET'),
    description: 'JWT secret for public workflow passports',
  },
  SDK_CLIENT_SECRET: {
    secret: new sst.Secret('SDK_CLIENT_SECRET'),
    description: 'SDK client secret for OIDC/JWT signing',
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
  STRIPE_PUBLISHABLE_KEY: {
    secret: new sst.Secret('STRIPE_PUBLISHABLE_KEY'),
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

  // PostHog
  POSTHOG_KEY: {
    secret: new sst.Secret('POSTHOG_KEY'),
    description: 'PostHog project API key',
  },

  // Email / SMTP
  EMAIL_PROVIDER: {
    secret: new sst.Secret('EMAIL_PROVIDER'),
    description: 'Email sending provider (smtp, mailgun, ses, sendmail)',
  },
  SMTP_HOST: {
    secret: new sst.Secret('SMTP_HOST'),
    description: 'SMTP server hostname',
  },
  SMTP_PORT: {
    secret: new sst.Secret('SMTP_PORT'),
    description: 'SMTP server port',
  },
  SMTP_SECURE: {
    secret: new sst.Secret('SMTP_SECURE'),
    description: 'Use TLS for SMTP connection',
  },
  SMTP_USER: {
    secret: new sst.Secret('SMTP_USER'),
    description: 'SMTP authentication username',
  },
  SMTP_PASS: {
    secret: new sst.Secret('SMTP_PASS'),
    description: 'SMTP authentication password',
  },

  // Mailgun
  MAILGUN_API_KEY: {
    secret: new sst.Secret('MAILGUN_API_KEY'),
    description: 'Mailgun API key for email sending',
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
 * Get secrets for linking to resources based on app tier.
 * Static sites (homepage, docs) need no secrets; full apps get all.
 */
export function getSecretsForLinking(app: AppType = 'web') {
  if (app === 'homepage' || app === 'docs') return []
  return Object.values(secretsConfig).map((c) => c.secret)
}

/**
 * Minimal Lambda environment for staying far under the 4KB limit.
 * configService resolves most config at runtime via SST Resource or DB.
 * Static sites only need URLs; full apps add boot-critical vars.
 */
export function getSelectedEnvVars(
  app: AppType = 'web',
  opts: { lambdaExecutorUrl?: string } = {}
): Record<string, string> {
  const base: Record<string, string> = {
    SST: '1',
    NODE_ENV: 'production',
    NODE_NO_DEPRECATION: '1',
    NODE_NO_WARNINGS: '1',
    // Build metadata for UI/version diagnostics
    GIT_SHA: process.env.GIT_SHA || '',
    APP_VERSION: process.env.APP_VERSION || '',
    BUILD_TIME: process.env.BUILD_TIME || '',
    // Canonical URL env vars
    DOMAIN: domain,
    APP_URL: `https://${getAppDomain()}`,
    HOMEPAGE_URL: getAppUrl('homepage'),
    DOCS_URL: getAppUrl('docs'),
    API_URL: getAppUrl('api'),
    DEV_PORTAL_URL: getAppUrl('build'),
  }

  // Static sites only need URLs
  if (app === 'homepage' || app === 'docs') return base

  // Full apps: add boot-critical vars (needed before configService.init())
  const vars: Record<string, string> = {
    ...base,
    IS_CONFIG_VARIABLES_IN_DB_ENABLED: 'true',
    LAMBDA_API_URL: getAppUrl('api'),
    BETTER_AUTH_SECRET: getSecretValue('BETTER_AUTH_SECRET'),
    DATABASE_URL,
    REDIS_URL,
    REDIS_HOST,
    REDIS_PORT,
    REDIS_PASSWORD,
    ELASTICACHE_TLS: process.env.ELASTICACHE_TLS || 'true',
    SUPER_ADMIN_EMAIL: getSecretValue('SUPER_ADMIN_EMAIL'),
    // Database pool tuning per service
    DB_POOL_MAX: app === 'web' ? '3' : app === 'api' ? '5' : '10',
    DB_POOL_IDLE_TIMEOUT: app === 'web' ? '10000' : '30000',
    APP_NAME: `auxx-${app}`,
  }

  // Lambda function URL is an AWS-generated URL only available at deploy time
  if (opts.lambdaExecutorUrl) {
    vars.LAMBDA_EXECUTOR_URL = opts.lambdaExecutorUrl
  }

  return vars
}

/**
 * Helper to get specific secret value by name
 * @param name - Secret name from secretsConfig
 * @returns Secret value or empty string
 */
export function getSecretValue(name: keyof typeof secretsConfig): string {
  return secretsConfig[name]?.secret.value || ''
}
