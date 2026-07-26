// apps/web/src/components/members/hooks/use-assign-profile.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { api } from '~/trpc/react'

/** What one assignment writes: `OrganizationMember.permissionProfileId`. */
export interface AssignProfileInput {
  /** The member's `userId` — the id every other `member.*` mutation takes. */
  memberId: string
  /** The profile to bind, or `null` to fall back to the system template (§1.3). */
  profileId: string | null
}

/**
 * The minimal shape this surface needs from the assignment procedure.
 *
 * TODO(plan-19-step-8): **`member.assignProfile` does not exist yet.** Step 8's
 * member surfaces are built in parallel with the router work, and the router
 * belongs to another owner, so the procedure is addressed here by path rather
 * than added. Until it lands, an assignment round-trips and fails with tRPC's
 * `NOT_FOUND` — surfaced through `toastError`, never silently swallowed.
 *
 * The contract this expects, per §6: `permissions.manage` PLUS a
 * `canManageTarget` rank check, cross-org verification that the profile belongs
 * to `ctx.session.organizationId`, a refusal when `profile.seat !==
 * member.seatType` (§0.21 — assignment is never a billing event, so it must not
 * fall through to a cap check either), the §6.1 escalation guard over the
 * holder's resulting effective state, and NO seat write.
 */
interface AssignProfileMutationLike {
  useMutation: (opts?: {
    onSuccess?: () => void
    onError?: (error: { message: string }) => void
  }) => {
    mutateAsync: (input: AssignProfileInput) => Promise<unknown>
    isPending: boolean
  }
}

/**
 * Bind a permission profile to a member.
 *
 * Assignment changes the base a member composes up from — it never touches
 * `seatType`. Seat changes are a separate, cap-checked action
 * (`member.updateSeatType`, members-list row menu only), and the seat clamp
 * remains the only cap in the human model (plan 20).
 */
export function useAssignProfile(onAssigned?: () => void) {
  const utils = api.useUtils()
  const router = api.member as unknown as { assignProfile: AssignProfileMutationLike }

  const assignProfile = router.assignProfile.useMutation({
    onSuccess: () => {
      // The binding feeds `computeUserCapabilities`, so the member's own
      // capability blob and the members list both go stale.
      void utils.member.all.invalidate()
      void utils.permissions.myCapabilities.invalidate()
      onAssigned?.()
    },
    onError: (error) => toastError({ title: 'Error applying profile', description: error.message }),
  })

  const assign = useCallback(
    (input: AssignProfileInput) => assignProfile.mutateAsync(input),
    [assignProfile]
  )

  return { assign, isPending: assignProfile.isPending }
}
