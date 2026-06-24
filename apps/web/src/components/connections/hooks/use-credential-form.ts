// apps/web/src/components/connections/hooks/use-credential-form.ts
'use client'

import { HIDDEN_VALUE } from '@auxx/credentials/crypto/client'
import type { ConnectionVariable } from '@auxx/database'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  seedValue,
  validateConnectionVariables,
} from '~/components/connections/ui/connection-variable-validation'

interface UseCredentialFormArgs {
  /** Dialog open state — seeding only runs while open. */
  open: boolean
  /**
   * The fields to render/seed/validate, already filtered to the currently-visible set (the AI
   * provider-vs-model scoping stays in the AI wrapper, so the shared hook never sees it).
   */
  variables: ConnectionVariable[]
  /**
   * Masked stored values for an edit — secrets as the `HIDDEN_VALUE` sentinel, plain vars real
   * (from `connections.getForEdit` / `aiIntegration.getCredentials`). Undefined for a fresh create.
   */
  existingValues?: Record<string, string>
  /** True while an edit's stored values are still loading; seeding waits so it never flashes blank. */
  loading?: boolean
  /** Extra plain values to seed under `existingValues` (reconnect prefill). */
  prefill?: Record<string, string>
}

interface UseCredentialFormResult {
  /** Current field values (every visible variable, seeded then user-edited). */
  values: Record<string, string>
  /** Set a single field value. */
  setValue: (key: string, value: string) => void
  /** Replace the whole values bag (rarely needed; prefer `setValue`). */
  setValues: React.Dispatch<React.SetStateAction<Record<string, string>>>
  /** Field → message map (empty = valid). */
  errors: Record<string, string>
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>
  /** Keys that arrived already set (seeded as the sentinel) — drive the masked Replace/Cancel UI. */
  savedSecrets: Set<string>
  /**
   * Validate the visible fields with the shared rich ruleset, store the result, and return it.
   * Pass `{ requireToken, token }` for a bare-secret method's token row.
   */
  validate: (extra?: { requireToken?: boolean; token?: string }) => Record<string, string>
}

/**
 * Headless credential-form lifecycle shared by every credential edit surface (connections panel,
 * AI page). Owns the field `values`/`errors` state, seeds it on open (declared defaults + reconnect
 * prefill + masked stored values, waiting for the edit load), derives the set-secret `savedSecrets`,
 * and validates with the one shared validator. Surface-specific chrome (a bare-secret token row, a
 * connection name, the AI custom-model id/type) stays in the wrapping dialog.
 */
export function useCredentialForm({
  open,
  variables,
  existingValues,
  loading = false,
  prefill,
}: UseCredentialFormArgs): UseCredentialFormResult {
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const setValue = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }, [])

  // Seed when the dialog opens (and, for an edit, once the masked values have loaded so we don't
  // flash blank then clobber keystrokes). Stored values win over the caller's prefill; declared
  // defaults fill anything neither supplies, and secrets seed as the sentinel so an untouched key
  // round-trips intact.
  useEffect(() => {
    if (!open || loading) return
    const merged = { ...prefill, ...existingValues }
    const seeded: Record<string, string> = {}
    for (const v of variables) seeded[v.key] = seedValue(v, merged)
    setValues(seeded)
    setErrors({})
  }, [open, loading, variables, existingValues, prefill])

  // Secret keys that arrived already set (seeded as the sentinel) can be reverted to "keep existing".
  const savedSecrets = useMemo(() => {
    const keys = Object.entries(existingValues ?? {})
      .filter(([, v]) => v === HIDDEN_VALUE)
      .map(([k]) => k)
    return new Set(keys)
  }, [existingValues])

  const validate = useCallback(
    (extra?: { requireToken?: boolean; token?: string }) => {
      const next = validateConnectionVariables({ variables, values, ...extra })
      setErrors(next)
      return next
    },
    [variables, values]
  )

  return { values, setValue, setValues, errors, setErrors, savedSecrets, validate }
}
