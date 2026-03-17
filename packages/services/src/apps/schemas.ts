// packages/services/src/apps/schemas.ts

import { z } from 'zod'

/**
 * Available app schema (for API responses)
 */
export const availableAppSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),

  // Avatar
  avatarId: z.string().nullable(),
  avatarUrl: z.string().nullable(),

  // Marketplace listing
  category: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  documentationUrl: z.string().nullable(),
  contactUrl: z.string().nullable(),
  supportSiteUrl: z.string().nullable(),
  termsOfServiceUrl: z.string().nullable(),

  // Content
  overview: z.string().nullable(),
  contentOverview: z.string().nullable(),
  contentHowItWorks: z.string().nullable(),
  contentConfigure: z.string().nullable(),

  // Permissions
  scopes: z.array(z.string()),

  // OAuth
  hasOauth: z.boolean(),
  oauthExternalEntrypointUrl: z.string().nullable(),

  // Verified
  verified: z.boolean(),

  // Publication status flags
  isDevelopment: z.boolean(),
  // isPublished: z.boolean(),

  // Installation status
  isInstalled: z.boolean(),
  installationType: z.enum(['development', 'production']).optional(),
  installedDeploymentId: z.string().optional(),

  // Deployment info
  latestDeployment: z
    .object({
      id: z.string(),
      version: z.string().nullable(),
      status: z.string(),
    })
    .optional(),
})

// export type AvailableApp = z.infer<typeof availableAppSchema>

/**
 * Available apps response schema
 */
export const availableAppsResponseSchema = z.object({
  apps: z.array(availableAppSchema),
  total: z.number(),
})

export type AvailableAppsResponse = z.infer<typeof availableAppsResponseSchema>

/**
 * Install app input schema
 */
export const installAppInputSchema = z.object({
  appId: z.string().min(1),
  organizationId: z.string().min(1),
  installationType: z.enum(['development', 'production']).default('development'),
  deploymentId: z.string().optional(),
  installedById: z.string().min(1),
})

export type InstallAppInput = z.infer<typeof installAppInputSchema>

/**
 * App details schema
 */
export const appDetailsSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  avatarId: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  category: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  documentationUrl: z.string().nullable(),
  contactUrl: z.string().nullable(),
  supportSiteUrl: z.string().nullable(),
  termsOfServiceUrl: z.string().nullable(),
  overview: z.string().nullable(),
  contentOverview: z.string().nullable(),
  contentHowItWorks: z.string().nullable(),
  contentConfigure: z.string().nullable(),
  scopes: z.array(z.string()),
  hasOauth: z.boolean(),
  oauthExternalEntrypointUrl: z.string().nullable(),
  isDevelopment: z.boolean(),
  isPublished: z.boolean(),
  verified: z.boolean(),
})

export type AppDetails = z.infer<typeof appDetailsSchema>

/**
 * Install app request schema (API layer)
 * Used by both apps/api and apps/web to validate install requests
 */
export const installAppRequestSchema = z.object({
  type: z.enum(['development', 'production']).optional(),
  deploymentId: z.string().optional(),
})

export type InstallAppRequest = z.infer<typeof installAppRequestSchema>

/**
 * List apps query parameters schema
 * Used to filter and paginate available apps
 */
export const listAppsQuerySchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
})

export type ListAppsQuery = z.infer<typeof listAppsQuerySchema>

/**
 * List deployments query parameters schema
 * Used to filter app deployments by type and status
 */
export const listDeploymentsQuerySchema = z.object({
  deploymentType: z.enum(['development', 'production']).optional(),
  status: z.string().optional(),
})

export type ListDeploymentsQuery = z.infer<typeof listDeploymentsQuerySchema>

/**
 * List installed apps query parameters schema
 */
export const listInstalledAppsQuerySchema = z.object({
  type: z.enum(['development', 'production']).optional(),
})

export type ListInstalledAppsQuery = z.infer<typeof listInstalledAppsQuerySchema>

/**
 * Uninstall app request schema
 */
export const uninstallAppRequestSchema = z.object({
  type: z.enum(['development', 'production']).optional(),
})

export type UninstallAppRequest = z.infer<typeof uninstallAppRequestSchema>

/**
 * Check slug input schema
 */
export const checkSlugInputSchema = z.object({
  slug: z.string().min(3),
})

export type CheckSlugInput = z.infer<typeof checkSlugInputSchema>

/**
 * Get developer app input schema
 */
export const getDeveloperAppInputSchema = z.object({
  slug: z.string(),
  userId: z.string(),
})

export type GetDeveloperAppInput = z.infer<typeof getDeveloperAppInputSchema>

/**
 * Create app input schema
 */
export const createAppInputSchema = z.object({
  developerAccountSlug: z.string(),
  userId: z.string(),
  id: z.string().optional(),
  slug: z.string().min(3),
  title: z.string().min(1),
  avatarId: z.string().optional(),
})

export type CreateAppInput = z.infer<typeof createAppInputSchema>

/**
 * Update app input schema
 */
export const updateAppInputSchema = z.object({
  appId: z.string(),
  userId: z.string(),
  data: z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    category: z
      .enum([
        'analytics',
        'autonomous',
        'billing',
        'calling',
        'customer-support',
        'communication',
        'forms-survey',
        'product-management',
      ])
      .optional(),
    overview: z.string().optional(),
    contentOverview: z.string().min(100).max(3000).optional(),
    contentHowItWorks: z.string().min(100).max(3000).optional(),
    contentConfigure: z.string().min(100).max(3000).optional(),
    websiteUrl: z.string().url().optional().or(z.literal('')),
    documentationUrl: z.string().url().optional().or(z.literal('')),
    contactUrl: z.string().optional().or(z.literal('')),
    supportSiteUrl: z.string().url().optional().or(z.literal('')),
    termsOfServiceUrl: z.string().url().optional().or(z.literal('')),
    hasOauth: z.boolean().optional(),
  }),
})

export type UpdateAppInput = z.infer<typeof updateAppInputSchema>
