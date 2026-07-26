// apps/web/src/components/permissions/hooks/use-agent-policy-save.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { api } from '~/trpc/react'
import type { NormalizedAgentPolicy } from './use-agent-policy'

/**
 * Persist an agent policy through the ONE transactional profile save
 * (`permissions.saveProfile`, plan 19 §6.1.4).
 *
 * Deliberately a single mutation carrying the whole policy: the escalation guard
 * and the §2.4a author-authority comparison are evaluated over the *resulting*
 * state of every affected holder, which a save split across several requests
 * cannot express. There is no per-row endpoint to reach for, and adding one would
 * reopen exactly that hole.
 *
 * Errors surface via `toastError` only — no success toast (repo convention); the
 * editor's own "Unpublished changes" state is the acknowledgement.
 */
export function useAgentPolicySave({
  profileId,
  onSaved,
}: {
  profileId: string
  /** Fired after the write lands and the permissions cache is invalidated. */
  onSaved?: () => void
}) {
  const utils = api.useUtils()

  const saveProfile = api.permissions.saveProfile.useMutation({
    onError: (error) => {
      toastError({ title: 'Error saving permissions', description: error.message })
    },
    onSuccess: () => {
      // Broad on purpose: the profile list, the profile itself and every
      // capability read derived from it share this namespace.
      void utils.permissions.invalidate()
      onSaved?.()
    },
  })

  const savePolicy = useCallback(
    (policy: NormalizedAgentPolicy) => saveProfile.mutate({ profileId, agentPolicy: policy }),
    [saveProfile, profileId]
  )

  return { savePolicy, isSaving: saveProfile.isPending }
}
