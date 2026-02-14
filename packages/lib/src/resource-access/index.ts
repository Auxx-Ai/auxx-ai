// packages/lib/src/resource-access/index.ts

// Constants
export { PERMISSION_HIERARCHY, satisfiesPermission } from './constants'
// Service functions
export {
  checkAccess,
  checkTypeAccess,
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
  GrantTypeAccessInput,
  InstanceAccess,
  ResourceAccessContext,
  ResourceAccessInfo,
  RevokeInstanceAccessInput,
  RevokeTypeAccessInput,
} from './types'
