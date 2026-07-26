// apps/web/src/components/permissions/hooks/use-profiles.ts
'use client'

import type { Area, Level } from '@auxx/lib/permissions/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'
import type { ProfileAppliesTo } from '../ui/profile-copy'

/**
 * One profile as the list hands it over: identity only (`id`, `slug`, `name`,
 * `description`, `icon`, `seat`, `appliesTo`, `isSystem`, `baseLevel`). The
 * policy payload — `agentPolicy` — is deliberately NOT here; the editor loads it
 * per profile through `permissions.getProfile`.
 */
export type PermissionProfile = RouterOutputs['permissions']['listProfiles'][number]

/** One profile WITH its policy payload — what the editor hydrates from. */
export type PermissionProfileDetail = RouterOutputs['permissions']['getProfile']

/** The single atomic save payload (§6.1.4) — never split across requests. */
export interface SaveProfileInput {
  profileId: string
  name?: string
  description?: string | null
  icon?: { iconId: string; color: string } | null
  baseLevel?: Level | null
  levels?: Partial<Record<Area, Level>> | null
}

/** What `createProfile` accepts — `seat`/`appliesTo`/`slug` land here and nowhere else. */
export interface CreateProfileInput {
  slug: string
  name: string
  description?: string | null
  icon?: { iconId: string; color: string } | null
  seat?: 'full' | 'worker'
  appliesTo?: ProfileAppliesTo
  baseLevel?: Level | null
}

/**
 * The org's permission profiles (doc 19 §7) plus the two write paths the Profiles
 * surface needs.
 *
 * `listProfiles` is a READ off the cached `profiles` projection — the same rows
 * `computeUserCapabilities` composes from — so it is deliberately not plan-gated:
 * a Free org still sees the system profiles supplying its `ROLE_DEFAULTS`, it
 * just cannot edit them (§0.26).
 *
 * **`saveProfile` is one transactional mutation carrying metadata and area levels
 * together** (§6.1.4). A save spanning several requests cannot enforce one atomic
 * "resulting effective state" check, so there is no metadata-only side door here
 * either — the editor collects a whole draft and submits it once. Both writes
 * invalidate `listProfiles` (the projection) and
 * `listGrants` (the profile's `PermissionGrant` row, which is where its area
 * levels live).
 */
export function useProfiles() {
  const utils = api.useUtils()
  const profilesQuery = api.permissions.listProfiles.useQuery(undefined, { staleTime: 30_000 })

  const resync = useCallback(async () => {
    await Promise.all([
      utils.permissions.listProfiles.invalidate(),
      utils.permissions.getProfile.invalidate(),
      utils.permissions.listGrants.invalidate(),
    ])
  }, [utils])

  const create = api.permissions.createProfile.useMutation()
  const save = api.permissions.saveProfile.useMutation()

  const profiles = useMemo<PermissionProfile[]>(
    () => profilesQuery.data ?? [],
    [profilesQuery.data]
  )

  /** Slugs already taken in this org — the create dialog de-duplicates against it. */
  const takenSlugs = useMemo(() => new Set(profiles.map((p) => p.slug)), [profiles])

  const createProfile = useCallback(
    async (input: CreateProfileInput): Promise<{ id: string } | null> => {
      try {
        const created = await create.mutateAsync(input)
        await resync()
        return { id: created.id }
      } catch (error) {
        toastError({
          title: 'Error creating profile',
          description: error instanceof Error ? error.message : 'Please try again.',
        })
        return null
      }
    },
    [create, resync]
  )

  const saveProfile = useCallback(
    async (input: SaveProfileInput): Promise<boolean> => {
      try {
        await save.mutateAsync({
          profileId: input.profileId,
          name: input.name,
          description: input.description,
          icon: input.icon,
          baseLevel: input.baseLevel,
          // Sparse by contract — the router's `z.record` input type isn't partial,
          // and `parseAreaLevels` server-side is the real gate.
          levels: input.levels as Record<Area, Level> | null | undefined,
        })
        await resync()
        return true
      } catch (error) {
        toastError({
          title: 'Error saving profile',
          description: error instanceof Error ? error.message : 'Please try again.',
        })
        return false
      }
    },
    [save, resync]
  )

  return {
    profiles,
    takenSlugs,
    isLoading: profilesQuery.isLoading,
    isCreating: create.isPending,
    isSaving: save.isPending,
    createProfile,
    saveProfile,
  }
}
