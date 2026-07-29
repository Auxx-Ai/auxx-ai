// packages/lib/src/resource-access/index.ts

// Constants
export { PERMISSION_HIERARCHY, satisfiesPermission } from './constants'
// Grantee resolution (doc 19 §8.2 — the ONE grantee union)
export {
  type GranteeMatcher,
  grantedViaFor,
  granteeMatchers,
  ORG_MEMBER_GRANTEE_ID,
  type ResourceAccessGrantees,
  resolveProfileHolders,
  resolveProfileIdByUser,
  resolveResourceAccessGrantees,
  resolveUserProfileId,
  resourceAccessGranteeConditions,
} from './grantee-resolution'
// Mail sharing guards (mail-permissions §7)
export {
  assertCanManageMailSharing,
  assertCanManageMailTypeAccess,
  assertMailSharingFeature,
  inboxAccessRecordId,
  isMailSharingDef,
} from './mail-sharing-guard'
// Service functions
export {
  checkAccess,
  checkTypeAccess,
  emitResourceAccessInstanceChanged,
  getAllInstanceAccess,
  getAllTypeAccess,
  getInstanceAccess,
  getTypeAccess,
  getUserAccessibleInstances,
  grantInstanceAccess,
  grantTypeAccess,
  hasPermission,
  revokeInstanceAccess,
  revokeTypeAccess,
  setInstanceAccess,
  setTypeAccess,
} from './resource-access-service'
// Types
export type {
  AccessCheckResult,
  CheckAccessInput,
  CheckTypeAccessInput,
  GrantedVia,
  GrantInstanceAccessInput,
  GrantLens,
  GrantTypeAccessInput,
  InstanceAccess,
  ResourceAccessContext,
  ResourceAccessInfo,
  RevokeInstanceAccessInput,
  RevokeTypeAccessInput,
} from './types'
