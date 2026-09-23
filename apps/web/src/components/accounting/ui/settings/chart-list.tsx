// apps/web/src/components/accounting/ui/settings/chart-list.tsx
'use client'

// The left column of the Chart of accounts tab: search and an Add button above a
// flat `TreeRow` list of the org's live `gl_account` rows, from
// `ledger.chartAccounts`.
//
// The chart WRITES now (`ledger.chartAccountCreate` / `Update` / `Remove`, all on
// `ledgerPost`). This list owns only the Add affordance and the phantom row; the
// fields, the removal and every refusal live in the detail pane, where a message
// has a row to land on.
//
// 🛑 The phantom row is what makes the draft's buffering visible. Between "Add
// account" and the Create button becoming enabled, the only evidence that
// anything is happening is this row tracking what is being typed - without it
// the person is filling in a form with no place in the list.
//
// ── The account map lives here too (task 19) ────────────────────────────────
//
// There is no QuickBooks tab any more. Which provider account each of ours
// corresponds to is an ATTRIBUTE of a `gl_account` - it is stored on the
// instance, and it is edited in the detail pane beside the code, the name and
// the type. What is left on this side is the part of the map that is about the
// LIST rather than about a row: the progress counter, the bulk confirm, the
// broken banner, and one badge per row.
//
// 🛑 The map DECORATES this list, it never sources it. `ChartMapView`'s header
// has the argument; the operative consequence is that everything below renders
// from `accounts` and stays fully usable while `map.isPending`, while
// `map.isError`, and with no provider connected at all.

import {
  type AccountNode,
  type AccountRole,
  accountPath,
  accountPathLabel,
  buildAccountTree,
  type ChartAccountRow,
  type GlAccountTypeValue,
} from '@auxx/lib/accounting/ledger/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ButtonSwitch } from '@auxx/ui/components/button-switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import {
  BookOpen,
  ChevronDown,
  CloudUpload,
  Landmark,
  Link2,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  SelectAllCheckbox,
  useBulkMode,
  useIsPending,
  useIsSelected,
  useListSelection,
  useSelectionIds,
} from '~/components/list-selection'
import { AccountLabel } from '../account-label'
import { accountMatchesSearch } from '../account-label-format'
import {
  ACCOUNT_SUGGESTION_REASON_COPY,
  ACCOUNT_TYPE_OPTIONS,
  type AccountLinkState,
  accountLinkState,
  accountTypeIcon,
  type ChartDraftHandle,
  type ChartMapView,
  formatProviderAccount,
} from './accounts-types'
import { ImportChartButton } from './import-chart-button'

/**
 * One statement-type group's accounts as a tree, over `groupVisible` (the
 * archived toggle already applied, search not). With `matchedIds` (a search is
 * active), a match's ancestors stay in the tree even when their own text does
 * not match, so the indent still reads - the same rule
 * `gl-account-picker.tsx`'s `accountsInGroup` follows. `null` means no search:
 * every visible account in the group renders.
 *
 * PURE and exported for its tests.
 */
export function chartGroupTree(
  groupVisible: ChartAccountRow[],
  matchedIds: ReadonlySet<string> | null
): AccountNode[] {
  if (!matchedIds) return buildAccountTree(groupVisible)

  const keepIds = new Set<string>()
  for (const id of matchedIds) {
    for (const ancestor of accountPath(groupVisible, id)) keepIds.add(ancestor.id)
  }
  return buildAccountTree(groupVisible.filter((account) => keepIds.has(account.id)))
}

/**
 * Every account id in `nodes`, depth-first in the same order
 * `ChartAccountListRow` draws them - a search's non-matching ancestors
 * (kept by `chartGroupTree` for context) included. What the selection
 * store's Cmd+A and shift-range read, instead of the search-filtered list
 * alone, which drops exactly those ancestor rows even though they render
 * with a checkbox like everything else. PURE, exported for its tests.
 */
export function flattenAccountIds(nodes: AccountNode[]): string[] {
  const ids: string[] = []
  const visit = (list: AccountNode[]) => {
    for (const node of list) {
      ids.push(node.account.id)
      visit(node.children)
    }
  }
  visit(nodes)
  return ids
}

interface ChartListProps {
  accounts: ChartAccountRow[]
  /** True while `ledger.chartAccounts` is in flight. An empty chart and an
   *  unloaded one are different answers and must not render the same. */
  isLoading: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Roles pointing at each account id, for the "2 roles" note on a row. */
  rolesByAccountId: Map<string, AccountRole[]>
  /** The uncommitted draft, if any. Rendered as a phantom row at the top. */
  draft: ChartDraftHandle | null
  onAddDraft: () => void
  /** Opens the catalogue picker (`chart-packs-dialog.tsx`). */
  onAddFromCatalogue: () => void
  /** Opens the create dialog with this account preset as the parent (CHART-HIERARCHY.md §7). */
  onAddSubAccount: (account: ChartAccountRow) => void
  /** Archives one account. Confirms and reports its own refusal. */
  onRemoveAccount: (id: string) => void
  /** Puts a removed account back. */
  onRestoreAccount: (id: string) => void
  showArchived: boolean
  onShowArchivedChange: (next: boolean) => void
  /** The account map, decorating the rows. Never the source of them. */
  map: ChartMapView
  /** Confirms every suggested mapping at once. */
  onConfirmSuggested: () => void
  confirming: boolean
  /** Confirms ONE row's suggestion, from the row itself. */
  onAcceptSuggestion: (glAccountId: string, providerAccountId: string) => void
  /** The account id whose single-row accept is in flight, if any. */
  acceptingAccountId: string | null
  /** Creates ONE row's account in the connected system and links it. */
  onCreateInProvider: (glAccountId: string) => void
  /** The account id whose create-and-link is in flight, if any. */
  creatingAccountId: string | null
  /** `PermissionKey.ledgerControl`. False hides every write affordance this
   *  list owns (Add account, Accept N) - the read path stays fully usable. */
  canControl: boolean
}

export function ChartList({
  accounts,
  isLoading,
  selectedId,
  onSelect,
  rolesByAccountId,
  draft,
  onAddDraft,
  onAddFromCatalogue,
  onAddSubAccount,
  onRemoveAccount,
  onRestoreAccount,
  showArchived,
  onShowArchivedChange,
  map,
  onConfirmSuggested,
  confirming,
  onAcceptSuggestion,
  acceptingAccountId,
  onCreateInProvider,
  creatingAccountId,
  canControl,
}: ChartListProps) {
  const [search, setSearch] = useState('')
  // Collapsed groups by statement type. Open is the default - the chart is what
  // this tab is for, and a group that starts shut hides the link badges the
  // rows exist to carry.
  const [collapsed, setCollapsed] = useState<GlAccountTypeValue[]>([])
  // Collapsed ACCOUNTS, same default-open rule - a parent with children starts
  // expanded, exactly as a type group does.
  const [collapsedAccounts, setCollapsedAccounts] = useState<string[]>([])

  const toggleGroup = (type: GlAccountTypeValue) =>
    setCollapsed((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))

  const toggleAccount = (id: string) =>
    setCollapsedAccounts((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )

  // 29 rows, recomputed per keystroke of the search box. A `useMemo` here would
  // cost more to read than the loop costs to run.
  // 🛑 `accounts` arrives WITH archived rows (the query always asks), so every
  // count below has to say which set it means. `live` is the chart; archived
  // rows are removed accounts kept for their history and their provider
  // identity, and counting them as chart would overstate it on every line.
  const live = accounts.filter((account) => !account.isArchived)
  const archivedCount = accounts.length - live.length

  const linked = live.filter(
    (account) => map.byAccountId.get(account.id)?.state === 'confirmed'
  ).length

  const visible = showArchived ? accounts : live
  // Search matches the path too (D8), so "sales" finds `Product Income` nested
  // under `Sales` even though neither its own code nor its name says "sales".
  const filtered = search
    ? visible.filter((account) =>
        accountMatchesSearch(account, search, accountPathLabel(visible, account.id))
      )
    : visible

  // Direct-child counts over the whole VISIBLE chart (the archived toggle
  // applied, search not) - the same rule `gl-account-picker.tsx`'s own
  // "N sub-accounts" follows, so a parent's count stays accurate while a
  // search narrows which of its children are actually on screen.
  const childCountByParentId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const account of visible) {
      if (account.parentId) counts.set(account.parentId, (counts.get(account.parentId) ?? 0) + 1)
    }
    return counts
  }, [visible])

  // Each statement-type group's tree, built once and shared by the render loop
  // below and `visibleIds` - the same `chartGroupTree` call must not run twice
  // per render, and the search-ancestor rows it adds have to reach the
  // selection store exactly as they reach the screen.
  const groupTrees = useMemo(
    () =>
      ACCOUNT_TYPE_OPTIONS.map(({ value: type, label }) => {
        const group = filtered.filter((account) => account.accountType === type)
        const groupVisible = visible.filter((account) => account.accountType === type)
        const tree = chartGroupTree(
          groupVisible,
          search ? new Set(group.map((account) => account.id)) : null
        )
        // `ids` is what the header's checkbox takes: the group as rendered.
        return { type, label, group, tree, ids: flattenAccountIds(tree) }
      }),
    [filtered, visible, search]
  )

  // 🛑 The selection store's idea of "every item" is what shift-range and Cmd+A
  // read, so it tracks what is actually ON SCREEN - filtered by the search and
  // by the archived toggle, in render order, PLUS the ancestors `chartGroupTree`
  // keeps for a search hit's context (`flattenAccountIds`). Those ancestor rows
  // render with the identical selection checkbox, so a plain `filtered.map(id)`
  // here left them clickable but unreachable by Cmd+A or a shift-range. Feeding
  // it the whole chart would go too far the other way and let Cmd+A select rows
  // the reader cannot see.
  //
  // 🛑 `pruneSelection: false` because this list HIDES rows rather than losing
  // them. Typing in the search narrows the visible set, and the default pruning
  // would read that as "those rows are gone" and silently drop them from the
  // selection - so picking two accounts, searching for a third and picking it
  // left one selected. A row that a bulk action really does remove leaves the
  // selection when the bar calls `exit()` on done.
  const setItemIds = useListSelection((state) => state.setItemIds)
  const visibleIds = useMemo(() => groupTrees.flatMap(({ ids }) => ids), [groupTrees])
  useEffect(() => {
    setItemIds(visibleIds, { pruneSelection: false })
  }, [visibleIds, setItemIds])

  // Hidden once `recordId` is stamped: the real row arrived with the invalidated
  // query, and rendering both would show the same account twice.
  const phantom = draft && !draft.recordId ? draft : null

  return (
    <div className='flex flex-col gap-3 p-3'>
      <div className='flex items-center gap-2'>
        {/* The outbox's list-level select, over the store's `itemIds` (`visibleIds`
            below, so a search narrows what "all" means). `listPadding` is this
            container's `p-3`; it lines the box up with the group headers' own. */}
        <SelectAllCheckbox listPadding={12} />
        <InputSearch
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search accounts...'
          className='flex-1'
        />
        {/* Offered only when there is something behind it. An always-present
            toggle over an empty set advertises a state most orgs never reach,
            and removal is meant to be quiet rather than a mode. */}
        {archivedCount > 0 && (
          <ButtonSwitch
            label={`Show archived (${archivedCount})`}
            size='xs'
            checked={showArchived}
            onCheckedChange={onShowArchivedChange}
            className='shrink-0'
          />
        )}
        {/* 🛑 ONE control, two answers. Two sibling buttons is exactly what
            forced `bank-accounts-list.tsx` to split its toolbar across two rows
            (a second button squeezes `InputSearch` to about forty pixels), and
            "add an account" is one intent with two routes rather than two
            intents.
            🛑 The catalogue is listed FIRST. Most of what a person reaches for
            here is a standard account that already exists in the catalogue, and
            leading with the blank row sends them off to type a code and a type
            that were written down already. Same order `tariff-codes-list.tsx`
            puts From catalogue in front of Add code. */}
        {canControl && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='outline' size='sm' className='shrink-0'>
                <Plus />
                Add account
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='min-w-[15rem]'>
              <DropdownMenuItem onSelect={onAddFromCatalogue}>
                <BookOpen />
                <span className='flex min-w-0 flex-col'>
                  <span>From catalogue</span>
                  <span className='text-muted-foreground text-xs'>
                    Pick from the standard chart
                  </span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onAddDraft}>
                <Plus />
                <span className='flex min-w-0 flex-col'>
                  <span>Blank account</span>
                  <span className='text-muted-foreground text-xs'>Name and number it yourself</span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* 🛑 ONE row, and its height is CONSTANT - `h-7`, the tallest thing it can
          hold (a `size='sm'` Button). This strip used to be two blocks that each
          rendered or did not, so the provider round trip landing shoved the whole
          chart down the page under the reader's cursor. A fixed box that holds a
          skeleton while pending cannot shift, whatever it resolves to.

          🛑 LOADING is tested before "nothing connected", the order
          `chart-account-editor.tsx`'s map block argues for: `connected` is false
          for the whole of the round trip, so testing it first would tell every
          reader their accounting system is disconnected for as long as it takes
          to answer - a claim about the org, made false by the render order.

          🛑 Gate on the PROVIDER, never on an empty map. "Nothing is connected"
          and "connected but nothing linked" are different answers needing
          different actions, and collapsing them would tell somebody to link a
          chart with nothing to link it to. */}
      <div className='flex h-7 shrink-0 items-center gap-2'>
        {map.isPending ? (
          <Skeleton className='h-4 w-52' />
        ) : map.isError ? (
          <span className='truncate text-muted-foreground text-xs'>
            Could not read the account map. Everything below is unaffected.
          </span>
        ) : !map.connected ? (
          // ⚠️ The reassurance that used to follow this ("entries are still
          // built, balanced and stored") is deliberately not here: it does not
          // fit one line, and the detail pane already says it on the row it is
          // about (`chart-account-editor.tsx`'s not-connected branch).
          <span className='truncate text-muted-foreground text-xs'>
            No accounting system connected, so nothing here is linked.
          </span>
        ) : (
          <>
            <span className='shrink-0 text-muted-foreground text-xs tabular-nums'>
              {linked} of {live.length} linked to {map.providerLabel ?? 'your accounting system'}
            </span>
            {canControl && map.suggested > 0 && (
              <Button
                variant='outline'
                size='xs'
                loading={confirming}
                loadingText='Confirming...'
                onClick={onConfirmSuggested}>
                <Sparkles />
                Accept {map.suggested}
              </Button>
            )}
            {/* Refresh only once the chart holds at least one CONFIRMED mapping -
                the signal that this chart was either imported or hand-mapped, so
                a refresh has something to add to rather than nothing to compare
                against (brief 16 §2.3). */}
            {canControl && linked > 0 && (
              <ImportChartButton mode='chart' connected={map.connected} />
            )}
          </>
        )}
      </div>

      {/* A dangling mapping is a REPAIR, not a mapping, and `G19` requires every
          close to refuse on exactly these - so it leads the tab rather than
          waiting to be found by selecting the right row. */}
      {map.broken.length > 0 && (
        <Alert variant='destructive'>
          <TriangleAlert />
          <AlertTitle>
            {map.broken.length} link{map.broken.length === 1 ? '' : 's'} no longer valid
          </AlertTitle>
          <AlertDescription>
            {map.broken.join(', ')}{' '}
            {map.broken.length === 1
              ? 'points at an account that has'
              : 'point at accounts that have'}{' '}
            been removed, deactivated or moved to a different section. Every close refuses until{' '}
            {map.broken.length === 1 ? 'it is' : 'they are'} re-linked.
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <EmptySection loading />
      ) : filtered.length === 0 && !phantom ? (
        <EmptySection
          icon={<Landmark className='size-5' />}
          title={search ? 'No matches' : 'No accounts in the chart'}
          // ⚠️ This copy used to blame the entity migrations, and that stopped
          // being true: `gl_account`'s DEFINITION ships with every org, its ROWS
          // are provisioned on purpose from the setup wizard, so an empty chart
          // is now an ordinary state rather than a broken one.
          description={
            search
              ? undefined
              : 'Add accounts here, or let the accounting setup create the default chart for you.'
          }
        />
      ) : (
        // `TREE_SECONDARY_NOTRUNCATE`: TreeRow's `secondary` slot truncates
        // (overflow-hidden) by default, which clips a Badge's pill edges and its
        // `ring-1 ring-current/35`. The class is exported by `tree-row.tsx` for
        // exactly this case - a BADGE-shaped secondary, which is what this list
        // has. The role map's secondary carries a sentence instead, so it must
        // NOT wear this class or the sentence stops truncating and overflows.
        <div className={cn('flex flex-col gap-0.5', TREE_SECONDARY_NOTRUNCATE)}>
          {phantom && (
            <TreeRow
              key={phantom.draftId}
              // Not `accountTypeIcon`: `ChartDraftHandle` carries the code and
              // the name being typed but no type, so there is nothing to key an
              // icon on until the row is saved and re-renders as a real one.
              icon={<Landmark className='size-4 text-muted-foreground' />}
              title={
                <AccountLabel
                  account={{ code: phantom.code || null, name: phantom.name || 'New account' }}
                  className='text-sm'
                />
              }
              secondaryFill
              onToggleOpen={() => onSelect(phantom.draftId)}
              rowClassName={cn(
                'bg-primary-100/50 hover:bg-primary-100',
                selectedId === phantom.draftId && 'bg-primary-100 ring-1 ring-primary-200'
              )}
              secondary={
                <span className='text-muted-foreground text-xs italic'>Not created yet</span>
              }
            />
          )}

          {/* 🛑 Grouped by STATEMENT TYPE, which is how QuickBooks sections its
              own chart and how `gl-account-picker.tsx` has always rendered this
              same list. Flat, the only ordering was
              `compareAccountsByCodeThenName` - whose own docstring says it is
              "applied AFTER the caller has ordered by statement type", which no
              caller did. An imported chart makes that visible: accounts with no
              number sort into one alphabetical run with liabilities between
              expenses.

              🛑 A `TreeRow` parent, not a `Section`, for the reason
              `role-map-list.tsx` gives: both levels are then the same primitive
              and the connector draws the nesting. */}
          {groupTrees.map(({ type, label, group, tree, ids }) => {
            // An empty group headed "no accounts here" is noise. A chart that
            // has no equity accounts should read as four groups, not five.
            if (group.length === 0) return null

            const groupLinked = group.filter(
              (account) => map.byAccountId.get(account.id)?.state === 'confirmed'
            ).length

            return (
              <ChartGroupRow
                key={type}
                type={type}
                label={label}
                ids={ids}
                // 🛑 A search FORCES every group open, for the reason the Roles
                // tab gives: `filtered` has already dropped what does not match,
                // so a collapsed group would hide the hits and read as nothing
                // found while holding some.
                isOpen={!!search || !collapsed.includes(type)}
                onToggleOpen={() => toggleGroup(type)}
                secondary={
                  <span className='text-muted-foreground text-xs tabular-nums'>
                    {group.length} {group.length === 1 ? 'account' : 'accounts'}
                    {map.connected && !map.isPending ? ` · ${groupLinked} linked` : ''}
                  </span>
                }>
                {/* `TreeRowList` is a flat list (its own "show more" collapse
                    does not nest); a tree of accounts nests the same way
                    `statement-table.tsx` and `role-map-list.tsx` do - each
                    row rendered directly in `TreeRow`'s own `children` slot,
                    recursively, so the connector line draws itself. */}
                {tree.map((node) => (
                  <ChartAccountListRow
                    key={node.account.id}
                    node={node}
                    rolesByAccountId={rolesByAccountId}
                    childCountByParentId={childCountByParentId}
                    forceOpen={!!search}
                    collapsedAccounts={collapsedAccounts}
                    onToggleAccount={toggleAccount}
                    map={map}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    onAcceptSuggestion={onAcceptSuggestion}
                    acceptingAccountId={acceptingAccountId}
                    onCreateInProvider={onCreateInProvider}
                    creatingAccountId={creatingAccountId}
                    onRemoveAccount={onRemoveAccount}
                    onRestoreAccount={onRestoreAccount}
                    onAddSubAccount={onAddSubAccount}
                    canControl={canControl}
                  />
                ))}
              </ChartGroupRow>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface ChartGroupRowProps {
  type: GlAccountTypeValue
  label: string
  /** The group's rows as rendered (search ancestors included); the header's checkbox takes them all. */
  ids: string[]
  isOpen: boolean
  onToggleOpen: () => void
  secondary: ReactNode
  children: ReactNode
}

/**
 * One statement-type header, the outbox's `GroupRow` shape: a tri-state
 * checkbox over the group's visible rows, hover-revealed and pinned in bulk
 * mode exactly as the rows' own. A component for the reason
 * `ChartAccountListRow` is one - it reads the selection store.
 */
function ChartGroupRow({
  type,
  label,
  ids,
  isOpen,
  onToggleOpen,
  secondary,
  children,
}: ChartGroupRowProps) {
  const selecting = useBulkMode()
  const selectedIds = useSelectionIds()
  const toggleMany = useListSelection((state) => state.toggleMany)
  const picked = ids.filter((id) => selectedIds.includes(id)).length
  const all = ids.length > 0 && picked === ids.length
  // 🛑 The group's OWN glyph, from `GL_ACCOUNT_TYPE_META`, not a blanket
  // `Landmark`. Five groups wearing one icon told the reader nothing the
  // heading did not already say, and it did not match the roles tab, which
  // drew its own three-for-five set.
  const GroupIcon = accountTypeIcon(type)
  return (
    <TreeRow
      expandable
      isOpen={isOpen}
      onToggleOpen={onToggleOpen}
      icon={<GroupIcon className='size-4 text-muted-foreground' />}
      selectable
      selecting={selecting}
      selected={all ? true : picked > 0 ? 'indeterminate' : false}
      onSelectChange={(next) => toggleMany(ids, next)}
      selectLabel={`Select every ${label.toLowerCase()} account`}
      title={<span className='truncate font-medium text-sm'>{label}</span>}
      secondary={secondary}
      rowClassName={cn(
        'bg-primary-100/50 hover:bg-primary-100',
        all && 'bg-info/10 hover:bg-info/15 dark:bg-info/20 dark:hover:bg-info/25'
      )}>
      {children}
    </TreeRow>
  )
}

/**
 * The one badge that answers "is this account linked to the accounting system?".
 *
 * 🛑 Every state renders something. A reader must never have to work out that
 * "no badge" meant linked - which is what the previous two-conditional-badges
 * shape asked of them, and it could not distinguish a linked account from one
 * with an unconfirmed suggestion at all.
 *
 * 🛑 `Suggested` is amber and wears the `Sparkles` mark, the same pair
 * `role-map-editor.tsx` already uses for a proposed role assignment. `G19`
 * requires a suggestion to read visibly differently from a confirmed mapping,
 * and the page should not have two vocabularies for one distinction.
 */
function AccountLinkBadge({ state }: { state: AccountLinkState }) {
  switch (state) {
    case 'broken':
      return (
        <Badge variant='destructive' size='xs'>
          Re-link
        </Badge>
      )
    case 'suggested':
      return (
        <Badge variant='amber' size='xs'>
          <Sparkles />
          Suggested
        </Badge>
      )
    case 'linked':
      return (
        <Badge variant='secondary' size='xs'>
          <Link2 />
          Linked
        </Badge>
      )
    default:
      return (
        <Badge variant='outline' size='xs'>
          Not linked
        </Badge>
      )
  }
}

interface ChartAccountListRowProps {
  node: AccountNode
  rolesByAccountId: Map<string, AccountRole[]>
  /** Direct-child counts, keyed by parent id - see `ChartList`'s own comment. */
  childCountByParentId: Map<string, number>
  /** A search is active - every parent renders open, the type groups' own rule. */
  forceOpen: boolean
  collapsedAccounts: string[]
  onToggleAccount: (id: string) => void
  map: ChartMapView
  selectedId: string | null
  onSelect: (id: string | null) => void
  onAcceptSuggestion: (glAccountId: string, providerAccountId: string) => void
  acceptingAccountId: string | null
  onCreateInProvider: (glAccountId: string) => void
  creatingAccountId: string | null
  onRemoveAccount: (id: string) => void
  onRestoreAccount: (id: string) => void
  onAddSubAccount: (account: ChartAccountRow) => void
  canControl: boolean
}

/**
 * One account in the chart list, and its sub-accounts nested inside it.
 *
 * 🛑 A COMPONENT, not a `renderRow` closure, because it calls `useIsSelected`.
 * A hook inside a render callback runs in the PARENT's hook order, and this list
 * filters - so the hook count would change between renders the moment somebody
 * typed in the search box.
 *
 * 🛑 Recurses through `TreeRow`'s own `children` slot, the way
 * `statement-table.tsx`'s `StatementTableRow` and `role-map-list.tsx` nest -
 * `TreeRowList` has no such recursion (its own "show more" collapse is a flat
 * list), so this is the primitive that draws the connector line itself.
 */
function ChartAccountListRow({
  node,
  rolesByAccountId,
  childCountByParentId,
  forceOpen,
  collapsedAccounts,
  onToggleAccount,
  map,
  selectedId,
  onSelect,
  onAcceptSuggestion,
  acceptingAccountId,
  onCreateInProvider,
  creatingAccountId,
  onRemoveAccount,
  onRestoreAccount,
  onAddSubAccount,
  canControl,
}: ChartAccountListRowProps) {
  const { account, depth, children } = node
  const selecting = useBulkMode()
  const isSelected = useIsSelected(account.id)
  const toggle = useListSelection((state) => state.toggle)
  const isPending = useIsPending(account.id)
  const roles = rolesByAccountId.get(account.id) ?? []

  const hasChildren = children.length > 0
  // Default OPEN, same rule the type groups follow - collapsing is opt-in.
  const isOpen = forceOpen || !collapsedAccounts.includes(account.id)
  const childCount = childCountByParentId.get(account.id) ?? 0

  const identity = map.byAccountId.get(account.id)
  // Gated on the LOADED map for the same reason the badge is: a
  // row action derived from a round trip that has not answered
  // yet is an offer the server may be about to refuse.
  const suggestion = map.connected && !map.isPending ? identity?.suggestion : undefined
  // 🛑 Offered ONLY where there is no candidate to link. A row the matcher found
  // something for should link the account that already exists - creating a
  // second one beside it is how a chart ends up with two "Card Clearing"s, which
  // split a balance in half with no error anywhere. The two buttons are never
  // both on a row, and which one appears is this line.
  const canCreateHere =
    map.connected && !map.isPending && map.canCreate && !suggestion && !identity?.providerAccountId
  const AccountIcon = accountTypeIcon(account.accountType)
  return (
    <TreeRow
      depth={depth + 1}
      icon={<AccountIcon className='size-4 text-muted-foreground' />}
      title={<AccountLabel account={account} className='text-sm' />}
      expandable={hasChildren}
      isOpen={isOpen}
      // 🛑 Selection is always AVAILABLE and only PINNED in bulk mode: the
      // checkbox cross-fades with the row's icon on hover, so an ordinary reader
      // never sees one and a person mid-selection sees them all.
      selectable
      selecting={selecting}
      selected={isSelected}
      onSelectChange={(_next, event) => toggle(account.id, { shiftKey: event.shiftKey })}
      selectLabel={`Select ${account.code ? `${account.code} ` : ''}${account.name}`}
      // No `secondaryFill`: a filled secondary pushes the expand chevron to the row's far edge.
      // Selecting a parent must not select its children (CHART-HIERARCHY.md
      // §7) - the row click opens the detail pane, exactly as a leaf's does,
      // and the chevron (rendered because `expandable`) owns expand/collapse.
      onToggleOpen={hasChildren ? () => onToggleAccount(account.id) : undefined}
      onRowClick={() => onSelect(account.id)}
      // `info` is what a picked row wears, `primary-*` the row you are looking at (the outbox's rule).
      rowClassName={cn(
        'bg-primary-100/50 hover:bg-primary-100',
        selectedId === account.id && 'bg-primary-100 ring-1 ring-primary-200',
        isSelected &&
          cn(
            'bg-info/10 hover:bg-info/15 dark:bg-info/20 dark:hover:bg-info/25',
            selectedId === account.id && 'ring-info/40'
          ),
        (!account.isActive || account.isArchived) && 'opacity-60',
        // The bulk runner is working on this row. Without it a long batch reads
        // as a frozen list.
        isPending && 'pointer-events-none animate-pulse opacity-50'
      )}
      // 🛑 `persistent`, and ONLY on a row that has a
      // suggestion. `TreeRowButton` is hover-revealed by
      // default, which is right for an action every row carries
      // and wrong for one that exists on the handful the matcher
      // happened to propose - the reader would have to hover
      // each row in turn to find them. The other rows get no
      // button rather than a disabled one: nothing to accept.
      //
      // 🛑 The tooltip NAMES the account and says how it was
      // matched. `G19` makes the confirming person the last line
      // of defence (a wrong account id still balances, so
      // nothing downstream catches it), and a bare check mark
      // would ask them to agree to something they cannot see.
      actions={
        canControl ? (
          <>
            {/* 🛑 An archived row offers RESTORE and nothing
                  else. Removing what is already removed does
                  nothing, and accepting a suggestion for it
                  would map a provider account onto a row the
                  chart does not contain. */}
            {account.isArchived ? (
              <TreeRowButton
                persistent
                tooltipText='Put this account back in the chart'
                onClick={() => onRestoreAccount(account.id)}>
                <RotateCcw />
              </TreeRowButton>
            ) : (
              <>
                {/* Hover-revealed, like Remove beside it - every live account
                    can take a sub-account, so pinning it would put one more
                    button on every row in the chart. */}
                <TreeRowButton
                  tooltipText='Add sub-account'
                  onClick={() => onAddSubAccount(account)}>
                  <Plus />
                </TreeRowButton>
                {suggestion && (
                  <TreeRowButton
                    persistent
                    tooltipText={`Link ${formatProviderAccount(suggestion.account)} - ${ACCOUNT_SUGGESTION_REASON_COPY[suggestion.reason]}`}
                    disabled={acceptingAccountId === account.id}
                    onClick={() => onAcceptSuggestion(account.id, suggestion.account.id)}>
                    <Link2 />
                  </TreeRowButton>
                )}
                {/* 🛑 A DIFFERENT action from the one above, not a
                  variant of it, which is why it wears a different
                  glyph. That one agrees to a pairing the matcher
                  proposed; this one ADDS an account to somebody's
                  real books. They are mutually exclusive by
                  `canCreateHere`, so no row ever shows both and
                  nobody has to work out which is which.
                  🛑 `persistent`, like the accept button and for
                  the same reason: it exists on a subset of rows,
                  and hover-hunting to find which ones is exactly
                  what pinning avoids. The tooltip NAMES the
                  provider - "create it in QuickBooks" is a
                  sentence somebody can decline; "create" is not. */}
                {canCreateHere && (
                  <TreeRowButton
                    persistent
                    tooltipText={`Create this account in ${map.providerLabel ?? 'the accounting system'} and link it`}
                    disabled={creatingAccountId === account.id}
                    onClick={() => onCreateInProvider(account.id)}>
                    <CloudUpload />
                  </TreeRowButton>
                )}
                {/* 🛑 NOT `persistent`, unlike the accept button
                  beside it. Remove is destructive and belongs to
                  every row, so pinning it visible would put a
                  hundred delete buttons on screen; hover-reveal
                  is exactly what the default variant is for. The
                  accept button is pinned because it exists on
                  only the handful of rows the matcher proposed,
                  and hover-hunting those is the thing to avoid.
                  🛑 The confirm and the refusal both live in
                  `accounts-settings-page.tsx`. A role still
                  posting here is the server's answer, and a
                  client-side copy of that check would be a second
                  authority over the one question this page must
                  not get wrong. */}
                <TreeRowButton
                  variant='destructive'
                  tooltipText='Remove from the chart'
                  onClick={() => onRemoveAccount(account.id)}>
                  <Trash2 />
                </TreeRowButton>
              </>
            )}
          </>
        ) : undefined
      }
      secondary={
        <span className='flex items-center gap-1.5 text-muted-foreground text-xs'>
          {/* ⚠️ NO type badge. The group header this row sits
                under already says the statement type, and
                repeating it on every row under it is the badge
                saying what the heading just said. */}
          {childCount > 0 && (
            <span>
              {childCount} sub-account{childCount === 1 ? '' : 's'}
            </span>
          )}
          {/* ⚠️ Archived and inactive are different states and
                must not read the same. Inactive is an account
                the org keeps but will not post to; archived is
                one it took out of the chart entirely. */}
          {account.isArchived ? (
            <Badge variant='secondary' size='xs'>
              Removed
            </Badge>
          ) : (
            !account.isActive && (
              <Badge variant='outline' size='xs'>
                Inactive
              </Badge>
            )
          )}
          {/* Only ever rendered against a LOADED map. A link
                badge on rows the provider round trip has not
                answered for yet is a claim about the org, and
                rendering it mid-load makes it a false one.

                🛑 One badge, ALWAYS present once the map has
                loaded - never a set of conditional badges whose
                absence has to be interpreted. This used to render
                only two of the four states, so a row with a
                pending suggestion looked exactly like a linked
                one: silence. */}
          {map.connected && !map.isPending && (
            <AccountLinkBadge state={accountLinkState(identity)} />
          )}
          {roles.length > 0 && (
            <span>
              {roles.length} {roles.length === 1 ? 'role' : 'roles'}
            </span>
          )}
        </span>
      }>
      {hasChildren
        ? children.map((child) => (
            <ChartAccountListRow
              key={child.account.id}
              node={child}
              rolesByAccountId={rolesByAccountId}
              childCountByParentId={childCountByParentId}
              forceOpen={forceOpen}
              collapsedAccounts={collapsedAccounts}
              onToggleAccount={onToggleAccount}
              map={map}
              selectedId={selectedId}
              onSelect={onSelect}
              onAcceptSuggestion={onAcceptSuggestion}
              acceptingAccountId={acceptingAccountId}
              onCreateInProvider={onCreateInProvider}
              creatingAccountId={creatingAccountId}
              onRemoveAccount={onRemoveAccount}
              onRestoreAccount={onRestoreAccount}
              onAddSubAccount={onAddSubAccount}
              canControl={canControl}
            />
          ))
        : undefined}
    </TreeRow>
  )
}
