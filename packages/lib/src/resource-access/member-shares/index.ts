// packages/lib/src/resource-access/member-shares/index.ts

/**
 * The member "Shared" tab's read and write model (plan 46).
 *
 * "What is addressed to this member" — direct `granteeType: 'user'` rows only.
 * What a member reaches through a group or their profile belongs to the Teams
 * section and the Permissions tab respectively, and is neither listed nor swept.
 */

export {
  groupKeyForDef,
  isOwnerRow,
  MEMBER_SHARE_GROUPS,
  type MemberShareGroupKey,
  type MemberShareGroupMeta,
  SELF_GRANTING_DEFS,
} from './classify'
export {
  MAX_REVOKE_RECORD_IDS,
  type RevokeMemberSharesResult,
  type RevokeMemberSharesScope,
  revokeMemberShares,
} from './mutations'
export {
  decodeShareCursor,
  encodeShareCursor,
  getMemberShareSummary,
  listMemberShares,
  listMemberTypeGrants,
  type MailRefusal,
  MEMBER_SHARES_PAGE_SIZE,
  MEMBER_SHARES_SEARCH_SCAN_CAP,
  type MemberShareCtx,
  type MemberShareItem,
  type MemberSharePage,
  type MemberShareSummary,
  memberGranteePredicate,
  resolveLabels,
  resolveMailRefusals,
  sharedRowPredicate,
} from './queries'
