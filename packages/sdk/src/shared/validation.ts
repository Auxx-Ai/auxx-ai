// packages/sdk/src/shared/validation.ts
import { z } from 'zod'

/**
 * Validation utilities for extension data.
 */

// === Surface Schema ===

/**
 * Schema for validating surface objects.
 */
export const surfaceSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().optional(),
    // Allow additional properties
  })
  .passthrough()

/**
 * Schema for validating surface maps (record of surface arrays).
 */
export const surfaceMapSchema = z.record(z.string(), z.array(surfaceSchema).optional())

export type ValidatedSurface = z.infer<typeof surfaceSchema>
export type ValidatedSurfaceMap = z.infer<typeof surfaceMapSchema>

// === Asset Schema ===

/**
 * Schema for validating asset objects.
 */
export const assetSchema = z.object({
  name: z.string().min(1),
  data: z.string().min(1), // base64 data URL
})

export type ValidatedAsset = z.infer<typeof assetSchema>

// === Render Tree Schema ===

/**
 * Schema for validating render instance objects (recursive).
 */
export const renderInstanceSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    tag: z.string(),
    attributes: z.record(z.any()),
    children: z.array(z.union([renderInstanceSchema, z.string()])).optional(),
  })
)

/**
 * Schema for validating render tree objects.
 */
export const renderTreeSchema = z.object({
  children: z.array(renderInstanceSchema),
})

export type ValidatedRenderTree = z.infer<typeof renderTreeSchema>

// === Environment Schema ===

/**
 * Schema for validating extension environment objects.
 */
export const environmentSchema = z.object({
  appId: z.string(),
  appInstallationId: z.string(),
  organizationId: z.string(),
  organizationHandle: z.string(),
  organizationName: z.string(),
  userId: z.string(),
  userName: z.string(),
  userEmail: z.string().email().nullish(),
  apiUrl: z.string().url(),
  platform: z.enum(['web-app', 'mobile-app']),
  isDevelopment: z.boolean(),
})

export type ValidatedEnvironment = z.infer<typeof environmentSchema>

// === Helper Functions ===

/**
 * Validate and parse data with a schema.
 * Throws on validation error.
 */
export function validateAndParse<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data)
}

/**
 * Safely validate data, returning error if invalid.
 */
export function safeValidate<T>(
  schema: z.ZodType<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error }
}

/**
 * Assert exhaustiveness in switch statements.
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${value}`)
}
