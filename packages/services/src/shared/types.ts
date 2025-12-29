// packages/services/src/shared/types.ts

/**
 * Common TypeScript types used across services
 */

/**
 * Installation type for apps
 */
export type InstallationType = 'development' | 'production'

/**
 * Version type for app versions
 */
export type VersionType = 'dev' | 'prod'

/**
 * Version status
 */
export type VersionStatus = 'draft' | 'active' | 'deprecated'

/**
 * Bundle status
 */
export type BundleStatus = 'pending' | 'uploading' | 'complete' | 'failed'

/**
 * Organization type
 */
export type OrganizationType = 'personal' | 'team' | 'enterprise'

/**
 * Organization member role
 */
export type OrganizationRole = 'owner' | 'admin' | 'member'

/**
 * Pagination parameters
 */
export interface PaginationParams {
  limit?: number
  offset?: number
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}
