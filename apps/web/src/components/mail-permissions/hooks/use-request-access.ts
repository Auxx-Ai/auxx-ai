// apps/web/src/components/mail-permissions/hooks/use-request-access.ts
'use client'

import { ACCESS_REFUSAL_COPY, type AccessRefusalReason } from '@auxx/lib/approval-requests/client'
import { toastError } from '@auxx/ui/components/toast'
import { toInboxAccessRecordId, useInbox, useThread } from '~/components/threads/hooks'
import { useUser } from '~/hooks/use-user'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'

/**
 * Refusals worth SAYING to the requester, rather than silently hiding the
 * trigger (plan 42 §5.3).
 *
 * `worker_seat` and `front_door_closed` are the two that name a lever — and the
 * seat one names a lever nobody can pull, which is exactly why it must be said
 * instead of rendering a dead button. `deny_cooldown` is included because "nothing
 * happened when I clicked" is a worse answer than "you asked recently".
 *
 * `already_full` and `target_unavailable` are deliberately absent: the client
 * eligibility check has already hidden the trigger in both cases, and explaining
 * why a control the user cannot see is missing is noise.
 */
const SPOKEN_REFUSALS: AccessRefusalReason[] = ['worker_seat', 'front_door_closed', 'deny_cooldown']

export interface UseRequestAccessResult {
  /**
   * Whether this member administers sharing on the thread — org admin/owner, or a
   * Manager of its inbox.
   *
   * **This is the hook's home for that expression, not a copy of it** (plan 42
   * §6.1). It used to be inline in `thread-share-popover.tsx`, where it was half of
   * the requester condition and unavailable to the redaction banner. A sub-`full`
   * admin can grant themselves access directly and must never enter an approval
   * flow, so both mounts and the share popover read the one implementation.
   */
  canShare: boolean
  /** The viewer's composed lens on the thread, as the thread payload reports it. */
  myLens: 'metadata' | 'identity' | 'read'
  /** Render the trigger at all: sub-`full` and unable to just grant it themselves. */
  eligible: boolean
  /** Server-authoritative `false` — the ask would be refused. Presentation only. */
  refusalCopy: string | null
  /** An existing pending request of theirs, which swaps the trigger for a status view. */
  pending: { id: string; createdAt: Date } | null
  /** Who will decide it, named — "sent into the void" vs "Sarah will see this". */
  approvers: Array<{ userId: string; name: string | null; image: string | null }>
  /** Whether {@link approvers} are inbox Managers or the org-admin fallback. */
  approversAre: 'managers' | 'admins' | null
  /** Server-composed header label; degrades safely at `metadata` lens. */
  subjectLabel: string | null
  isLoading: boolean
  send: (message?: string) => void
  withdraw: () => void
  isSending: boolean
  isWithdrawing: boolean
}

/**
 * Everything the "request access to this conversation" affordance needs
 * (plan 42 §6.3), so no call site re-derives eligibility or authority.
 *
 * The client checks are **presentation only**. `requestAccess` repeats every one of
 * them server-side — current lens, mail front door, org-scoped target, deny
 * cooldown, pending state — which is where a direct API caller meets them too. The
 * entry condition here is deliberately NOT plan 28 §4.6's generic
 * `deniedBy() === 'permission'`: mail redaction is a lens, not a denied permission
 * key, so the mail fork is `myLens !== 'read' && !canShare`.
 *
 * The preflight query is gated on that pair, so a full-lens member or a Manager
 * pays nothing for this hook.
 */
export function useRequestAccess({
  threadId,
  enabled = true,
}: {
  threadId: string
  enabled?: boolean
}): UseRequestAccessResult {
  const utils = api.useUtils()
  const { thread } = useThread({ threadId })
  const { inbox } = useInbox(thread?.inboxId)
  const { isAdminOrOwner } = useUser()
  const { canAdminInstance } = useAccess()

  // Inbox Managers administer sharing without being org admins (delegation).
  const canShare = isAdminOrOwner || (!!inbox && canAdminInstance(toInboxAccessRecordId(inbox)))
  const myLens = thread?.myLens ?? 'read'
  const clientEligible = !!thread && myLens !== 'read' && !canShare

  const { data: preflight, isLoading } = api.approval.accessRequestPreflight.useQuery(
    { threadId },
    { enabled: enabled && clientEligible, refetchOnWindowFocus: false }
  )

  const invalidate = () => utils.approval.accessRequestPreflight.invalidate({ threadId })

  const requestAccess = api.approval.requestAccess.useMutation({
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
    canShare,
    myLens,
    // Until the preflight answers, the client pair is the best available guess —
    // and it is the conservative one, since the server can only narrow it.
    eligible: clientEligible && (preflight ? preflight.eligible || !!pendingRow : true),
    refusalCopy:
      refusalReason && SPOKEN_REFUSALS.includes(refusalReason)
        ? ACCESS_REFUSAL_COPY[refusalReason]
        : null,
    pending: pendingRow ? { id: pendingRow.id, createdAt: new Date(pendingRow.createdAt) } : null,
    approvers: preflight?.approvers ?? [],
    approversAre: preflight?.approversAre ?? null,
    subjectLabel: preflight?.subjectLabel ?? null,
    isLoading,
    send: (message?: string) => requestAccess.mutate({ threadId, message: message || undefined }),
    withdraw: () => {
      if (!pendingRow) return
      withdrawRequest.mutate({ id: pendingRow.id })
    },
    isSending: requestAccess.isPending,
    isWithdrawing: withdrawRequest.isPending,
  }
}
