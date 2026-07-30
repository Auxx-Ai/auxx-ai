// packages/lib/src/resource-access/client.ts

/**
 * Client-side exports for resource access.
 * Types and utilities that can be used in React components.
 */

// Constants — the ONE permission ordinal + comparator (plan v3/03 P3a §3)
export { PERMISSION_RANK, satisfiesPermission } from '@auxx/types/permissions'
// Types
export type {
  AccessCheckResult,
  InstanceAccess,
  ResourceAccessInfo,
} from './types'
