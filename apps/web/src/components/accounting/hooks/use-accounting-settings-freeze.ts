// apps/web/src/components/accounting/hooks/use-accounting-settings-freeze.ts
'use client'

import { api } from '~/trpc/react'

/**
 * Why a frozen field is frozen, in the words the settings catalog uses.
 *
 * ⚠️ Changing the opening baseline or the book timezone after a posting exists
 * rewrites the arithmetic behind a journal entry that has already been booked.
 * A later mistake is corrected through the reversal / re-entry path, never by
 * editing setup history.
 */
export const FREEZE_REASON =
  'Locked because an entry has already posted. Changing this would rewrite the arithmetic ' +
  'behind a posted journal entry. Correct a mistake by reversing and re-entering, never by ' +
  'editing setup history.'

export interface AccountingSettingsFreeze {
  /** True once anything has posted. */
  frozen: boolean
  /** How many posted entries the sweep looked at. `0 of 0` is not the same answer as `0 of 412`. */
  postingsChecked: number
  isLoading: boolean
}

/**
 * Whether the opening baseline and book timezone are frozen.
 *
 * 🛑 Read off a REAL query rather than a settings flag. `ledger.verifyBalance`
 * already sweeps every posted entry and returns `postingsChecked`, so "has this
 * organization posted anything" is a fact the server hands over rather than a
 * second stored bit that could disagree with the ledger. It is gated on
 * `ledger.view`, which every accounting settings page already requires.
 *
 * Fails OPEN on error (nothing frozen) on purpose: a failed sweep must not lock
 * an organization out of its own setup during onboarding, when the count is
 * zero anyway. The server refuses a baseline edit after the first claim
 * regardless of what this returns.
 */
export function useAccountingSettingsFreeze(): AccountingSettingsFreeze {
  const query = api.ledger.verifyBalance.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  })

  const postingsChecked = query.data?.postingsChecked ?? 0

  return {
    frozen: postingsChecked > 0,
    postingsChecked,
    isLoading: query.isPending,
  }
}
