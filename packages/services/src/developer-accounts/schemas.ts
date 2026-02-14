// packages/services/src/developer-accounts/schemas.ts

import { z } from 'zod'

/**
 * Check if developer account slug exists
 */
export const checkSlugInputSchema = z.object({
  slug: z.string().min(3),
})

export type CheckSlugInput = z.infer<typeof checkSlugInputSchema>

/**
 * List developer accounts for a user
 */
export const listDeveloperAccountsInputSchema = z.object({
  userId: z.string(),
})

export type ListDeveloperAccountsInput = z.infer<typeof listDeveloperAccountsInputSchema>

/**
 * Create developer account
 */
export const createDeveloperAccountInputSchema = z.object({
  userId: z.string(),
  userEmail: z.string(),
  slug: z.string().min(3),
  title: z.string().min(1),
  logoId: z.string().optional(),
})

export type CreateDeveloperAccountInput = z.infer<typeof createDeveloperAccountInputSchema>

/**
 * Get developer account by slug
 */
export const getDeveloperAccountInputSchema = z.object({
  slug: z.string(),
  userId: z.string(),
})

export type GetDeveloperAccountInput = z.infer<typeof getDeveloperAccountInputSchema>

/**
 * Update developer account (for tRPC - without userId)
 */
export const updateDeveloperAccountInputSchema = z.object({
  developerAccountId: z.string(),
  data: z.object({
    title: z.string().min(1).optional(),
    logoId: z.string().optional(),
    logoUrl: z.string().optional(),
  }),
})

export type UpdateDeveloperAccountInput = z.infer<typeof updateDeveloperAccountInputSchema>

/**
 * Update developer account service input (includes userId)
 */
export const updateDeveloperAccountServiceInputSchema = updateDeveloperAccountInputSchema.merge(
  z.object({
    userId: z.string(),
  })
)

export type UpdateDeveloperAccountServiceInput = z.infer<
  typeof updateDeveloperAccountServiceInputSchema
>

/**
 * Get developer account first app
 */
export const getDeveloperAccountFirstAppInputSchema = z.object({
  slug: z.string(),
  userId: z.string(),
})

export type GetDeveloperAccountFirstAppInput = z.infer<
  typeof getDeveloperAccountFirstAppInputSchema
>
