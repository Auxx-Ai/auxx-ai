// apps/web/src/components/permissions/hooks/use-record-request-access.ts
'use client'

import type { Rung } from '@auxx/database/enums'
import {
  RECORD_ACCESS_REFUSAL_COPY,
  SPOKEN_RECORD_REFUSALS,
} from '@auxx/lib/approval-requests/client'
import { toastError } from '@auxx/ui/components/toast'
import { useRecordAccessFor } from '~/components/resources/hooks/use-record-access'
import { api } from '~/trpc/react'
import type { RequestAccessState } from './use-request-access'

/**
 * The record lane's request-access state (plan v3/04 §8.3), sibling of
 * `mail-permissions/hooks/use-request-access.ts`.
 *
 * Everything the shell renders comes from {@link RequestAccessState}; the two
 * extra fields here are record vocabulary the shell must not know — they decide
 * the trigger's wording, which is the only place the ladder shows through.
 */
export interface UseRecordRequestAccessResult extends RequestAccessState {
  /**
   * The viewer's row-effective rung as the CLIENT sees it — the `_access` stamp
   * folded with the def rung, or a forced `'none'` on a surface where the record
   * is not in the store at all (see `assumeNoAccess`).
   */
  currentRung: Rung
  /**
   * What an ask would be for, derived here for the LABEL only. The server
   * derives its own (§3.2) and there is deliberately no rung input on the
   * mutation, so a wrong guess here mis-words a button and cannot mis-grant.
   */
  requestedRung: Rung | null
}

/** `none → read`, `read → edit`. `edit`/`admin` have nothing left to ask for (D1). */
const NEXT_RUNG: Partial<Record<Rung, Rung>> = { none: 'read', read: 'edit' }

/**
 * Everything the "request access to this record" affordance needs, so no mount
 * re-derives eligibility (plan v3/04 §8.3).
 *
 * The client gate is **presentation only** and is deliberately just the rung
 * test:
 *
 * ```ts
 * const clientEligible = access === 'none' || access === 'read'
 * ```
 *
 * ⚠ There is no `canSelfGrant` term, and adding one would be a regression.
 * `_access` is `foldRecordAccess(defRung, grantRank)`, which has already folded
 * the def rung in — so `canEditEntity(def)` implies `>= edit` and a row-`admin`
 * holder is at `admin`, and the rung test alone excludes both. Writing the term
 * with the client's `canShare` would be actively WRONG: that value is
 * `satisfiesRung(access, 'admin')` and therefore STRICTER than the server's
 * `assertCanManageRecordSharing`, which has a def-edit fast path (§10.1/§10.3).
 *
 * 🔴 **The preflight is LAZY** (§8.5 / D6). It is gated on `open` — the
 * popover's own state — as well as on `clientEligible`. `read` is the common
 * rung for any member with def-level Read on a def they cannot edit, so an eager
 * query would fire on every drawer open and every detail-page load for that
 * entire population purely to decide a label. Until it answers, the client pair
 * is the guess, and it is the conservative one because the server can only
 * narrow it.
 */
export function useRecordRequestAccess({
  entityDefinitionId,
  entityInstanceId,
  open,
  assumeNoAccess = false,
}: {
  entityDefinitionId: string
  entityInstanceId: string
  /** The popover's open state. THE lazy gate — see the 🔴 note above. */
  open: boolean
  /**
   * Force the viewer's rung to `none` regardless of the store.
   *
   * For the full-page not-found mount, where the record is not in the store at
   * all: `useRecordAccessFor`'s unstamped fallback answers with the member's DEF
   * rung, which would report `read` (or better) for a record they demonstrably
   * cannot reach, mis-wording the ask as "Request edit access" (§8.3).
   */
  assumeNoAccess?: boolean
}): UseRecordRequestAccessResult {
  const utils = api.useUtils()
  const { access } = useRecordAccessFor(entityDefinitionId, entityInstanceId)

  const currentRung: Rung = assumeNoAccess ? 'none' : access
  const clientEligible = currentRung === 'none' || currentRung === 'read'
  const requestedRung = NEXT_RUNG[currentRung] ?? null

  const { data: preflight, isLoading } = api.approval.recordAccessRequestPreflight.useQuery(
    { entityDefinitionId, entityInstanceId },
    { enabled: clientEligible && open, refetchOnWindowFocus: false }
  )

  const invalidate = () =>
    utils.approval.recordAccessRequestPreflight.invalidate({
      entityDefinitionId,
      entityInstanceId,
    })

  const requestRecordAccess = api.approval.requestRecordAccess.useMutation({
    onError: (error) =>
      toastError({ title: 'Error requesting access', description: error.message }),
    onSettled: invalidate,
  })

  const withdrawRequest = api.approval.withdrawAccessRequest.useMutation({
    onError: (error) => toastError({ title: 'Error withdrawing', description: error.message }),
    onSettled: invalidate,
  })

  const refusalReason = preflight?.refusalReason ?? null
  const pendingRow = preflight?.pending ?? null

  return {
    currentRung,
    requestedRung,
    // A pending request is not a refusal: the trigger has to keep showing its
    // status, or the surface silently loses the only way to withdraw.
    eligible: clientEligible && (preflight ? preflight.eligible || !!pendingRow : true),
    refusalCopy:
      refusalReason && SPOKEN_RECORD_REFUSALS.includes(refusalReason)
        ? RECORD_ACCESS_REFUSAL_COPY[refusalReason]
        : null,
    pending: pendingRow ? { id: pendingRow.id, createdAt: new Date(pendingRow.createdAt) } : null,
    approvers: preflight?.approvers ?? [],
    // 🔴 Server-composed, never client-composed (§6/§9). The def noun ALONE for a
    // `none` requester — a display name read from a store here would turn the
    // not-found screen's existence oracle into a content leak.
    subjectLabel: preflight?.subjectLabel ?? null,
    isLoading,
    send: (message?: string) =>
      // No rung input, and there must never be one (§3.2).
      requestRecordAccess.mutate({
        entityDefinitionId,
        entityInstanceId,
        message: message || undefined,
      }),
    withdraw: () => {
      if (!pendingRow) return
      // Reused from the thread lane — `withdrawAccessRequest` scopes on
      // `requesterId === userId` and nothing else, so it is target-agnostic.
      withdrawRequest.mutate({ id: pendingRow.id })
    },
    isSending: requestRecordAccess.isPending,
    isWithdrawing: withdrawRequest.isPending,
  }
}
