// packages/lib/src/resource-access/client.ts

/**
 * Client-side exports for resource access.
 * Types and utilities that can be used in React components.
 */

// Constants — the ONE permission ordinal + comparator (plan v3/03 P3a §3)
export { PERMISSION_RANK, satisfiesPermission } from '@auxx/types/permissions'
/*
 * Member "Shared" tab vocabulary (plan 46 §3).
 *
 * `classify.ts` is pure and imports nothing server-only, which is what lets it be
 * mirrored here: the def→group map, its copy, and the owner/share rule are the
 * only things the tab needs from lib. Everything else on that tab arrives over
 * tRPC. NO `'use client'` directive in this file — server code imports it too.
 */
export {
  groupKeyForDef,
  isOwnerRow,
  MEMBER_SHARE_GROUPS,
  type MemberShareGroupKey,
  type MemberShareGroupMeta,
  SELF_GRANTING_DEFS,
} from './member-shares/classify'
export type {
  RevokeMemberSharesResult,
  RevokeMemberSharesScope,
} from './member-shares/mutations'
export type {
  MailRefusal,
  MemberShareItem,
  MemberSharePage,
  MemberShareSummary,
} from './member-shares/queries'
// Types
export type {
  AccessCheckResult,
  InstanceAccess,
  ResourceAccessInfo,
} from './types'
