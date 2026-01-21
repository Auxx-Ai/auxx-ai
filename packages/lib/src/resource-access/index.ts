// packages/lib/src/resource-access/index.ts

// Types
export type {
  ResourceAccessContext,
  GrantInstanceAccessInput,
  GrantTypeAccessInput,
  RevokeInstanceAccessInput,
  RevokeTypeAccessInput,
  CheckAccessInput,
  CheckTypeAccessInput,
  AccessCheckResult,
  ResourceAccessInfo,
  InstanceAccess,
} from './types'

// Constants
export { PERMISSION_HIERARCHY, satisfiesPermission } from './constants'

// Service functions
export {
  grantInstanceAccess,
  grantTypeAccess,
  revokeInstanceAccess,
  revokeTypeAccess,
  setInstanceAccess,
  setTypeAccess,
  checkAccess,
  checkTypeAccess,
  hasPermission,
  getInstanceAccess,
  getTypeAccess,
  getUserAccessibleInstances,
} from './resource-access-service'
