// apps/web/src/components/accounting/ui/settings/mapping-list.tsx
'use client'

// The Mapping tab (task 59 §2): every posting role, grouped by statement type,
// with the control INLINE on the row (D2) - no detail pane. `role-map-list.tsx`
// and `role-map-editor.tsx` (the old master-detail shape) are both gone; this
// is the whole tab.
//
// Rows are `MappingScopeRow`/`MappingAccountSelect` (58/59, committed
// separately) - the same shared component the gateway editor's Accounts
// section renders, transposed (D1).
//
// 🛑 Save-on-change, not a staged batch (MK, scope change during 59's build:
// reverses D2/§2.4's save bar). Every picker change calls `ledger.saveMapping`
// immediately with a single-row batch - same procedure, same validation, one
// row instead of many. An optimistic value shows while the write is in
// flight; a refusal drops it so the control snaps back to what the server
// actually holds, with `toastError` naming why. Success invalidates
// `ledger.roleMap` so state (`suggested` -> `confirmed`, `n of m mapped`)
// reflects what landed rather than a local guess.

import {
  ACCOUNT_ROLE_LABELS,
  type AccountRole,
  type ChartAccountRow,
  type GlAccountSubtypeValue,
  type GlAccountTypeValue,
  ROLE_ACCOUNT_SUBTYPES,
  ROLE_ACCOUNT_TYPES,
  type RoleAssignmentRow,
  type RoleRailAssignmentRow,
  type RoleSourceRow,
} from '@auxx/lib/accounting/ledger/client'
import { AutosizeInput } from '@auxx/ui/components/autosize-input'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { InputSearch } from '@auxx/ui/components/input-search'
import { Label } from '@auxx/ui/components/label'
import { EmptySection } from '@auxx/ui/components/section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { Ban, CreditCard, Plus, RotateCcw, Sparkles, Store, Unlink, X } from 'lucide-react'
import Link from 'next/link'
import { useQueryState } from 'nuqs'
import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import { useAccountingProviderStatus } from '../../hooks/use-accounting-provider-status'
import { useChartAccounts } from '../gl-account-picker'
import {
  ACCOUNT_TYPE_OPTIONS,
  accountTypeIcon,
  formatAccount,
  formatAccountRow,
} from './accounts-types'
import type { MappingAccountValue } from './mapping-account-select'
import { MappingScopeRow } from './mapping-scope-row'

/** Mirrors `ROLES_WITHOUT_DEFAULT` (`postings/build-entry.ts`) - not client-exported. */
const BANK_ROLE = 'bank'

/** The picker's filter and the create dialog's preset, so a new per-store A/R carries its subtype. */
const SUBTYPE_PIN = ROLE_ACCOUNT_SUBTYPES

/** QuickBooks invoices and payments name no receivable account, so a per-store A/R is journal-only (91 §4.3). */
const STORE_RECEIVABLE_NOTE =
  'QuickBooks invoices and payments use its default A/R; this account reaches it through journals only'

/** One edit, in `ledger.saveMapping`'s own row shape - sent as a one-row batch on every change. */
interface MappingEdit {
  role: string
  scope: { store: string } | { rail: string } | null
  currency?: string | null
  value: string | 'inherit' | 'unused'
}

/**
 * The Link action's tooltip, naming the provider when one is connected (89 D9).
 *
 * A context read, not a query - `useAccountingProviderStatus` derives from
 * `useAppsContext`, so every row that renders a Link action can ask.
 */
function useLinkTooltip(): string {
  const { providerLabel } = useAccountingProviderStatus()
  return providerLabel
    ? `Link its ${providerLabel} account`
    : 'Link its account in the connected accounting system'
}

const defaultKey = (role: string) => role
const storeKey = (role: string, sourceId: string) => `${role}|store|${sourceId}`
const railKey = (role: string, railId: string, currency?: string | null) =>
  `${role}|rail|${railId}|${currency ?? ''}`

/** The optimistic-map key an edit touches - the inverse of the row key builders above. */
function editKey(edit: MappingEdit): string {
  if (!edit.scope) return defaultKey(edit.role)
  if ('store' in edit.scope) return storeKey(edit.role, edit.scope.store)
  return railKey(edit.role, edit.scope.rail, edit.currency)
}

/** `railKey` parsed back apart, for the "extra" currency rows an in-flight add-currency implies. */
function parseRailKey(key: string): { role: string; railId: string; currency: string } | null {
  const parts = key.split('|')
  if (parts.length !== 4 || parts[1] !== 'rail') return null
  return { role: parts[0]!, railId: parts[2]!, currency: parts[3]! }
}

export function MappingList({
  canControl,
  onAddAccounts,
}: {
  canControl: boolean
  /** Opens `chart-packs-dialog.tsx` (brief 16 §3.2) - owned by the page, since it also feeds the Chart tab. */
  onAddAccounts: () => void
}) {
  const roleMap = api.ledger.roleMap.useQuery()
  const gateways = api.paymentGateway.list.useQuery()
  // The mirror of `bank`'s "no feed linked" gate: a feed with reported activity
  // and no rail refuses every payout match, silently
  // (`plans/accounting/payout-links.md` §10.4, "Prevention at setup").
  const unlinkedFeeds = api.paymentGateway.listUnlinkedFeeds.useQuery()
  const utils = api.useUtils()
  // The Inherit fallback's own label (D8) - same cached `ledger.chartAccounts`
  // read every picker on this tab already shares.
  const { accounts } = useChartAccounts()

  const roles = useMemo(() => roleMap.data?.roles ?? [], [roleMap.data])
  const sources = useMemo(() => roleMap.data?.sources ?? [], [roleMap.data])
  const rails = useMemo(() => sources.filter((s) => s.axes.includes('rail')), [sources])
  const stores = useMemo(() => sources.filter((s) => s.axes.includes('store')), [sources])

  /** Rails whose live feed reports settlement activity - `bank`'s "no feed linked" gate (58 §5.4). */
  const railsWithFeed = useMemo(
    () => new Set((gateways.data ?? []).filter((g) => g.processorAccountId).map((g) => g.id)),
    [gateways.data]
  )

  // One `readiness` read per rail, batched - the mismatch line a bank row needs
  // (58 §5.4 rule 2). Small set (an org's payment gateways), so N reads here
  // costs nothing a single extra round trip wouldn't.
  const readinessResults = api.useQueries((t) =>
    rails.map((rail) => t.paymentGateway.readiness({ gatewayId: rail.id }))
  )
  const mismatchByRail = useMemo(() => {
    const map = new Map<string, string>()
    rails.forEach((rail, i) => {
      const first = readinessResults[i]?.data?.mismatches[0]
      if (first) map.set(rail.id, first.message)
    })
    return map
  }, [rails, readinessResults])

  // `?role=<key>` is the anchor every "Map role" deep link uses (the close
  // console's remedy rows, the Outbox's Blocked tab). It seeds the search box,
  // which already matches on the role key, so the row lands on screen open.
  const [roleParam] = useQueryState('role')
  const [search, setSearch] = useState(() => roleParam ?? '')
  const [configuredOnly, setConfiguredOnly] = useState(false)
  const [scopeParam, setScopeParam] = useQueryState('scope')
  const [collapsed, setCollapsed] = useState<GlAccountTypeValue[]>([])
  const [expandedRoles, setExpandedRoles] = useState<string[]>([])
  const [currencyDrafts, setCurrencyDrafts] = useState<Record<string, string[]>>({})

  // The optimistic overlay: what a row shows WHILE its own write is in flight,
  // or after one was refused (cleared, so the row falls back to the query's
  // own persisted value - the "snap back" refusal handling requires).
  const [optimistic, setOptimistic] = useState<Record<string, MappingAccountValue>>({})

  const toggleGroup = (type: GlAccountTypeValue) =>
    setCollapsed((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))
  const toggleRole = (role: string) =>
    setExpandedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    )

  const saveMapping = api.ledger.saveMapping.useMutation({
    onSuccess: async (_data, variables) => {
      await utils.ledger.roleMap.invalidate()
      setOptimistic((prev) => {
        const next = { ...prev }
        for (const row of variables) delete next[editKey(row)]
        return next
      })
    },
    onError: (error, variables) => {
      setOptimistic((prev) => {
        const next = { ...prev }
        for (const row of variables) delete next[editKey(row)]
        return next
      })
      toastError({ title: 'Error saving the mapping', description: error.message })
    },
  })

  /** Every row's change handler: show the pick immediately, save it immediately. */
  const commit = useCallback(
    (key: string, edit: MappingEdit) => {
      setOptimistic((prev) => ({ ...prev, [key]: edit.value === 'unused' ? 'unused' : edit.value }))
      saveMapping.mutate([edit])
    },
    [saveMapping]
  )

  /** Confirm one suggested row - re-saves it with its own current account (D5). */
  const confirmOne = useCallback((edit: MappingEdit) => saveMapping.mutate([edit]), [saveMapping])

  // Every currently-suggested row across the whole map, for the banner + "Confirm all".
  const suggestedEdits = useMemo(() => {
    const out: MappingEdit[] = []
    for (const role of roles) {
      if (role.state === 'suggested' && role.accountId) {
        out.push({ role: role.role, scope: null, value: role.accountId })
      }
      for (const o of role.overrides) {
        if (o.state === 'suggested') {
          out.push({ role: role.role, scope: { store: o.sourceAccountId }, value: o.accountId })
        }
      }
      for (const o of role.railOverrides) {
        if (o.state === 'suggested') {
          out.push({
            role: role.role,
            scope: { rail: o.paymentGatewayId },
            currency: o.currency,
            value: o.accountId,
          })
        }
      }
    }
    return out
  }, [roles])

  if (roleMap.isPending) {
    return (
      <div className='p-3 sm:p-6'>
        <EmptySection loading />
      </div>
    )
  }

  const needle = search.trim().toLowerCase()
  const scopeSourceRow = sources.find((s) => s.id === scopeParam) ?? null

  const scopeOptions = [
    { id: 'all', label: 'All' },
    ...stores.map((s) => ({ id: s.id, label: s.name })),
    ...rails.map((r) => ({ id: r.id, label: r.name })),
  ]

  return (
    <div className='flex flex-1 flex-col gap-3 p-3 sm:p-6'>
      {(unlinkedFeeds.data ?? []).length > 0 && (
        <div className='flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/40'>
          <div className='flex flex-wrap items-center gap-2'>
            <Unlink className='size-4 shrink-0 text-amber-600 dark:text-amber-400' />
            <span className='text-sm'>
              {unlinkedFeeds.data?.length} processor feed
              {unlinkedFeeds.data?.length === 1 ? '' : 's'} are not linked to a payment gateway.
              Nothing they settle can be matched to a customer payment.
            </span>
            <Button variant='outline' size='sm' className='ml-auto shrink-0' asChild>
              <Link href='/app/accounting/settings/payment-gateways'>Link a feed</Link>
            </Button>
          </div>
          <ul className='flex flex-wrap gap-1.5 ps-6'>
            {(unlinkedFeeds.data ?? []).map((feed) => (
              <li key={feed.processorAccountId}>
                <Badge variant='outline' size='xs'>
                  {feed.name ?? `${feed.providerKey} ${feed.externalAccountId}`}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {suggestedEdits.length > 0 && (
        <div className='flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/40'>
          <Sparkles className='size-4 shrink-0 text-amber-600 dark:text-amber-400' />
          <span className='text-sm'>
            Review suggested mappings ({suggestedEdits.length}) - auxx guessed these from your
            chart, nobody has confirmed them yet.
          </span>
          {canControl && (
            <Button
              variant='outline'
              size='sm'
              className='ml-auto shrink-0'
              loading={saveMapping.isPending}
              onClick={() => saveMapping.mutate(suggestedEdits)}>
              Confirm all
            </Button>
          )}
        </div>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        <InputSearch
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search roles and accounts...'
          className='flex-1'
        />
        {canControl && (
          <Button variant='outline' size='sm' className='shrink-0' onClick={onAddAccounts}>
            <Plus />
            Add accounts
          </Button>
        )}
        <div className='flex items-center gap-2'>
          <Switch
            id='mapping-configured-only'
            checked={configuredOnly}
            onCheckedChange={setConfiguredOnly}
          />
          <Label htmlFor='mapping-configured-only' className='text-muted-foreground text-xs'>
            Configured only
          </Label>
        </div>
        <Select
          value={scopeParam ?? 'all'}
          onValueChange={(v) => void setScopeParam(v === 'all' ? null : v)}>
          <SelectTrigger size='sm' className='w-[200px]'>
            <SelectValue placeholder='All' />
          </SelectTrigger>
          <SelectContent>
            {scopeOptions.map((opt) => (
              <SelectItem key={opt.id} value={opt.id}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className='flex flex-col gap-0.5'>
        {ACCOUNT_TYPE_OPTIONS.map(({ value: type, label }) => {
          const group = roles.filter((row) => ROLE_ACCOUNT_TYPES[row.role as AccountRole] === type)
          if (group.length === 0) return null

          // Under a scope filter, only the roles that accept that axis stay.
          const scoped = scopeSourceRow
            ? group.filter((row) => row.axis && scopeSourceRow.axes.includes(row.axis))
            : group

          const matched = needle ? scoped.filter((row) => roleMatchesSearch(row, needle)) : scoped
          if (matched.length === 0) return null

          const Icon = accountTypeIcon(type)
          const needed = matched.filter((row) => row.state !== 'unused')
          const mapped = needed.filter((row) => roleIsMapped(row, rails, railsWithFeed))

          return (
            <TreeRow
              key={type}
              expandable
              isOpen={!!needle || !!scopeSourceRow || !collapsed.includes(type)}
              onToggleOpen={() => toggleGroup(type)}
              icon={<Icon className='size-4 text-muted-foreground' />}
              title={<span className='truncate font-medium text-sm'>{label.toUpperCase()}</span>}
              secondary={
                <Badge variant='secondary' size='xs'>
                  {mapped.length} of {needed.length} mapped
                </Badge>
              }>
              <TreeRowList
                items={matched}
                getKey={(row: RoleAssignmentRow) => row.role}
                renderRow={(row: RoleAssignmentRow) => (
                  <RoleBlock
                    role={row}
                    accounts={accounts}
                    stores={stores}
                    rails={rails}
                    railsWithFeed={railsWithFeed}
                    mismatchByRail={mismatchByRail}
                    scopeId={scopeSourceRow?.id ?? null}
                    isOpen={expandedRoles.includes(row.role) || !!scopeSourceRow || !!needle}
                    onToggleOpen={() => toggleRole(row.role)}
                    optimistic={optimistic}
                    onCommit={commit}
                    onConfirm={confirmOne}
                    canControl={canControl}
                    configuredOnly={configuredOnly}
                    currencyDrafts={currencyDrafts}
                    setCurrencyDrafts={setCurrencyDrafts}
                  />
                )}
              />
            </TreeRow>
          )
        })}
      </div>
    </div>
  )
}

function roleMatchesSearch(row: RoleAssignmentRow, needle: string): boolean {
  const label = ACCOUNT_ROLE_LABELS[row.role as AccountRole] ?? row.role
  if (label.toLowerCase().includes(needle) || row.role.toLowerCase().includes(needle)) return true
  if (row.account && formatAccount(row.account).toLowerCase().includes(needle)) return true
  for (const o of row.overrides) {
    if (o.account && formatAccount(o.account).toLowerCase().includes(needle)) return true
  }
  for (const o of row.railOverrides) {
    if (o.account && formatAccount(o.account).toLowerCase().includes(needle)) return true
  }
  return false
}

function roleIsMapped(
  row: RoleAssignmentRow,
  rails: RoleSourceRow[],
  railsWithFeed: Set<string>
): boolean {
  if (row.role === BANK_ROLE) {
    const needing = rails.filter((r) => railsWithFeed.has(r.id))
    if (needing.length === 0) return true
    return needing.every((r) =>
      row.railOverrides.some((o) => o.paymentGatewayId === r.id && o.currency === null)
    )
  }
  return row.state === 'confirmed' || row.state === 'suggested'
}

function hasOverride(role: RoleAssignmentRow, source: RoleSourceRow): boolean {
  if (role.axis === 'store') return role.overrides.some((o) => o.sourceAccountId === source.id)
  if (role.axis === 'rail') return role.railOverrides.some((o) => o.paymentGatewayId === source.id)
  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// One role and its scope rows
// ─────────────────────────────────────────────────────────────────────────────

interface RoleBlockProps {
  role: RoleAssignmentRow
  /** The org's whole chart - the Inherit fallback's own path-aware label (D8). */
  accounts: ChartAccountRow[]
  stores: RoleSourceRow[]
  rails: RoleSourceRow[]
  railsWithFeed: Set<string>
  mismatchByRail: Map<string, string>
  /** A single scope id from the `?scope=` filter, or null for "All". */
  scopeId: string | null
  isOpen: boolean
  onToggleOpen: () => void
  optimistic: Record<string, MappingAccountValue>
  onCommit: (key: string, edit: MappingEdit) => void
  onConfirm: (edit: MappingEdit) => void
  canControl: boolean
  configuredOnly: boolean
  currencyDrafts: Record<string, string[]>
  setCurrencyDrafts: Dispatch<SetStateAction<Record<string, string[]>>>
}

function RoleBlock({
  role,
  accounts,
  stores,
  rails,
  railsWithFeed,
  mismatchByRail,
  scopeId,
  isOpen,
  onToggleOpen,
  optimistic,
  onCommit,
  onConfirm,
  canControl,
  configuredOnly,
  currencyDrafts,
  setCurrencyDrafts,
}: RoleBlockProps) {
  const roleKey = role.role as AccountRole
  const Icon = accountTypeIcon(ROLE_ACCOUNT_TYPES[roleKey])
  const isBank = role.role === BANK_ROLE
  const filterTypes = [ROLE_ACCOUNT_TYPES[roleKey]]
  const subtypePin = SUBTYPE_PIN[roleKey]

  const scopedSources = role.axis === 'store' ? stores : role.axis === 'rail' ? rails : []
  const inScope = scopeId ? scopedSources.filter((s) => s.id === scopeId) : scopedSources
  const visibleSources = configuredOnly ? inScope.filter((s) => hasOverride(role, s)) : inScope
  const expandable = visibleSources.length > 0

  const linkTooltip = useLinkTooltip()

  const utils = api.useUtils()
  const setRole = api.ledger.setRoleAssignment.useMutation({
    onSuccess: () => utils.ledger.roleMap.invalidate(),
    onError: (error) => {
      toastError({ title: 'Error saving the role map', description: error.message })
    },
  })

  const defaultKeyStr = defaultKey(role.role)
  const defaultPersisted: MappingAccountValue = role.state === 'unused' ? 'unused' : role.accountId
  const defaultValue = defaultKeyStr in optimistic ? optimistic[defaultKeyStr]! : defaultPersisted

  if (configuredOnly && !isBank && role.state === 'unmapped' && visibleSources.length === 0) {
    return null
  }

  const scopeRows = visibleSources.map((source) =>
    role.axis === 'store' ? (
      <StoreScopeRow
        key={source.id}
        role={role}
        accounts={accounts}
        source={source}
        optimistic={optimistic}
        onCommit={onCommit}
        onConfirm={onConfirm}
        canControl={canControl}
      />
    ) : (
      <RailScopeRow
        key={source.id}
        role={role}
        accounts={accounts}
        rail={source}
        noFeedLinked={isBank && !railsWithFeed.has(source.id)}
        mismatch={mismatchByRail.get(source.id)}
        optimistic={optimistic}
        onCommit={onCommit}
        onConfirm={onConfirm}
        canControl={canControl}
        currencyDrafts={currencyDrafts[`${role.role}:${source.id}`] ?? []}
        onAddDraft={() =>
          setCurrencyDrafts((prev) => ({
            ...prev,
            [`${role.role}:${source.id}`]: [...(prev[`${role.role}:${source.id}`] ?? []), ''],
          }))
        }
        onDraftChange={(index, value) =>
          setCurrencyDrafts((prev) => {
            const list = [...(prev[`${role.role}:${source.id}`] ?? [])]
            list[index] = value
            return { ...prev, [`${role.role}:${source.id}`]: list }
          })
        }
        onDraftCommitted={(index) =>
          setCurrencyDrafts((prev) => {
            const list = (prev[`${role.role}:${source.id}`] ?? []).filter((_, i) => i !== index)
            return { ...prev, [`${role.role}:${source.id}`]: list }
          })
        }
      />
    )
  )

  // 🛑 ONE row per role, never a wrapper plus a nested copy of itself: the
  // role's own picker belongs on the role's own row (59 §2.2).
  if (isBank) {
    return (
      <TreeRow
        depth={1}
        icon={<Icon className='size-4 text-muted-foreground' />}
        title={ACCOUNT_ROLE_LABELS[roleKey] ?? role.role}
        expandable={expandable}
        isOpen={isOpen}
        onToggleOpen={onToggleOpen}
        trailing={
          <BankRoleTrailing role={role} rails={visibleSources} railsWithFeed={railsWithFeed} />
        }>
        {scopeRows}
      </TreeRow>
    )
  }

  return (
    <MappingScopeRow
      depth={1}
      icon={<Icon className='size-4 text-muted-foreground' />}
      title={ACCOUNT_ROLE_LABELS[roleKey] ?? role.role}
      expandable={expandable}
      isOpen={isOpen}
      onToggleOpen={onToggleOpen}
      value={defaultValue}
      onChange={(next) =>
        onCommit(defaultKeyStr, {
          role: role.role,
          scope: null,
          value: next === 'inherit' ? (role.accountId ?? 'unused') : next,
        })
      }
      filterTypes={filterTypes}
      subtypePin={subtypePin}
      linked={role.linked}
      linkAccountId={role.accountId}
      linkTooltip={linkTooltip}
      suggested={!(defaultKeyStr in optimistic) && role.state === 'suggested'}
      onConfirmSuggested={
        role.accountId
          ? () => onConfirm({ role: role.role, scope: null, value: role.accountId! })
          : undefined
      }
      disabled={!canControl}
      extraActions={
        canControl &&
        role.state !== 'unmapped' && (
          <TreeRowButton
            tooltipText={role.state === 'unused' ? 'Mark used again' : 'Mark unused'}
            onClick={() =>
              setRole.mutate({ role: role.role, markedUnused: role.state !== 'unused' })
            }>
            {role.state === 'unused' ? <RotateCcw /> : <Ban />}
          </TreeRowButton>
        )
      }>
      {scopeRows}
    </MappingScopeRow>
  )
}

/** `bank`: no picker and no default, so its own row counts rails instead (58 §3 rule 3). */
function BankRoleTrailing({
  role,
  rails,
  railsWithFeed,
}: {
  role: RoleAssignmentRow
  rails: RoleSourceRow[]
  railsWithFeed: Set<string>
}) {
  const needing = rails.filter((r) => railsWithFeed.has(r.id))
  const mapped = needing.filter((r) =>
    role.railOverrides.some((o) => o.paymentGatewayId === r.id && o.currency === null)
  )
  return (
    <div className='flex items-center gap-1.5'>
      <span className='text-muted-foreground text-xs'>Per rail</span>
      <Badge variant='secondary' size='xs'>
        {mapped.length} of {needing.length} rails
      </Badge>
    </div>
  )
}

function StoreScopeRow({
  role,
  accounts,
  source,
  optimistic,
  onCommit,
  onConfirm,
  canControl,
}: {
  role: RoleAssignmentRow
  accounts: ChartAccountRow[]
  source: RoleSourceRow
  optimistic: Record<string, MappingAccountValue>
  onCommit: (key: string, edit: MappingEdit) => void
  onConfirm: (edit: MappingEdit) => void
  canControl: boolean
}) {
  const roleKey = role.role as AccountRole
  const linkTooltip = useLinkTooltip()
  const override = role.overrides.find((o) => o.sourceAccountId === source.id)
  const persisted: MappingAccountValue = override ? override.accountId : 'inherit'
  const key = storeKey(role.role, source.id)
  const value = key in optimistic ? optimistic[key]! : persisted
  const inheritedName = role.account ? formatAccountRow(accounts, role.account) : null

  return (
    <MappingScopeRow
      depth={2}
      nested
      icon={<Store className='size-4 text-muted-foreground' />}
      title={source.name}
      value={value}
      onChange={(next) =>
        onCommit(key, { role: role.role, scope: { store: source.id }, value: next })
      }
      inheritedAccountName={inheritedName}
      filterTypes={[ROLE_ACCOUNT_TYPES[roleKey]]}
      subtypePin={SUBTYPE_PIN[roleKey]}
      note={roleKey === 'accounts_receivable' ? STORE_RECEIVABLE_NOTE : undefined}
      linked={override?.linked ?? null}
      linkAccountId={override?.accountId ?? null}
      linkTooltip={linkTooltip}
      suggested={!(key in optimistic) && override?.state === 'suggested'}
      onConfirmSuggested={
        override
          ? () =>
              onConfirm({ role: role.role, scope: { store: source.id }, value: override.accountId })
          : undefined
      }
      disabled={!canControl}
    />
  )
}

function RailScopeRow({
  role,
  accounts,
  rail,
  noFeedLinked,
  mismatch,
  optimistic,
  onCommit,
  onConfirm,
  canControl,
  currencyDrafts,
  onAddDraft,
  onDraftChange,
  onDraftCommitted,
}: {
  role: RoleAssignmentRow
  accounts: ChartAccountRow[]
  rail: RoleSourceRow
  noFeedLinked: boolean
  mismatch: string | undefined
  optimistic: Record<string, MappingAccountValue>
  onCommit: (key: string, edit: MappingEdit) => void
  onConfirm: (edit: MappingEdit) => void
  canControl: boolean
  currencyDrafts: string[]
  onAddDraft: () => void
  onDraftChange: (index: number, value: string) => void
  onDraftCommitted: (index: number) => void
}) {
  const roleKey = role.role as AccountRole
  const isBank = role.role === BANK_ROLE
  const linkTooltip = useLinkTooltip()
  const own = role.railOverrides.find((o) => o.paymentGatewayId === rail.id && o.currency === null)
  const persisted: MappingAccountValue = own ? own.accountId : isBank ? null : 'inherit'
  const key = railKey(role.role, rail.id)
  const value = key in optimistic ? optimistic[key]! : persisted
  const inheritedName = isBank
    ? null
    : role.account
      ? formatAccountRow(accounts, role.account)
      : null

  const currencyRows = role.railOverrides.filter(
    (o) => o.paymentGatewayId === rail.id && o.currency !== null
  )
  const existingCurrencies = new Set(currencyRows.map((o) => o.currency as string))
  // An in-flight (or just-refused) add-currency write not yet in `railOverrides`
  // (server data) - the row still has to render while its own save is landing.
  const optimisticCurrencies = Object.keys(optimistic)
    .map(parseRailKey)
    .filter(
      (p): p is { role: string; railId: string; currency: string } =>
        !!p &&
        p.role === role.role &&
        p.railId === rail.id &&
        !!p.currency &&
        !existingCurrencies.has(p.currency)
    )
    .map((p) => p.currency)

  return (
    <MappingScopeRow
      depth={2}
      nested
      icon={<CreditCard className='size-4 text-muted-foreground' />}
      title={rail.name}
      value={value}
      onChange={(next) => onCommit(key, { role: role.role, scope: { rail: rail.id }, value: next })}
      inheritedAccountName={inheritedName}
      filterTypes={[ROLE_ACCOUNT_TYPES[roleKey]]}
      subtypePin={SUBTYPE_PIN[roleKey]}
      linked={own?.linked ?? null}
      linkAccountId={own?.accountId ?? null}
      linkTooltip={linkTooltip}
      suggested={!(key in optimistic) && own?.state === 'suggested'}
      onConfirmSuggested={
        own
          ? () => onConfirm({ role: role.role, scope: { rail: rail.id }, value: own.accountId })
          : undefined
      }
      mismatchMessage={isBank ? mismatch : undefined}
      noFeedLinked={noFeedLinked}
      onAddCurrency={canControl ? onAddDraft : undefined}
      disabled={!canControl}>
      {currencyRows.map((o) => (
        <CurrencyRow
          key={o.currency}
          role={role}
          accounts={accounts}
          rail={rail}
          currency={o.currency as string}
          override={o}
          railOwn={own}
          optimistic={optimistic}
          onCommit={onCommit}
          onConfirm={onConfirm}
          canControl={canControl}
        />
      ))}
      {optimisticCurrencies.map((currency) => (
        <CurrencyRow
          key={currency}
          role={role}
          accounts={accounts}
          rail={rail}
          currency={currency}
          override={undefined}
          railOwn={own}
          optimistic={optimistic}
          onCommit={onCommit}
          onConfirm={onConfirm}
          canControl={canControl}
        />
      ))}
      {currencyDrafts.map((code, index) => (
        <CurrencyDraftRow
          key={index}
          code={code}
          existing={new Set([...existingCurrencies, ...optimisticCurrencies])}
          onChange={(value) => onDraftChange(index, value)}
          onPick={(accountId) => {
            onCommit(railKey(role.role, rail.id, code), {
              role: role.role,
              scope: { rail: rail.id },
              currency: code,
              value: accountId,
            })
            onDraftCommitted(index)
          }}
          filterTypes={[ROLE_ACCOUNT_TYPES[roleKey]]}
          subtypePin={SUBTYPE_PIN[roleKey]}
          onRemove={() => onDraftCommitted(index)}
        />
      ))}
    </MappingScopeRow>
  )
}

function CurrencyRow({
  role,
  accounts,
  rail,
  currency,
  override,
  railOwn,
  optimistic,
  onCommit,
  onConfirm,
  canControl,
}: {
  role: RoleAssignmentRow
  accounts: ChartAccountRow[]
  rail: RoleSourceRow
  currency: string
  override: RoleRailAssignmentRow | undefined
  railOwn: RoleRailAssignmentRow | undefined
  optimistic: Record<string, MappingAccountValue>
  onCommit: (key: string, edit: MappingEdit) => void
  onConfirm: (edit: MappingEdit) => void
  canControl: boolean
}) {
  const roleKey = role.role as AccountRole
  const isBank = role.role === BANK_ROLE
  const linkTooltip = useLinkTooltip()
  const persisted: MappingAccountValue = override ? override.accountId : 'inherit'
  const key = railKey(role.role, rail.id, currency)
  const value = key in optimistic ? optimistic[key]! : persisted
  // The currency row's Inherit names the RAIL's own row, never the org default
  // (58 §3 rule 2; `bank` has no fallback beyond it - task 59 §2.2).
  const inheritedName = railOwn?.account
    ? formatAccountRow(accounts, railOwn.account)
    : isBank
      ? null
      : role.account
        ? formatAccountRow(accounts, role.account)
        : null

  return (
    <MappingScopeRow
      depth={3}
      nested
      title={currency}
      value={value}
      onChange={(next) =>
        onCommit(key, { role: role.role, scope: { rail: rail.id }, currency, value: next })
      }
      inheritedAccountName={inheritedName}
      filterTypes={[ROLE_ACCOUNT_TYPES[roleKey]]}
      subtypePin={SUBTYPE_PIN[roleKey]}
      linked={override?.linked ?? null}
      linkAccountId={override?.accountId ?? null}
      linkTooltip={linkTooltip}
      suggested={!(key in optimistic) && override?.state === 'suggested'}
      onConfirmSuggested={
        override
          ? () =>
              onConfirm({
                role: role.role,
                scope: { rail: rail.id },
                currency,
                value: override.accountId,
              })
          : undefined
      }
      disabled={!canControl}
    />
  )
}

/** A "+ currency" draft: type a code, then pick an account to save it (task 59 §2.2). */
function CurrencyDraftRow({
  code,
  existing,
  onChange,
  onPick,
  filterTypes,
  subtypePin,
  onRemove,
}: {
  code: string
  existing: Set<string>
  onChange: (value: string) => void
  onPick: (accountId: string) => void
  filterTypes: GlAccountTypeValue[]
  subtypePin: GlAccountSubtypeValue | undefined
  onRemove: () => void
}) {
  const valid = /^[A-Z]{3}$/.test(code) && !existing.has(code)
  return (
    <MappingScopeRow
      depth={3}
      nested
      title={
        <AutosizeInput
          value={code}
          onChange={(e) => onChange(e.target.value.toUpperCase().slice(0, 3))}
          placeholder='USD'
          minWidth={40}
          inputClassName='bg-transparent text-sm text-foreground outline-none uppercase'
        />
      }
      value={null}
      onChange={(next) => next !== 'inherit' && valid && onPick(next)}
      filterTypes={filterTypes}
      subtypePin={subtypePin}
      extraActions={
        <TreeRowButton tooltipText='Remove' onClick={onRemove}>
          <X />
        </TreeRowButton>
      }
    />
  )
}
