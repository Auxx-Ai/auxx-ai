// packages/lib/src/resource-access/index.ts

// Constants — the ONE permission ordinal + comparator (plan v3/03 P3a §3)
export { PERMISSION_RANK, satisfiesPermission } from '@auxx/types/permissions'
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
// Instance grants — the ONE instance-level query + the ONE bucketing pass
// (plan v3/03 §11/§12, P4). Both composed blobs project from `BucketedInstanceGrants`.
export {
  type BucketedInstanceGrants,
  bucketInstanceGrantRows,
  type DefKeyedRungs,
  grantedDefIds,
  type InstanceGrantRow,
  isIndividualGranteeType,
  loadUserInstanceGrants,
  mergedRung,
} from './instance-grants'
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
  GrantedVia,
  GrantInstanceAccessInput,
  GrantTypeAccessInput,
  InstanceAccess,
  ResourceAccessContext,
  ResourceAccessInfo,
  RevokeInstanceAccessInput,
  RevokeTypeAccessInput,
} from './types'
