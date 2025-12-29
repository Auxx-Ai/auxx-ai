// packages/config/src/sst-resources.ts
import { Resource } from 'sst'

/**
 * Get the database URL for drizzle connections
 * Handles both local development and production environments
 */
// export const getDatabaseUrl = () => {
//   // First check if DATABASE_URL is set (for local dev or build time)
//   if (process.env.DATABASE_URL) {
//     return process.env.DATABASE_URL
//   }

//   // In production, construct from SST Resource
//   try {
//     const db = Resource.AuxxAiRds
//     return `postgresql://${db.username}:${db.password}@${db.host}:${db.port}/${db.database}`
//   } catch (error) {
//     // Fallback for build time or when resources aren't available
//     console.warn('Database resource not available, using fallback URL')
//     return 'postgresql://postgres:password@localhost:5432/auxx-ai'
//   }
// }

/**
 * Get Redis configuration
 * Returns host, port, and password for Redis connections
 */
// export const getRedisConfig = () => {
//   // First check if REDIS_HOST is set (for local dev)
//   if (process.env.REDIS_HOST) {
//     return {
//       host: process.env.REDIS_HOST,
//       port: parseInt(process.env.REDIS_PORT || '6379'),
//       password: process.env.REDIS_PASSWORD,
//     }
//   }

//   // In production, use SST Resource
//   try {
//     const redis = Resource.AuxxAiRedis
//     return {
//       host: redis.host,
//       port: redis.port,
//       password: redis.password,
//       // Add TLS for production Redis
//       tls: { checkServerIdentity: () => undefined },
//     }
//   } catch (error) {
//     // Fallback for build time or when resources aren't available
//     console.warn('Redis resource not available, using fallback config')
//     return {
//       host: 'localhost',
//       port: 6379,
//       password: undefined,
//     }
//   }
// }

/**
 * Get all secrets from SST Resources
 * Returns an object with all secret values
 */
export const getSecrets = () => {
  const secrets: Record<string, string | undefined> = {}

  // Try to access each secret through Resource API
  try {
    // Authentication & Security
    // secrets.BETTER_AUTH_SECRET = Resource.BETTER_AUTH_SECRET?.value
    // secrets.API_KEY_SALT = Resource.API_KEY_SALT?.value
    // // OAuth - GitHub
    // secrets.AUTH_GITHUB_ID = Resource.AUTH_GITHUB_ID?.value
    // secrets.AUTH_GITHUB_SECRET = Resource.AUTH_GITHUB_SECRET?.value
    // // OAuth - Google
    // secrets.AUTH_GOOGLE_ID = Resource.AUTH_GOOGLE_ID?.value
    // secrets.AUTH_GOOGLE_SECRET = Resource.AUTH_GOOGLE_SECRET?.value
    // // AI Services
    // secrets.ANTHROPIC_API_KEY = Resource.ANTHROPIC_API_KEY?.value
    // secrets.OPENAI_API_KEY = Resource.OPENAI_API_KEY?.value
    // secrets.GROQ_API_KEY = Resource.GROQ_API_KEY?.value
    // // AWS Services
    // secrets.BEDROCK_ACCESS_KEY = Resource.BEDROCK_ACCESS_KEY?.value
    // secrets.BEDROCK_SECRET_KEY = Resource.BEDROCK_SECRET_KEY?.value
    // secrets.S3_ACCESS_KEY_ID = Resource.S3_ACCESS_KEY_ID?.value
    // secrets.S3_SECRET_ACCESS_KEY = Resource.S3_SECRET_ACCESS_KEY?.value
    // // Google Services
    // secrets.GOOGLE_API_KEY = Resource.GOOGLE_API_KEY?.value
    // secrets.GOOGLE_CLIENT_EMAIL = Resource.GOOGLE_CLIENT_EMAIL?.value
    // secrets.GOOGLE_CLIENT_ID = Resource.GOOGLE_CLIENT_ID?.value
    // secrets.GOOGLE_CLIENT_SECRET = Resource.GOOGLE_CLIENT_SECRET?.value
    // secrets.GOOGLE_PRIVATE_KEY = Resource.GOOGLE_PRIVATE_KEY?.value
    // secrets.GOOGLE_PROJECT_ID = Resource.GOOGLE_PROJECT_ID?.value
    // secrets.GOOGLE_PUBSUB_VERIFICATION_TOKEN = Resource.GOOGLE_PUBSUB_VERIFICATION_TOKEN?.value
    // // Social Media
    // secrets.FACEBOOK_APP_ID = Resource.FACEBOOK_APP_ID?.value
    // secrets.FACEBOOK_APP_SECRET = Resource.FACEBOOK_APP_SECRET?.value
    // secrets.FACEBOOK_WEBHOOK_VERIFY_TOKEN = Resource.FACEBOOK_WEBHOOK_VERIFY_TOKEN?.value
    // // Outlook/Microsoft
    // secrets.OUTLOOK_CLIENT_ID = Resource.OUTLOOK_CLIENT_ID?.value
    // secrets.OUTLOOK_CLIENT_SECRET = Resource.OUTLOOK_CLIENT_SECRET?.value
    // secrets.OUTLOOK_WEBHOOK_SECRET = Resource.OUTLOOK_WEBHOOK_SECRET?.value
    // // Dropbox
    // secrets.DROPBOX_CLIENT_ID = Resource.DROPBOX_CLIENT_ID?.value
    // secrets.DROPBOX_CLIENT_SECRET = Resource.DROPBOX_CLIENT_SECRET?.value
    // // Shopify
    // secrets.SHOPIFY_API_KEY = Resource.SHOPIFY_API_KEY?.value
    // secrets.SHOPIFY_API_SECRET = Resource.SHOPIFY_API_SECRET?.value
    // // Stripe
    // secrets.STRIPE_SECRET_KEY = Resource.STRIPE_SECRET_KEY?.value
    // secrets.STRIPE_WEBHOOK_SECRET = Resource.STRIPE_WEBHOOK_SECRET?.value
    // secrets.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = Resource.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.value
    // // Pusher
    // secrets.PUSHER_APP_ID = Resource.PUSHER_APP_ID?.value
    // secrets.PUSHER_KEY = Resource.PUSHER_KEY?.value
    // secrets.PUSHER_SECRET = Resource.PUSHER_SECRET?.value
    // secrets.NEXT_PUBLIC_PUSHER_KEY = Resource.NEXT_PUBLIC_PUSHER_KEY?.value
    // // PostHog
    // secrets.NEXT_PUBLIC_POSTHOG_KEY = Resource.NEXT_PUBLIC_POSTHOG_KEY?.value
    // // Mailgun
    // secrets.MAILGUN_API_KEY = Resource.MAILGUN_API_KEY?.value
    // secrets.MAILGUN_DOMAIN = Resource.MAILGUN_DOMAIN?.value
    // // Bull Dashboard
    // secrets.BULL_ADMIN_USER = Resource.BULL_ADMIN_USER?.value
    // secrets.BULL_ADMIN_PASS = Resource.BULL_ADMIN_PASS?.value
    // // Gravatar
    // secrets.GRAVATAR_API_KEY = Resource.GRAVATAR_API_KEY?.value
  } catch (error) {
    console.warn('Some secrets may not be available:', error)
  }

  // Also include environment variables as fallback
  Object.keys(secrets).forEach((key) => {
    if (!secrets[key] && process.env[key]) {
      secrets[key] = process.env[key]
    }
  })

  return secrets
}

/**
 * Get a specific secret value
 * @param key The secret key to retrieve
 * @returns The secret value or undefined
 */
export const getSecret = (key: string): string | undefined => {
  // Try SST Resource first
  try {
    const resource = (Resource as any)[key]
    if (resource?.value) {
      return resource.value
    }
  } catch (error) {
    // Silent fail, try env var
  }

  // Fallback to environment variable
  return process.env[key]
}
