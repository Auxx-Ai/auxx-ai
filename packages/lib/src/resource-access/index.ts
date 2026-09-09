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
// Member "Shared" tab — what is addressed directly to one member (plan 46)
export {
  decodeShareCursor,
  encodeShareCursor,
  getMemberShareSummary,
  groupKeyForDef,
  isOwnerRow,
  listMemberShares,
  listMemberTypeGrants,
  MAX_REVOKE_RECORD_IDS,
  type MailRefusal,
  MEMBER_SHARE_GROUPS,
  MEMBER_SHARES_PAGE_SIZE,
  MEMBER_SHARES_SEARCH_SCAN_CAP,
  type MemberShareCtx,
  type MemberShareGroupKey,
  type MemberShareGroupMeta,
  type MemberShareItem,
  type MemberSharePage,
  type MemberShareSummary,
  memberGranteePredicate,
  type RevokeMemberSharesResult,
  type RevokeMemberSharesScope,
  resolveLabels,
  resolveMailRefusals,
  revokeMemberShares,
  SELF_GRANTING_DEFS,
  sharedRowPredicate,
} from './member-shares'
// Service functions
export {
  checkAccess,
  emitResourceAccessChanged,
  emitResourceAccessInstanceChanged,
  emitResourceAccessTypeChanged,
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
// Orphan sweep — the delete-path cleanup for a column with no FK
export {
  type SweepResourceAccessForInstancesParams,
  sweepResourceAccessForInstances,
} from './sweep-instances'
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
