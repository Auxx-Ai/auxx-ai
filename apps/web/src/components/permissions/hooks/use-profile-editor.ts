// apps/web/src/components/permissions/hooks/use-profile-editor.ts
'use client'

import type { Area, Level } from '@auxx/lib/permissions/client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '~/trpc/react'
import { usePermissionGrants } from './use-permission-grants'
import type { PermissionProfile } from './use-profiles'
import { useProfiles } from './use-profiles'

/** The editable half of a profile, held locally until the one atomic save. */
export interface ProfileDraft {
  name: string
  description: string
  icon: { iconId: string; color: string } | null
  /** Blanket rung for areas `levels` does not set; `null` = fall through to `ROLE_DEFAULTS`. */
  baseLevel: Level | null
  /** The profile's per-area BASE — sparse; an absent area falls through. */
  levels: Partial<Record<Area, Level>>
}

/** Stable comparison key for dirty tracking (object key order is normalized). */
function draftKey(draft: ProfileDraft): string {
  const sortedLevels = Object.entries(draft.levels)
    .filter(([, level]) => level !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify({
    name: draft.name.trim(),
    description: draft.description.trim(),
    icon: draft.icon,
    baseLevel: draft.baseLevel,
    levels: sortedLevels,
  })
}

/**
 * Draft state + the ONE transactional save for a single permission profile
 * (doc 19 §6.1.4 / §7).
 *
 * Everything the editor touches — name, description, icon, `baseLevel`, and the
 * per-area base `levels` — is held locally and submitted in a **single**
 * `permissions.saveProfile` mutation. That is a correctness requirement, not a
 * preference: the server's escalation guard compares each affected holder's
 * effective state *before* and *after* inside one transaction, which a save split
 * across several requests cannot express.
 *
 * A profile is identity + base access; there is no authored cap (plan 20 §2.a.1).
 *
 * Three reads hydrate one draft: the list row supplies identity, `getProfile`
 * supplies the profile's own metadata and the agent policy, and its area levels
 * come from its `PermissionGrant` row via `usePermissionGrants().profileGrants`. The
 * org's **`member`** profile is the exception: while the Member-baseline bridge is
 * in place its grant row is presented as `role:org_member`
 * (`permissions-member-baseline.ts`), so its levels arrive in `baseline` instead
 * — TODO(plan-19-step-7): drop that fallback with the bridge.
 *
 * Hydration is keyed on the profile id plus the load state and only re-runs when
 * one of those changes, so a background refetch can never silently overwrite an
 * in-flight edit; `reset()` re-hydrates on demand.
 */
export function useProfileEditor(profile: PermissionProfile) {
  const { saveProfile, isSaving } = useProfiles()
  const { isLoading: grantsLoading, roleDefaults, baseline, profileGrants } = usePermissionGrants()
  const detailQuery = api.permissions.getProfile.useQuery(
    { profileId: profile.id },
    { staleTime: 30_000 }
  )
  const detail = detailQuery.data
  const isLoading = grantsLoading || detailQuery.isLoading

  /** The profile's persisted area levels (see the `member` bridge note above). */
  const persistedLevels = useMemo<Partial<Record<Area, Level>>>(() => {
    const own = profileGrants.find((g) => g.granteeId === profile.id)?.levels
    if (own) return own
    return profile.slug === 'member' ? baseline : {}
  }, [profileGrants, profile.id, profile.slug, baseline])

  const buildDraft = useCallback(
    (): ProfileDraft => ({
      name: detail?.name ?? profile.name,
      description: detail?.description ?? profile.description ?? '',
      icon: detail?.icon ?? profile.icon,
      baseLevel: detail?.baseLevel ?? profile.baseLevel,
      levels: { ...persistedLevels },
    }),
    [profile, detail, persistedLevels]
  )

  const [draft, setDraft] = useState<ProfileDraft>(buildDraft)
  const [savedKey, setSavedKey] = useState<string>(() => draftKey(buildDraft()))
  /** Which profile (and grant-load state) the current draft was hydrated from. */
  const hydratedFor = useRef<string>(`${profile.id}:${isLoading}`)

  useEffect(() => {
    const key = `${profile.id}:${isLoading}`
    if (hydratedFor.current === key) return
    hydratedFor.current = key
    const next = buildDraft()
    setDraft(next)
    setSavedKey(draftKey(next))
  }, [profile.id, isLoading, buildDraft])

  const isDirty = draftKey(draft) !== savedKey

  const patch = useCallback((values: Partial<ProfileDraft>) => {
    setDraft((prev) => ({ ...prev, ...values }))
  }, [])

  /** Set (or clear, with `undefined`) one area's explicit base level. */
  const setAreaLevel = useCallback((area: Area, level: Level | undefined) => {
    setDraft((prev) => {
      const levels = { ...prev.levels }
      // `undefined` DELETES the key — the area falls through to `baseLevel` /
      // `ROLE_DEFAULTS`. An explicit `Level.None` is `0` and must never be
      // conflated with absent: it is the only way a profile says "no access".
      if (level === undefined) delete levels[area]
      else levels[area] = level
      return { ...prev, levels }
    })
  }, [])

  const reset = useCallback(() => {
    const next = buildDraft()
    setDraft(next)
    setSavedKey(draftKey(next))
  }, [buildDraft])

  const save = useCallback(async () => {
    const key = draftKey(draft)
    const ok = await saveProfile({
      profileId: profile.id,
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      icon: draft.icon,
      baseLevel: draft.baseLevel,
      levels: draft.levels,
    })
    if (ok) setSavedKey(key)
    return ok
  }, [draft, profile.id, saveProfile])

  return {
    draft,
    patch,
    setAreaLevel,
    reset,
    save,
    isDirty,
    isSaving,
    isLoading,
    roleDefaults,
    /**
     * The agent exact policy, passed straight through to the agent-policy editor.
     * It is NOT part of this draft: agent policy has SET semantics and its own
     * save path, and it must never be folded into the additive human maps above.
     */
    agentPolicy: detail?.agentPolicy ?? null,
  }
}
