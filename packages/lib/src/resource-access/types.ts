// packages/lib/src/resource-access/types.ts

import type { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import type { RecordId } from '@auxx/types/resource'

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT & INPUTS
// ─────────────────────────────────────────────────────────────────────────────

/** Context for resource access operations */
export interface ResourceAccessContext {
  db: any
  organizationId: string
  userId: string
}

/**
 * Visibility lens carried on a mail grant (mail-permissions §2.1). Meaningful
 * only for `permission='view'` rows on thread/contact/inbox — `edit`/`admin`
 * always evaluate as `full`. `null`/absent means legacy `full`.
 */
export type GrantLens = 'metadata' | 'subject' | 'full'

/** Input for granting access to a specific instance */
export interface GrantInstanceAccessInput {
  /** RecordId format: "entityDefinitionId:entityInstanceId" */
  recordId: RecordId
  granteeType: ResourceGranteeType
  granteeId: string
  permission: ResourcePermission
  lens?: GrantLens | null
}

/** Input for granting type-level access (all instances) */
export interface GrantTypeAccessInput {
  /** Entity definition identifier (e.g., 'inbox', 'snippet', or custom entity def ID) */
  entityDefinitionId: string
  granteeType: ResourceGranteeType
  granteeId: string
  permission: ResourcePermission
}

/** Input for revoking instance-level access */
export interface RevokeInstanceAccessInput {
  recordId: RecordId
  granteeType: ResourceGranteeType
  granteeId: string
}

/** Input for revoking type-level access */
export interface RevokeTypeAccessInput {
  entityDefinitionId: string
  granteeType: ResourceGranteeType
  granteeId: string
}

/** Input for checking access to a specific instance */
export interface CheckAccessInput {
  /** RecordId format: "entityDefinitionId:entityInstanceId" */
  recordId: RecordId
  userId: string
}

/** Input for checking type-level access */
export interface CheckTypeAccessInput {
  /** Just the entityDefinitionId (no instance) */
  entityDefinitionId: string
  userId: string
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How a `ResourceAccess` grant reached the user — one per grantee kind, plus
 * `'role'` for the `role:org_member` workspace baseline. `'profile'` was added
 * in doc 19 step 9; before that a profile grant mis-attributed as `'direct'`.
 */
export type GrantedVia = 'direct' | 'group' | 'team' | 'role' | 'profile'

/** Result of access check */
export interface AccessCheckResult {
  hasAccess: boolean
  permission: ResourcePermission | null
  /** How access was granted */
  grantedVia: GrantedVia | null
  /** Whether access is type-level (all instances) or instance-specific */
  accessLevel: 'type' | 'instance' | null
}

/** Resource access record */
export interface ResourceAccessInfo {
  id: string
  entityDefinitionId: string
  entityInstanceId: string | null
  granteeType: ResourceGranteeType
  granteeId: string
  permission: ResourcePermission
  lens: GrantLens | null
  createdAt: Date
}

/** Instance access with RecordId */
export interface InstanceAccess {
  recordId: RecordId
  permission: ResourcePermission
}
