// apps/web/src/components/global/notifications/hooks/use-approvals-count.test.tsx
//
// The Approvals badge is ONE hook, read by both the sidebar bell and the panel's
// tab badge, so the two cannot drift. Duplicates are its fifth term (plan §3.2).
//
// What is worth pinning is not the arithmetic but the two ways a new term goes
// wrong: it is added to one consumer and not the shared hook (covered by there
// being only one hook), or it is counted for orgs that cannot see the section it
// belongs to — which would show a bell badge pointing at a tab with nothing in
// it, and a query the router refuses.

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  duplicatesEnabled: true,
  suggestionsEnabled: true,
  /** Whether the duplicates count query was ENABLED. */
  duplicatesQueried: false,
  duplicatesError: null as unknown,
}))

vi.mock('~/providers/feature-flag-provider', () => ({
  useFeatureFlags: () => ({
    hasAccess: (key: string) =>
      key === 'duplicateDetection' ? h.duplicatesEnabled : h.suggestionsEnabled,
  }),
}))

vi.mock('~/components/mail-suggestions/hooks/use-mail-suggestions', () => ({
  useMailSuggestionsCount: () => ({ count: 2, isError: false }),
}))

vi.mock('~/trpc/react', () => ({
  api: {
    approval: {
      getPendingCount: { useQuery: () => ({ data: 3, error: null }) },
    },
    approvals: {
      count: { useQuery: () => ({ data: { count: 5 }, error: null }) },
    },
    duplicates: {
      count: {
        useQuery: (_input: unknown, opts: { enabled: boolean }) => {
          h.duplicatesQueried = opts.enabled
          return {
            data: opts.enabled ? { count: 7 } : undefined,
            error: h.duplicatesError,
          }
        },
      },
    },
  },
}))

import { useApprovalsCount } from './use-approvals-count'

beforeEach(() => {
  h.duplicatesEnabled = true
  h.suggestionsEnabled = true
  h.duplicatesQueried = false
  h.duplicatesError = null
})

describe('useApprovalsCount', () => {
  it('sums all five sources', () => {
    const { result } = renderHook(() => useApprovalsCount())
    // confirmations 3 + suggestion bundles 5 + mail suggestions 2 + duplicates 7
    expect(result.current.count).toBe(17)
  })

  it('drops the duplicates term — and its query — when the org lacks the feature', () => {
    h.duplicatesEnabled = false
    const { result } = renderHook(() => useApprovalsCount())

    expect(result.current.count).toBe(10)
    expect(h.duplicatesQueried).toBe(false)
  })

  it('surfaces a duplicates failure rather than reading as "all caught up"', () => {
    h.duplicatesError = new Error('boom')
    const { result } = renderHook(() => useApprovalsCount())
    expect(result.current.isError).toBe(true)
  })

  it('ignores a duplicates failure the org could never have queried', () => {
    h.duplicatesEnabled = false
    h.duplicatesError = new Error('stale')
    const { result } = renderHook(() => useApprovalsCount())
    expect(result.current.isError).toBe(false)
  })
})
