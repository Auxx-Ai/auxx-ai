// apps/web/src/components/agents/hooks/use-agent-permission-profiles.ts
'use client'

import type { AgentPermissionPolicy } from '@auxx/database'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'

/** Which system profile a draft with no explicit binding resolves to (§1.3). */
const FALLBACK_SLUG_BY_KIND: Record<string, string> = {
  internal: 'agent',
  chat: 'chat_agent',
}

/**
 * One agent-bindable permission profile, as the picker needs it — identity only.
 * `permissions.listProfiles` deliberately omits the policy blobs; the resolved
 * policy comes from {@link useAgentProfilePolicy}.
 */
export type AgentProfileOption = RouterOutputs['permissions']['listProfiles'][number]

interface UseAgentPermissionProfilesResult {
  /** Profiles bindable to an agent (`appliesTo: 'agent' | 'any'`), in server order. */
  profiles: AgentProfileOption[]
  byId: Map<string, AgentProfileOption>
  isLoading: boolean
  /** The system profile an unbound draft of this kind falls back to (§1.3). */
  fallbackFor: (kind: string) => AgentProfileOption | null
}

/**
 * Every permission profile an agent draft may bind, off `permissions.listProfiles`.
 *
 * Filtered to `appliesTo: 'agent' | 'any'` — a `member` profile is not a legal
 * binding for an agent, and offering one would ship a picker whose selection the
 * server refuses. Human profiles carry no `agentPolicy` at all, so they could not
 * be resolved into a published snapshot either.
 */
export function useAgentPermissionProfiles(): UseAgentPermissionProfilesResult {
  const { data, isLoading } = api.permissions.listProfiles.useQuery(undefined, {
    staleTime: 60_000,
  })

  // `listProfiles` is already ordered (seeded ladder, then custom alphabetically),
  // so the picker never reshuffles between renders — keep that order.
  const profiles = useMemo<AgentProfileOption[]>(
    () => (data ?? []).filter((row) => row.appliesTo === 'agent' || row.appliesTo === 'any'),
    [data]
  )

  const byId = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles])

  const fallbackFor = useCallback(
    (kind: string) => {
      const slug = FALLBACK_SLUG_BY_KIND[kind] ?? FALLBACK_SLUG_BY_KIND.internal
      return profiles.find((p) => p.slug === slug) ?? null
    },
    [profiles]
  )

  return { profiles, byId, isLoading, fallbackFor }
}

/**
 * The exact four-level policy of one profile, off `permissions.getProfile`.
 *
 * Split from the list on purpose: `listProfiles` renders identity (the picker),
 * `getProfile` carries the policy blob. Fetching the policy only for the profile
 * actually bound keeps the picker cheap no matter how many profiles an org has.
 */
export function useAgentProfilePolicy(profileId: string | null): {
  policy: AgentPermissionPolicy | null
  isLoading: boolean
} {
  const { data, isLoading } = api.permissions.getProfile.useQuery(
    { profileId: profileId ?? '' },
    { enabled: profileId !== null, staleTime: 60_000 }
  )
  return { policy: data?.agentPolicy ?? null, isLoading: profileId !== null && isLoading }
}

interface UseAgentProfileBindingResult {
  /**
   * Persist a draft binding. Resolves `true` only when the write took effect.
   * `silent` suppresses the per-agent error toast so a bulk caller can report
   * one aggregate failure instead of N.
   */
  setProfile: (
    agentId: string,
    profileId: string,
    options?: { silent?: boolean }
  ) => Promise<boolean>
  isSaving: boolean
}

/**
 * Writes the **draft** binding `Agent.permissionProfileId` (§0.16). Draft only:
 * production keeps running the active version's immutable
 * `AgentVersion.permissionPolicy` snapshot until the agent is published — which
 * is why the write also marks the draft as having unpublished changes.
 */
export function useAgentProfileBinding(): UseAgentProfileBindingResult {
  const utils = api.useUtils()
  const updateAgent = api.agent.update.useMutation()

  const setProfile = useCallback(
    async (agentId: string, profileId: string, options?: { silent?: boolean }) => {
      try {
        await updateAgent.mutateAsync({ agentId, permissionProfileId: profileId })
        await Promise.all([utils.agent.getById.invalidate(), utils.agent.list.invalidate()])
        return true
      } catch (error) {
        if (!options?.silent) {
          toastError({
            title: 'Failed to set permission profile',
            description: error instanceof Error ? error.message : 'Unknown error occurred',
          })
        }
        return false
      }
    },
    [updateAgent, utils]
  )

  return { setProfile, isSaving: updateAgent.isPending }
}
