// packages/lib/src/resource-access/index.ts

// Constants
export { PERMISSION_HIERARCHY, satisfiesPermission } from './constants'
// Mail sharing guards (mail-permissions §7)
export {
  assertCanManageMailSharing,
  assertCanManageMailTypeAccess,
  assertMailSharingFeature,
  isMailSharingDef,
} from './mail-sharing-guard'
// Service functions
export {
  checkAccess,
  checkTypeAccess,
  emitResourceAccessInstanceChanged,
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
  GrantInstanceAccessInput,
  GrantLens,
  GrantTypeAccessInput,
  InstanceAccess,
  ResourceAccessContext,
  ResourceAccessInfo,
  RevokeInstanceAccessInput,
  RevokeTypeAccessInput,
} from './types'
