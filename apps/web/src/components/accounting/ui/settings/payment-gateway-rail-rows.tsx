// apps/web/src/components/accounting/ui/settings/payment-gateway-rail-rows.tsx
'use client'

import type { GlAccountSubtypeValue, GlAccountTypeValue } from '@auxx/lib/accounting/ledger/client'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { useMemo } from 'react'
import { api } from '~/trpc/react'
import { sourceAccountLabel } from '../source-account-label'
import type { MappingAccountValue } from './mapping-account-select'
import { MappingScopeRow, type MappingScopeRowProps } from './mapping-scope-row'

/** The three rail roles, in the order the editor and the add dialog render them. */
export const RAIL_ROLES = [
  {
    role: 'clearing',
    label: 'Clearing',
    filterType: 'asset' as GlAccountTypeValue,
    subtypePin: 'clearing' as GlAccountSubtypeValue,
  },
  {
    role: 'payment_processing_fees',
    label: 'Fees',
    filterType: 'expense' as GlAccountTypeValue,
    subtypePin: undefined,
  },
  {
    role: 'bank',
    label: 'Bank',
    filterType: 'asset' as GlAccountTypeValue,
    subtypePin: 'bank' as GlAccountSubtypeValue,
  },
] as const

export type RailRole = (typeof RAIL_ROLES)[number]['role']

export function accountText(account: { code: string | null; name: string }): string {
  return account.code ? `${account.code} · ${account.name}` : account.name
}

interface RailAccountRowsProps {
  values: Record<RailRole, MappingAccountValue>
  onChange: (role: RailRole, value: string | 'inherit') => void
  /** What Inherit names per role; null drops Inherit (the bank role has no default). */
  inheritedNames: Record<RailRole, string | null>
  /** A draft's "Create `<label>`" option per role. */
  mintLabels?: Partial<Record<RailRole, string>>
  /** Per-role extras the stored editor adds: suggested chip, currency rows, mismatch line. */
  rowProps?: (role: RailRole) => Partial<MappingScopeRowProps>
  disabled?: boolean
}

/** Clearing, Fees and Bank as `MappingScopeRow`s; the caller decides whether a pick saves or drafts. */
export function RailAccountRows({
  values,
  onChange,
  inheritedNames,
  mintLabels,
  rowProps,
  disabled = false,
}: RailAccountRowsProps) {
  return (
    <div className='flex flex-col gap-0.5'>
      {RAIL_ROLES.map(({ role, label, filterType, subtypePin }) => (
        <MappingScopeRow
          key={role}
          depth={0}
          title={label}
          value={values[role]}
          onChange={(next) => onChange(role, next)}
          inheritedAccountName={inheritedNames[role]}
          filterTypes={[filterType]}
          subtypePin={subtypePin}
          mintLabel={mintLabels?.[role]}
          disabled={disabled}
          {...rowProps?.(role)}
        />
      ))}
    </div>
  )
}

/** The org's live processor feeds no rail has claimed yet, as a select of `processorAccountId`s. */
export function FeedSelect({
  value,
  onChange,
  enabled = true,
  disabled = false,
}: {
  value: string | null
  onChange: (sourceAccountId: string) => void
  /** Hold the read until the picker is actually shown. */
  enabled?: boolean
  disabled?: boolean
}) {
  const unlinked = api.paymentGateway.listUnlinkedFeeds.useQuery(undefined, { enabled })
  return (
    <Select value={value ?? undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger size='sm' className='w-full'>
        <SelectValue placeholder={unlinked.isPending ? 'Loading…' : 'Select a feed…'} />
      </SelectTrigger>
      <SelectContent>
        {(unlinked.data ?? []).length === 0 && !unlinked.isPending ? (
          <div className='p-2 text-muted-foreground text-xs'>
            No live feed is reporting activity with nothing claiming it yet.
          </div>
        ) : (
          (unlinked.data ?? []).map((feed) => (
            <SelectItem key={feed.processorAccountId} value={feed.processorAccountId}>
              {sourceAccountLabel({
                providerKey: feed.providerKey,
                externalAccountId: feed.externalAccountId,
                name: feed.name,
              })}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  )
}

/** The readiness sentence both the editor and the add dialog show, from `readiness`'s rule. */
export function railReadinessLine(state: {
  clearingMapped: boolean
  bankMapped: boolean
  feedLinked: boolean
}): { ready: boolean; text: string } {
  if (!state.clearingMapped) return { ready: false, text: 'Needs a clearing account.' }
  if (state.feedLinked && !state.bankMapped)
    return { ready: false, text: 'Needs a receiving bank account for its feed.' }
  return { ready: true, text: 'Ready to post.' }
}

/**
 * The handle picker's options: the handles seen on orders that no gateway routes yet, plus the
 * ones already chosen. A claimed handle is left out because the write would refuse it.
 */
export function useHandleOptions(current: readonly string[], enabled = true) {
  const observed = api.paymentGateway.observedHandles.useQuery(undefined, { enabled })
  return useMemo(() => {
    const unclaimed = (observed.data ?? []).filter((row) => !row.claimedBy).map((row) => row.handle)
    const seen = new Set<string>()
    const options: { label: string; value: string }[] = []
    for (const handle of [...current, ...unclaimed]) {
      const key = handle.trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      options.push({ label: handle, value: handle })
    }
    return options
  }, [observed.data, current])
}
