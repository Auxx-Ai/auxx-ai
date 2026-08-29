// apps/web/src/components/accounting/hooks/use-accounting-setup-draft.ts
'use client'

import type { SettingKey, SettingValue } from '@auxx/lib/settings/client'
import { useDirtyDraft } from '~/components/global/forms/use-dirty-draft'
import { useSettings } from '~/hooks/use-settings'

/**
 * A dirty draft over an EXPLICIT list of `GENERAL`-scope catalog keys, batch-saved in one call.
 *
 * 🛑 The explicit key list is the whole point, not a convenience.
 * `useSettings({ scope: 'GENERAL' })` hands back EVERY `GENERAL`-scope setting in the entire app,
 * so a save built from "the whole settings object" would write back dozens of unrelated keys.
 * Every `accounting.*` and `manufacturing.*` key is `GENERAL` (there is no `ACCOUNTING` value in
 * the `SettingScope` enum), so the accounting wizard is in exactly the situation
 * `scheduling-settings-page.tsx`'s warning was written for.
 *
 * Reads cost nothing: `useSettings` rides the org cache hydrated by the provider, so every key is
 * in hand on load at zero queries. That is also why there is no `setupReadiness` endpoint - see
 * `packages/lib/src/postings/setup-readiness.ts`.
 */
export function useAccountingSetupDraft(keys: readonly string[]) {
  const { getSetting, batchUpdateOrganizationSettings, isBatchUpdatingOrgSettings } = useSettings({
    scope: 'GENERAL',
  })

  // Rebuilt each render; `useDirtyDraft` compares by value, so a fresh object identity never
  // triggers a reseed.
  const server: Record<string, SettingValue> = {}
  for (const key of keys) server[key] = getSetting(key as SettingKey)

  const { draft, patch, dirty, save, discard } = useDirtyDraft(server, {
    isSaving: isBatchUpdatingOrgSettings,
    onSave: (next) => {
      const changed = keys
        .filter((key) => next[key] !== server[key])
        .map((key) => ({ key, value: next[key] ?? null }))
      if (changed.length > 0) batchUpdateOrganizationSettings(changed)
    },
  })

  /** Controlled-mode props for a `SettingsFieldRow` fed by this draft. */
  const controlled = (key: string) => ({
    value: draft[key],
    // NUMBER/SELECT inputs report a clear as `undefined`, not `null` - normalize, since
    // `SettingValue` and the server normalizer only accept `null` for "unset".
    onChange: (value: unknown) =>
      patch({ [key]: (value === undefined ? null : value) as SettingValue }),
  })

  return {
    /** The working copy, keyed by catalog key. Safe to hand to the `setup-readiness` helpers. */
    draft,
    patch,
    dirty,
    save,
    discard,
    controlled,
    /** Every `GENERAL` setting as stored, for predicates that read beyond this draft's keys. */
    getSetting,
    isSaving: isBatchUpdatingOrgSettings,
  }
}
