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
 * Bind a permission profile to a member.
 *
 * Assignment changes the base a member composes up from — it never touches
 * `seatType`. Seat changes are a separate, cap-checked action
 * (`member.updateSeatType`, members-list row menu only), and the seat clamp
 * remains the only cap in the human model (plan 20).
 *
 * The server (`member.assignProfile` → `assignMemberProfile`, plan 21 §7) holds
 * the whole contract: `members.manage` PLUS `permissions.manage`, cross-org
 * verification of the profile, the Owner-profile refusal, a refusal when
 * `profile.seat !== member.seatType` (assignment is never a billing event, so it
 * must not fall through to a cap check either), the rank guards against the
 * profile's declared role, last-owner protection, the §6.1 escalation guard over
 * the holder's resulting effective state — and NO seat write.
 */
export function useAssignProfile(onAssigned?: () => void) {
  const utils = api.useUtils()

  const assignProfile = api.member.assignProfile.useMutation({
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
