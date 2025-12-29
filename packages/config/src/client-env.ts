import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'
import * as dotenv from 'dotenv'
import path from 'path'

import 'dotenv/config'
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') }) //CHANGED 2025-10-12

export const clientEnv = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */

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
    NEXT_PUBLIC_SUPPORT_DOMAIN: z.string().optional(),
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

    // ENV
    NEXT_PUBLIC_ENV: z.enum(['production', 'development', 'test']).default('development'),
    // NEXT_PUBLIC_CLIENTVAR: z.string(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
    NEXT_PUBLIC_HOMEPAGE_URL: process.env.NEXT_PUBLIC_HOMEPAGE_URL,
    NEXT_PUBLIC_SUPPORT_DOMAIN: process.env.NEXT_PUBLIC_SUPPORT_DOMAIN,
    NEXT_PUBLIC_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    // AWS S3 - Dual Bucket Configuration
    NEXT_PUBLIC_STORAGE_TYPE: process.env.NEXT_PUBLIC_STORAGE_TYPE,
    NEXT_PUBLIC_S3_PUBLIC_BUCKET: process.env.NEXT_PUBLIC_S3_PUBLIC_BUCKET,
    NEXT_PUBLIC_S3_PRIVATE_BUCKET: process.env.NEXT_PUBLIC_S3_PRIVATE_BUCKET,
    NEXT_PUBLIC_CDN_URL: process.env.NEXT_PUBLIC_CDN_URL,
    NEXT_PUBLIC_S3_REGION: process.env.NEXT_PUBLIC_S3_REGION,
    // Legacy (deprecated)
    NEXT_PUBLIC_S3_BUCKET: process.env.NEXT_PUBLIC_S3_BUCKET,

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
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
})
