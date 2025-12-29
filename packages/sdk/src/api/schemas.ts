// packages/sdk/src/api/schemas.ts

import { z } from 'zod'

/** OAuth token response from better-auth */
export const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
})

/** User information response from /api/auth/session */
export const whoamiSchema = z.object({
  session: z.object({
    userId: z.string(),
    userEmail: z.string(),
    userName: z.string().nullable(),
    userFirstName: z.string().nullable().optional(),
    userLastName: z.string().nullable().optional(),
    userImage: z.string().nullable().optional(),
  }),
})

/** OIDC UserInfo response from /api/auth/oauth2/userinfo */
export const oidcUserInfoSchema = z.object({
  sub: z.string(), // Subject (user ID)
  email: z.string(),
  name: z.string().nullable().optional(),
  given_name: z.string().nullable().optional(),
  family_name: z.string().nullable().optional(),
  picture: z.string().nullable().optional(),
  email_verified: z.boolean().optional(),
})

/** Developer account information */
export const developerAccountSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  created_at: z.string(),
})

/** App data from API */
const appDataSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  developerAccountId: z.string(),
  avatarId: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
})

/** App information response (wrapped in new API format) */
export const appInfoSchema = z.object({
  success: z.literal(true),
  data: z.object({
    app: appDataSchema,
  }),
})

/** List of apps response (wrapped in new API format) */
export const listAppsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    apps: z.array(appDataSchema),
  }),
})

/** Bundle object in version creation response */
const bundleSchema = z.object({
  id: z.string(),
  clientBundleUploadUrl: z.string().url(),
  serverBundleUploadUrl: z.string().url(),
  // Optional for backward compatibility during rollout
  bundleSha: z.string().optional(),
})

/** Bundle upload completion request */
export const completeBundleRequestSchema = z.object({
  bundleSha: z.string(),
})

/** Bundle upload completion response */
export const completeBundleUploadSchema = z.object({
  success: z.boolean(),
})

/** App version information */
export const versionSchema = z.object({
  major: z.number(),
  minor: z.number(),
  created_at: z.string(),
  released_at: z.string().nullable().optional(),
  is_published: z.boolean(),
  num_installations: z.number(),
  publication_status: z.enum(['private', 'in-review', 'published', 'rejected', 'unpublished']),
})
/** List of versions */
export const versionsSchema = z.object({
  app_prod_versions: z.array(versionSchema),
})

export const organizationResponseSchema = z.object({
  id: z.string(),
  handle: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
})

export const listDevOrganizationsResponseSchema = z.object({
  organizations: z.array(organizationResponseSchema),
})
/** Production version creation response */
export const createVersionSchema = z.object({
  versionId: z.string(),
  appId: z.string(),
  major: z.number(),
  minor: z.number(),
  bundle: bundleSchema,
})

/** Development version creation response */
export const createDevVersionSchema = z.object({
  versionId: z.string(),
  appId: z.string(),
  major: z.number(),
  minor: z.number(),
  bundle: bundleSchema,
})

export const installationSchema = z.object({
  appId: z.string(),
  organizationId: z.string(),
})

export const TEST_ORGANIZATIONS = [
  organizationResponseSchema.parse({
    id: 'h6e1r4lvbxk737aw5448j6tb',
    handle: 'test-slug',
    name: 'Test Org',
    logoUrl: null,
  }),
]

export const TEST_APP_INFO = appInfoSchema.parse({
  success: true,
  data: {
    app: {
      id: 'y5yf1eh8lr1ifedutbypg0vf',
      slug: 'test-app',
      title: 'Test App',
      description: 'Test app for development',
      developerAccountId: 'test-dev-account-id',
      avatarId: null,
      avatarUrl: null,
      category: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  },
})

/**
 * Flattened log event from API
 */
export const flattenedLogEventSchema = z.object({
  id: z.string(),
  message: z.string(),
  severity: z.enum(['INFO', 'WARNING', 'ERROR', 'DEBUG']),
  timestamp: z.string(), // ISO 8601 string
  metadata: z.object({
    eventId: z.string(),
    eventType: z.string(),
    appVersionId: z.string().nullable(),
    userId: z.string().nullable(),
    requestMethod: z.string().nullable(),
    requestPath: z.string().nullable(),
    responseStatus: z.number().nullable(),
    durationMs: z.number().nullable(),
    consoleLogIndex: z.number(),
  }),
})

/**
 * Response for fetching app logs (flattened)
 */
export const fetchAppLogsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    logs: z.array(flattenedLogEventSchema),
    hasMore: z.boolean(),
    nextCursor: z.string().optional(),
    newestTimestamp: z.string().nullable(),
  }),
})

export type FlattenedLogEvent = z.infer<typeof flattenedLogEventSchema>
export type FetchAppLogsResponse = z.infer<typeof fetchAppLogsResponseSchema>
