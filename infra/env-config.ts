// infra/env-config.ts
import { domain, subdomain, getAppDomain, getHomepageDomain } from './dns'
import {
  publicBucketName,
  privateBucketName,
  publicCdnUrl,
} from './storage'

export type AppType = 'web' | 'homepage' | 'docs' | 'worker' | 'api'

// Port mapping for development
const DEV_PORTS: Record<AppType, number> = {
  web: 3000,
  homepage: 3001,
  docs: 3004,
  worker: 3003,
  api: 3002,
}

/**
 * Helper to get app URL based on stage
 */
export const getAppUrl = (app: AppType = 'web') => {
  if ($dev) return `http://localhost:${DEV_PORTS[app]}`

  switch (app) {
    case 'web':
      return `https://${getAppDomain()}`
    case 'homepage':
      return `https://${getHomepageDomain()}`
    case 'docs':
      return `https://${subdomain('docs')}`
    case 'worker':
      return `https://${subdomain('worker')}`
    case 'api':
      return `https://${subdomain('api')}`
    default:
      return `https://${domain}`
  }
}

/**
 * Helper to get Node environment based on SST stage
 */
export const getNodeEnv = () => {
  // Always use production for Next.js builds
  return 'production'
}

/**
 * Get all environment variables with defaults
 * These are non-sensitive configuration values that don't need to be secrets
 */
export function getEnvVars(app: AppType = 'web') {
  const baseUrl = getAppUrl(app)
  const homepageUrl = getAppUrl('homepage')
  const authAppUrl = getAppUrl('web')

  return {
    // Node.js Configuration
    NODE_ENV: 'production', // Always production for Next.js builds
    NODE_NO_DEPRECATION: process.env.NODE_NO_DEPRECATION || '1',
    NODE_NO_WARNINGS: process.env.NODE_NO_WARNINGS || '1',

    // AI Model Configuration
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
    OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4o',
    USE_BACKUP_MODEL: process.env.USE_BACKUP_MODEL || 'false',

    // Worker Configuration
    WORKERS_HOST: process.env.WORKERS_HOST || 'localhost',
    WORKERS_PORT: process.env.WORKERS_PORT || '3001',

    // Storage Configuration
    FILE_STORAGE_TYPE: process.env.FILE_STORAGE_TYPE || 's3',
    NEXT_PUBLIC_STORAGE_TYPE: process.env.NEXT_PUBLIC_STORAGE_TYPE || 's3',

    // Public bucket (for avatars, logos, etc.)
    S3_PUBLIC_BUCKET: publicBucketName,
    NEXT_PUBLIC_S3_PUBLIC_BUCKET: publicBucketName,

    // Private bucket (for attachments, temp files, etc.)
    S3_PRIVATE_BUCKET: privateBucketName,
    NEXT_PUBLIC_S3_PRIVATE_BUCKET: privateBucketName,

    // CDN URL for public assets
    NEXT_PUBLIC_CDN_URL: publicCdnUrl,

    // Region (same for both buckets)
    S3_REGION: 'us-west-1',
    NEXT_PUBLIC_S3_REGION: 'us-west-1',

    // Legacy bucket name (backwards compatibility - will be removed)
    NEXT_PUBLIC_S3_BUCKET: process.env.NEXT_PUBLIC_S3_BUCKET || '',

    // Cache Configuration
    CACHE_PROVIDER: process.env.CACHE_PROVIDER || 'hosted',
    ELASTICACHE_TLS: 'true',
    ELASTICACHE_URL: process.env.ELASTICACHE_URL || '',

    // Security Configuration
    SKIP_CHAT_SESSION_VERIFICATION: process.env.SKIP_CHAT_SESSION_VERIFICATION || 'false',

    // Email Provider Configuration
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER || 'mailgun',
    SYSTEM_FROM_EMAIL: process.env.SYSTEM_FROM_EMAIL || 'noreply@m.auxx.ai',
    SYSTEM_FROM_NAME: process.env.SYSTEM_FROM_NAME || 'System',
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || 'support@m.auxx.ai',
    SUPPORT_NAME: process.env.SUPPORT_NAME || 'Support Team',
    EMAIL_REPLY_TO: process.env.EMAIL_REPLY_TO || '',

    // Mailgun Configuration
    MAILGUN_REGION: process.env.MAILGUN_REGION || 'us',
    MAILGUN_DOMAIN: process.env.MAILGUN_DOMAIN || 'm.auxx.ai',

    // AWS SES Configuration (alternative email provider)
    AWS_SES_ACCESS_KEY_ID: process.env.AWS_SES_ACCESS_KEY_ID || '',
    AWS_SES_SECRET_ACCESS_KEY: process.env.AWS_SES_SECRET_ACCESS_KEY || '',
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || '',
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || '',

    // SMTP Configuration (optional email provider)
    SMTP_HOST: process.env.SMTP_HOST || '',
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_SECURE: process.env.SMTP_SECURE || 'false',
    SMTP_USER: process.env.SMTP_USER || '',
    SMTP_PASS: process.env.SMTP_PASS || '',

    // External Service Configuration
    FACEBOOK_GRAPH_API_VERSION: process.env.FACEBOOK_GRAPH_API_VERSION || 'v19.0',
    GOOGLE_PUBSUB_TOPIC: process.env.GOOGLE_PUBSUB_TOPIC || 'email-notifications',
    GOOGLE_PUBSUB_SUBSCRIPTION: process.env.GOOGLE_PUBSUB_SUBSCRIPTION || 'email-notifications-sub',
    PUSHER_CLUSTER: process.env.PUSHER_CLUSTER || 'us2',
    NEXT_PUBLIC_PUSHER_CLUSTER: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'us2',

    // Public URLs
    NEXT_PUBLIC_BASE_URL: authAppUrl,
    NEXT_PUBLIC_APP_URL: authAppUrl, // Always web app URL for auth links
    NEXT_PUBLIC_HOMEPAGE_URL: homepageUrl,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
  }
}

/**
 * Get only public environment variables
 */
export function getPublicEnvVars() {
  const allVars = getEnvVars()
  return Object.keys(allVars)
    .filter((key) => key.startsWith('NEXT_PUBLIC_'))
    .reduce(
      (acc, key) => {
        acc[key] = allVars[key as keyof typeof allVars]
        return acc
      },
      {} as Record<string, string>
    )
}

/**
 * Get only private environment variables
 */
export function getPrivateEnvVars() {
  const allVars = getEnvVars()
  return Object.keys(allVars)
    .filter((key) => !key.startsWith('NEXT_PUBLIC_'))
    .reduce(
      (acc, key) => {
        acc[key] = allVars[key as keyof typeof allVars]
        return acc
      },
      {} as Record<string, string>
    )
}
