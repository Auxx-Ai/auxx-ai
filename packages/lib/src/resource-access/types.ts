// packages/lib/src/resource-access/types.ts

import type { ResourceGranteeType, Rung } from '@auxx/database/enums'
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

/*
 * `GrantLens` (`'metadata' | 'subject' | 'full'`) is DELETED (plan v3/03 §11).
 * It was a fourth hand-written copy of a ladder that now has exactly one
 * definition — `Rung` — and it existed only to type the second half of the
 * `(permission, lens)` encoding. Every former `{ permission, lens }` pair is now
 * one `rung: Rung`; mail's narrowing of that ladder is `Lens`
 * (`permissions/visibility/lens.ts`), which is where a "grantable mail tier"
 * type belongs if one is ever needed again.
 */

/**
 * Where a grant came from, when that changes what the grantee should be TOLD
 * (plan 28 §4.2, plan 42 §8).
 *
 * `'approval'` suppresses the generic `RESOURCE_SHARED` / `MESSAGE_SHARED`
 * notification, because the requester is about to get an `ACCESS_REQUEST_DECIDED`
 * one instead — "Sarah approved your request" beats "Sarah shared a conversation
 * with you" for a thing they asked for. Absent means `'direct'`.
 *
 * This is deliberately on the SHARED write funnel's input rather than an
 * access-lane-only side channel: `grantInstanceAccess` is what datasets,
 * dashboards, snippets, signatures, inboxes and groups all write through, and the
 * notification it fires is fire-and-forget inside it. There is no other seam.
 */
export type GrantOrigin = 'direct' | 'approval'

/** Input for granting access to a specific instance */
export interface GrantInstanceAccessInput {
  /** RecordId format: "entityDefinitionId:entityInstanceId" */
  recordId: RecordId
  granteeType: ResourceGranteeType
  granteeId: string
  /**
   * The rung to confer (plan v3/03 §3) — replaces the `(permission, lens)` pair.
   *
   * ⚠ `'none'` is a RESTRICTION marker, not a grant, and the `resourceAccess`
   * router refuses it for record defs (raise-only, D7). It reaches this input
   * only for the row-described resources that genuinely author restrictions.
   */
  rung: Rung
  /** See {@link GrantOrigin}. Optional; absent behaves exactly as before. */
  origin?: GrantOrigin
  /**
   * Hold the cache-invalidation / realtime emits back and hand them to the
   * caller instead of firing them inline (`docs/lib-module-guide.md` §8: bust
   * caches AFTER the transaction commits, never inside it).
   *
   * Only set this when the grant runs inside a `db.transaction()` — the
   * approval-decision handler is the motivating caller. Firing an emit
   * mid-transaction publishes `capabilities:changed` and drops the cached blob
   * while the write is still invisible to every other connection, so a reader
   * racing the commit repopulates the cache from PRE-grant state and the
   * requester is left staring at exactly the stale blob plan 42 §4.2 warns
   * about.
   *
   * The caller MUST invoke the returned `flushEmits()` after its transaction
   * commits. Absent (the default), emits fire inline as they always have and
   * `flushEmits` is a no-op.
   */
  deferEmits?: boolean
}

/**
 * What an instance-grant call hands back. `flushEmits` is a no-op unless
 * {@link GrantInstanceAccessInput.deferEmits} was set, so existing callers can
 * keep ignoring the return value.
 */
export interface GrantInstanceAccessResult {
  flushEmits: () => Promise<void>
}

/** Input for granting type-level access (all instances) */
export interface GrantTypeAccessInput {
  /** Entity definition identifier (e.g., 'inbox', 'snippet', or custom entity def ID) */
  entityDefinitionId: string
  granteeType: ResourceGranteeType
  granteeId: string
  /**
   * TYPE rows store a rung too — the column is one vocabulary for the whole
   * table. They are read back onto the DEF axis (`defAccess`,
   * `effectiveRecordLevel`) through `rungToPermission`, which is the single
   * boundary between the two vocabularies.
   */
  rung: Rung
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
  /** The highest rung the user resolved to across the matching rows. */
  rung: Rung | null
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
  rung: Rung
  createdAt: Date
}

/** Instance access with RecordId */
export interface InstanceAccess {
  recordId: RecordId
  rung: Rung
}
