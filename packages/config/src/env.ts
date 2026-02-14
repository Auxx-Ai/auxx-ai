// packages/config/src/env.ts
import { createEnv } from '@t3-oss/env-nextjs'
import * as dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { z } from 'zod'
import { createEnvProxy } from './env-proxy'

/** Resolves the module filename and dirname in both ESM and CJS runtimes. */
const resolveModulePaths = () => {
  if (typeof import.meta !== 'undefined' && typeof import.meta.url === 'string') {
    const filename = fileURLToPath(import.meta.url)
    return { filename, dirname: path.dirname(filename) }
  }

  if (typeof __filename !== 'undefined' && typeof __dirname !== 'undefined') {
    return { filename: __filename, dirname: __dirname }
  }

  const fallbackFilename = path.join(process.cwd(), 'packages/config/src/env.ts')
  return { filename: fallbackFilename, dirname: path.dirname(fallbackFilename) }
}

/** Holds the resolved dirname so path resolution stays stable across runtimes. */
const { dirname: moduleDirname } = resolveModulePaths()

// Load .env file - try multiple locations to handle different working directories
// const possibleEnvPaths = [
//   path.resolve(process.cwd(), '.env'), // From app root (e.g., when running from apps/web)
//   path.resolve(process.cwd(), '../../.env'), // From package (original path)
//   path.resolve(moduleDirname, '../../../.env'), // Relative to this file
// ]

// for (const envPath of possibleEnvPaths) {
//   const result = dotenv.config({ path: envPath })
//   if (!result.error) {
//     // console.log(`📋 Loaded environment from: ${envPath}`)
//     break
//   }
// }

const baseEnv = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    BETTER_AUTH_SECRET: z.string().optional(),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // API Server Configuration
    PORT: z.coerce.number().default(3007),
    ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3006'),
    SDK_CLIENT_SECRET: z.string().optional(),

    // Workers
    WORKERS_HOST: z.string().optional(),
    WORKERS_PORT: z.coerce.number().optional(),

    // NEXT-AUTH PROVIDERS
    AUTH_GITHUB_ID: z.string().optional(),
    AUTH_GITHUB_SECRET: z.string().optional(),
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),

    SUPER_ADMIN_EMAIL: z.string().optional(),

    // DATABASE
    DATABASE_URL: z.string().optional(),

    // REDIS
    CACHE_PROVIDER: z.string().optional(), // 'upstash', 'aws', or 'hosted' (auto-detects if invalid/unset)
    REDIS_HOST: z.string().optional(),
    REDIS_PORT: z.coerce.number().optional(),
    REDIS_PASSWORD: z.string().optional(),

    KV_URL: z.string().optional(),
    KV_REST_API_URL: z.string().optional(),
    KV_REST_API_TOKEN: z.string().optional(),

    ELASTICACHE_URL: z.string().optional(),
    ELASTICACHE_TLS: z.string().optional(),

    // STRIPE
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    TRIAL_PLAN_NAME: z.string().optional(),
    TRIAL_DAYS: z.string().optional(),

    // SHOPIFY NEW
    SHOPIFY_API_KEY: z.string().optional(),
    SHOPIFY_API_SECRET: z.string().optional(),

    // AUXX.AI API KEYS
    API_KEY_SALT: z.string().optional(),

    // EMAIL PROVIDERS
    EMAIL_PROVIDER: z.enum(['mailgun', 'ses', 'smtp', 'sendmail']).default('mailgun'),

    // MAILGUN
    MAILGUN_API_KEY: z.string().optional(),
    MAILGUN_DOMAIN: z.string().optional(),
    MAILGUN_REGION: z.string().optional(),

    // AWS SES (uses AWS_REGION and SYSTEM_FROM_EMAIL)
    AWS_SES_ACCESS_KEY_ID: z.string().optional(),
    AWS_SES_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),

    // COMMON EMAIL SETTINGS
    SYSTEM_FROM_EMAIL: z.string().optional(),
    SYSTEM_FROM_NAME: z.string().optional(),
    SUPPORT_EMAIL: z.string().optional(),
    SUPPORT_NAME: z.string().optional(),
    EMAIL_REPLY_TO: z.string().optional(),

    // SMTP (generic)
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().optional(),
    SMTP_SECURE: z.coerce.boolean().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),

    BULL_ADMIN_USER: z.string().optional(),
    BULL_ADMIN_PASS: z.string().optional(),

    // AWS
    AWS_REGION: z.string().optional(), // Default AWS region for all services

    // AWS S3 - Dual Bucket Configuration
    FILE_STORAGE_TYPE: z.string().optional(), // 'local' or 's3'
    LOCAL_STORAGE_PUBLIC_PATH: z.string().optional(),
    S3_PUBLIC_BUCKET: z.string().optional(), // Public bucket for avatars, logos, thumbnails
    S3_PRIVATE_BUCKET: z.string().optional(), // Private bucket for attachments
    S3_REGION: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    // Legacy (deprecated)
    S3_BUCKET: z.string().optional(),

    // AI PROVIDERS
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().optional(), // Default model for anthropic, e.g. 'claude-2'
    BEDROCK_ACCESS_KEY: z.string().optional(),
    BEDROCK_SECRET_KEY: z.string().optional(),
    GROQ_API_KEY: z.string().optional(),
    USE_BACKUP_MODEL: z.string().optional(),

    // GOOGLE WORKSPACE (SUPPORT TICKET)
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_PROJECT_ID: z.string().optional(),
    GOOGLE_PUBSUB_TOPIC: z.string().optional(),
    // GOOGLE_PUBSUB_TOPIC_NAME: z.string().optional(),
    GOOGLE_PUBSUB_SUBSCRIPTION: z.string().optional(),
    GOOGLE_PUBSUB_VERIFICATION_TOKEN: z.string().optional(),
    GOOGLE_CLIENT_EMAIL: z.string().optional(),
    GOOGLE_PRIVATE_KEY: z.string().optional(),
    // OUTLOOK
    OUTLOOK_CLIENT_ID: z.string().optional(),
    OUTLOOK_CLIENT_SECRET: z.string().optional(),
    OUTLOOK_WEBHOOK_SECRET: z.string().optional(),

    DROPBOX_CLIENT_ID: z.string().optional(),
    DROPBOX_CLIENT_SECRET: z.string().optional(),

    // FACEBOOK
    FACEBOOK_APP_ID: z.string().optional(),
    FACEBOOK_APP_SECRET: z.string().optional(),
    FACEBOOK_GRAPH_API_VERSION: z.string().optional(),
    FACEBOOK_WEBHOOK_VERIFY_TOKEN: z.string().optional(),

    // PUSH NOTIFICATION
    PUSHER_APP_ID: z.string().optional(),
    PUSHER_KEY: z.string().optional(),
    PUSHER_SECRET: z.string().optional(),
    PUSHER_CLUSTER: z.string().optional(),
    VERCEL_URL: z.string().optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_BASE_URL: z.string().optional(),
    NEXT_PUBLIC_APP_URL: z.string().optional(),
    NEXT_PUBLIC_HOMEPAGE_URL: z.string().optional(),

    NEXT_PUBLIC_PUSHER_KEY: z.string().optional(),
    NEXT_PUBLIC_PUSHER_CLUSTER: z.string().optional(),

    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
    // AWS FILES - Dual Bucket Configuration
    NEXT_PUBLIC_STORAGE_TYPE: z.string().optional(), // 'local' or 's3'
    NEXT_PUBLIC_S3_PUBLIC_BUCKET: z.string().optional(), // Public bucket for avatars, logos, thumbnails
    NEXT_PUBLIC_S3_PRIVATE_BUCKET: z.string().optional(), // Private bucket for attachments
    NEXT_PUBLIC_CDN_URL: z.string().optional(), // CDN URL for public assets
    NEXT_PUBLIC_S3_REGION: z.string().optional(),
    // Legacy (deprecated)
    NEXT_PUBLIC_S3_BUCKET: z.string().optional(),

    // POSTHOG
    NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
    NEXT_PUBLIC_POSTHOG_HOST: z.string().optional(),

    // NEXT_PUBLIC_CLIENTVAR: z.string(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    VERCEL_URL: process.env.VERCEL_URL,
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_HOMEPAGE_URL: process.env.NEXT_PUBLIC_HOMEPAGE_URL,

    // API Server
    PORT: process.env.PORT,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    SDK_CLIENT_SECRET: process.env.SDK_CLIENT_SECRET,

    // REDIS:
    CACHE_PROVIDER: process.env.CACHE_PROVIDER,
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,

    KV_URL: process.env.KV_URL,
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,

    ELASTICACHE_URL: process.env.ELASTICACHE_URL,
    ELASTICACHE_TLS: process.env.ELASTICACHE_TLS,

    // WORKERS
    WORKERS_HOST: process.env.WORKERS_HOST,
    WORKERS_PORT: process.env.WORKERS_PORT,
    BULL_ADMIN_USER: process.env.BULL_ADMIN_USER,
    BULL_ADMIN_PASS: process.env.BULL_ADMIN_PASS,

    // STRIPE
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    TRIAL_PLAN_NAME: process.env.TRIAL_PLAN_NAME,
    TRIAL_DAYS: process.env.TRIAL_DAYS,
    SUPER_ADMIN_EMAIL: process.env.SUPER_ADMIN_EMAIL,

    AUTH_GITHUB_ID: process.env.AUTH_GITHUB_ID,
    AUTH_GITHUB_SECRET: process.env.AUTH_GITHUB_SECRET,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,

    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_PROJECT_ID: process.env.GOOGLE_PROJECT_ID,
    GOOGLE_PUBSUB_TOPIC: process.env.GOOGLE_PUBSUB_TOPIC,
    GOOGLE_PUBSUB_SUBSCRIPTION: process.env.GOOGLE_PUBSUB_SUBSCRIPTION,
    // GOOGLE_PUBSUB_TOPIC_NAME: process.env.GOOGLE_PUBSUB_TOPIC_NAME,
    GOOGLE_PUBSUB_VERIFICATION_TOKEN: process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN,
    GOOGLE_CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL,
    GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY,

    // SHOPIFY NEW
    SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY,
    SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET,

    API_KEY_SALT: process.env.API_KEY_SALT,

    // MAIL
    MAILGUN_API_KEY: process.env.MAILGUN_API_KEY,
    MAILGUN_DOMAIN: process.env.MAILGUN_DOMAIN,
    MAILGUN_REGION: process.env.MAILGUN_REGION,
    SYSTEM_FROM_EMAIL: process.env.SYSTEM_FROM_EMAIL,
    SYSTEM_FROM_NAME: process.env.SYSTEM_FROM_NAME,
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL,
    SUPPORT_NAME: process.env.SUPPORT_NAME,
    EMAIL_REPLY_TO: process.env.EMAIL_REPLY_TO,

    // Email provider configuration
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    AWS_SES_ACCESS_KEY_ID: process.env.AWS_SES_ACCESS_KEY_ID,
    AWS_SES_SECRET_ACCESS_KEY: process.env.AWS_SES_SECRET_ACCESS_KEY,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,

    // SMTP
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_SECURE: process.env.SMTP_SECURE,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,

    // OUTLOOK
    OUTLOOK_CLIENT_ID: process.env.OUTLOOK_CLIENT_ID,
    OUTLOOK_CLIENT_SECRET: process.env.OUTLOOK_CLIENT_SECRET,
    OUTLOOK_WEBHOOK_SECRET: process.env.OUTLOOK_WEBHOOK_SECRET,

    // DROPBOX
    DROPBOX_CLIENT_ID: process.env.DROPBOX_CLIENT_ID,
    DROPBOX_CLIENT_SECRET: process.env.DROPBOX_CLIENT_SECRET,

    // FACEBOOK
    FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID,
    FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET,
    FACEBOOK_GRAPH_API_VERSION: process.env.FACEBOOK_GRAPH_API_VERSION,
    FACEBOOK_WEBHOOK_VERIFY_TOKEN: process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN,

    // AWS
    AWS_REGION: process.env.AWS_REGION,

    // AWS S3 - Dual Bucket Configuration
    LOCAL_STORAGE_PUBLIC_PATH: process.env.LOCAL_STORAGE_PUBLIC_PATH,
    FILE_STORAGE_TYPE: process.env.FILE_STORAGE_TYPE,
    S3_PUBLIC_BUCKET: process.env.S3_PUBLIC_BUCKET,
    S3_PRIVATE_BUCKET: process.env.S3_PRIVATE_BUCKET,
    S3_REGION: process.env.S3_REGION,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    NEXT_PUBLIC_STORAGE_TYPE: process.env.NEXT_PUBLIC_STORAGE_TYPE,
    NEXT_PUBLIC_S3_PUBLIC_BUCKET: process.env.NEXT_PUBLIC_S3_PUBLIC_BUCKET,
    NEXT_PUBLIC_S3_PRIVATE_BUCKET: process.env.NEXT_PUBLIC_S3_PRIVATE_BUCKET,
    NEXT_PUBLIC_CDN_URL: process.env.NEXT_PUBLIC_CDN_URL,
    NEXT_PUBLIC_S3_REGION: process.env.NEXT_PUBLIC_S3_REGION,
    // Legacy (deprecated)
    S3_BUCKET: process.env.S3_BUCKET,
    NEXT_PUBLIC_S3_BUCKET: process.env.NEXT_PUBLIC_S3_BUCKET,
    // AI MODELS
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL, // Default model for OpenAI, e.g. 'gpt-4'
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,

    BEDROCK_ACCESS_KEY: process.env.BEDROCK_ACCESS_KEY,
    BEDROCK_SECRET_KEY: process.env.BEDROCK_SECRET_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    USE_BACKUP_MODEL: process.env.USE_BACKUP_MODEL,

    // PUSH NOTIFICATION
    PUSHER_APP_ID: process.env.PUSHER_APP_ID,
    PUSHER_KEY: process.env.PUSHER_KEY,
    PUSHER_SECRET: process.env.PUSHER_SECRET,
    PUSHER_CLUSTER: process.env.PUSHER_CLUSTER,

    NEXT_PUBLIC_PUSHER_KEY: process.env.NEXT_PUBLIC_PUSHER_KEY,
    NEXT_PUBLIC_PUSHER_CLUSTER: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,

    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,

    // POSTHOG
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  // In Lambda/SST, skip strict validation to avoid conflicts with Resource-based values
  skipValidation: process.env.SST === '1',
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
})

// Export a proxied env that preserves types and lazily resolves SST Resources
export const env = createEnvProxy(baseEnv) as typeof baseEnv
