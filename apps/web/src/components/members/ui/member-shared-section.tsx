// apps/web/src/components/members/ui/member-shared-section.tsx
'use client'

import { ResourceGranteeType } from '@auxx/database/enums'
import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ListBulkToggle } from '@auxx/ui/components/list-bulk-toggle'
import { EmptySection } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { TREE_SECONDARY_NOTRUNCATE } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Package, Share2, Trash2 } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import {
  type BulkBatchRefusal,
  ListSelectionProvider,
  useBulkMode,
  useBulkRunner,
  useListSelection,
  useSelectionCount,
  useSelectionIds,
} from '~/components/list-selection'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import {
  type MemberShareGroup,
  type MemberShareItem,
  type RevokeSharesResult,
  useGranterNames,
  useMemberShares,
  useRevokeMemberShares,
} from '../hooks/use-member-shares'
import type { Member } from '../types'
import {
  MemberSharedGroupRow,
  MemberSharedTypeGroup,
  ShareGroupIcon,
} from './member-shared-group-row'

/**
 * The member "Shared" tab (plan 46 §6).
 *
 * Two sections: everything addressed directly to this member, listed and
 * sweepable; and what the member OWNS, counts only. The split is the whole
 * safety argument for the feature — 96% of a member's `granteeType: 'user'` rows
 * are self-granted, so a literal "delete every row where `granteeId = X`" would
 * delete their own snippets, dashboards, signature and personal mailbox. The
 * server excludes owner rows in SQL in every scope; this section never lists
 * them.
 *
 * Only DIRECT rows appear. What the member reaches through a team or their
 * permission profile belongs to the Teams section and the Permissions tab
 * respectively, and is neither shown nor swept.
 */
export function MemberSharedSection({
  member,
  viewerId,
}: {
  member: Member
  viewerId: string | null | undefined
}) {
  return (
    <ListSelectionProvider>
      <MemberSharedSectionInner member={member} viewerId={viewerId} />
    </ListSelectionProvider>
  )
}

/**
 * Turn a server refusal into the tail of a summary-toast line.
 *
 * `runBatch` renders `${count} ${label}.`, and the server's `label` is the
 * grouping key — an inbox name, or the literal `Contacts` — so it needs a verb
 * phrase around it or the toast reads "20 Support."
 */
function refusalLine(refusal: RevokeSharesResult['refused'][number]): BulkBatchRefusal {
  return {
    reason: refusal.reason,
    count: refusal.count,
    label:
      refusal.label === 'Contacts'
        ? 'contact shares need an admin'
        : `items in ${refusal.label} need inbox access`,
  }
}

/** One-off toast for the single-row and per-type paths, which do not go through `runBatch`. */
function reportRefusals(result: RevokeSharesResult) {
  if (result.refused.length === 0) return
  const total = result.revoked + result.refused.reduce((sum, r) => sum + r.count, 0)
  toastError({
    title: 'Some shares could not be removed',
    description: [
      `${result.revoked} of ${total} removed.`,
      ...result.refused.map((r) => `${r.count} ${refusalLine(r).label}.`),
    ].join(' '),
  })
}

function MemberSharedSectionInner({
  member,
  viewerId,
}: {
  member: Member
  viewerId: string | null | undefined
}) {
  // Viewing your OWN Shared tab is allowed and read-only (§4.2). A member
  // dropping their own share uses the self-revoke hatch on the resource itself,
  // which is where the mail guard's self-revoke exception lives.
  const canRevoke = !!viewerId && member.userId !== viewerId

  const { isLoading, instanceGroups, typeGrants, owned, totalShared, totalOwned, searchScanCap } =
    useMemberShares(member.userId)
  const granterNames = useGranterNames()
  const { revoke, invalidate } = useRevokeMemberShares(member.userId)
  const { ConfirmDialog, runBatch, isRunning } = useBulkRunner()
  const [confirm, SingleConfirmDialog] = useConfirm()
  const utils = api.useUtils()
  const revokeType = api.resourceAccess.revokeType.useMutation()

  const bulkMode = useBulkMode()
  const setBulkMode = useListSelection((s) => s.setBulkMode)
  const setItemIds = useListSelection((s) => s.setItemIds)
  const exit = useListSelection((s) => s.exit)
  const selectedIds = useSelectionIds()
  const selectedCount = useSelectionCount()

  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim())
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set())
  const [typeGroupOpen, setTypeGroupOpen] = useState(false)
  const [itemsByGroup, setItemsByGroup] = useState<Record<string, MemberShareItem[]>>({})
  /**
   * The Gmail idiom (§6.4a). The selection store holds the LOADED page's ids and
   * `selectAll()` means "every visible item"; a sweep across 340 rows is a
   * SCOPE, not a list. Rather than fight the store, this flag switches which
   * scope the bulk action sends while the store's semantics stay untouched.
   */
  const [selectAllScope, setSelectAllScope] = useState<null | 'all'>(null)

  // Typing auto-expands every group and runs the search across types (§3.4).
  const isGroupOpen = useCallback(
    (entityDefinitionId: string) => !!deferredSearch || openGroups.has(entityDefinitionId),
    [deferredSearch, openGroups]
  )

  const toggleGroup = useCallback((entityDefinitionId: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(entityDefinitionId)) next.delete(entityDefinitionId)
      else next.add(entityDefinitionId)
      return next
    })
  }, [])

  const handleItemsChange = useCallback((entityDefinitionId: string, items: MemberShareItem[]) => {
    setItemsByGroup((prev) => {
      const existing = prev[entityDefinitionId]
      if (!existing && items.length === 0) return prev
      if (
        existing &&
        existing.length === items.length &&
        existing.every((row, i) => row.recordId === items[i]?.recordId)
      ) {
        return prev
      }
      return { ...prev, [entityDefinitionId]: items }
    })
  }, [])

  /**
   * Every loaded, SELECTABLE row, in display order.
   *
   * Blocked mail rows are omitted, which is what excludes them from Cmd+A and
   * from a group checkbox (§5.2) — they stay visible and counted, they just
   * cannot be swept by this viewer.
   */
  const selectableIds = useMemo(() => {
    const ids: string[] = []
    for (const group of instanceGroups) {
      for (const item of itemsByGroup[group.entityDefinitionId] ?? []) {
        if (!item.blockedReason) ids.push(item.recordId)
      }
    }
    return ids
  }, [instanceGroups, itemsByGroup])

  useEffect(() => setItemIds(selectableIds), [selectableIds, setItemIds])

  // The scope offer only makes sense once the loaded set is exhausted — before
  // that "select all" would silently widen a partial selection.
  const canOfferAllScope =
    canRevoke &&
    selectAllScope === null &&
    selectedCount > 0 &&
    selectedCount === selectableIds.length &&
    totalShared > selectedCount

  const clearScope = useCallback(() => setSelectAllScope(null), [])

  useEffect(() => {
    if (selectedCount === 0) setSelectAllScope(null)
  }, [selectedCount])

  const handleBulkRemove = useCallback(() => {
    const sweepingAll = selectAllScope === 'all'
    const count = sweepingAll ? totalShared : selectedCount
    void runBatch(
      selectedIds,
      async () => {
        const result = await revoke(
          sweepingAll
            ? { kind: 'all' }
            : { kind: 'ids', recordIds: selectedIds as RevokeIds['recordIds'] }
        )
        return { revoked: result.revoked, refused: result.refused.map(refusalLine) }
      },
      {
        title: `Remove ${count} shared ${count === 1 ? 'item' : 'items'}?`,
        description: 'This member loses access immediately. Items they own are never removed here.',
        confirmText: 'Remove',
        pendingLabel: 'Removing…',
        failureTitle: 'Some shares could not be removed',
        onDone: () => {
          setSelectAllScope(null)
          invalidate()
          exit()
        },
      }
    )
  }, [selectAllScope, totalShared, selectedCount, selectedIds, runBatch, revoke, invalidate, exit])

  const handleRemoveType = useCallback(
    async (group: MemberShareGroup) => {
      const confirmed = await confirm({
        title: `Remove all ${group.count} ${group.count === 1 ? group.label.toLowerCase() : group.plural}?`,
        description: 'This member loses access immediately. Items they own are never removed here.',
        confirmText: 'Remove',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
      try {
        const result = await revoke({
          kind: 'type',
          entityDefinitionId: group.entityDefinitionId,
        })
        reportRefusals(result)
        invalidate()
      } catch (error) {
        toastError({ title: 'Error removing shares', description: (error as Error).message })
      }
    },
    [confirm, revoke, invalidate]
  )

  const handleRemoveOne = useCallback(
    async (item: MemberShareItem, group: MemberShareGroup) => {
      const confirmed = await confirm({
        title: `Remove access to ${item.label}?`,
        description: `This member loses access to this ${group.plural.replace(/s$/, '')} immediately.`,
        confirmText: 'Remove',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
      try {
        const result = await revoke({
          kind: 'ids',
          recordIds: [item.recordId] as RevokeIds['recordIds'],
        })
        reportRefusals(result)
        invalidate()
      } catch (error) {
        toastError({ title: 'Error removing share', description: (error as Error).message })
      }
    },
    [confirm, revoke, invalidate]
  )

  const handleRemoveTypeGrant = useCallback(
    async (entityDefinitionId: string, label: string) => {
      const confirmed = await confirm({
        title: `Remove the ${label} record-type grant?`,
        description:
          'This member loses access to every record of this type unless another grant reaches them.',
        confirmText: 'Remove',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
      try {
        await revokeType.mutateAsync({
          entityDefinitionId,
          granteeType: ResourceGranteeType.user,
          granteeId: member.userId,
        })
        utils.member.shareSummary.invalidate({ memberId: member.userId })
      } catch (error) {
        toastError({ title: 'Error removing grant', description: (error as Error).message })
      }
    },
    [confirm, revokeType, utils, member.userId]
  )

  const actions: ActionBarAction[] = [
    {
      id: 'remove-shares',
      label: selectAllScope === 'all' ? `Remove all ${totalShared}` : 'Remove',
      icon: Trash2,
      variant: 'destructive',
      disabled: isRunning || selectedCount === 0,
      onClick: handleBulkRemove,
    },
  ]

  const hasShares = instanceGroups.length > 0 || typeGrants.length > 0

  return (
    <>
      <SettingsSection
        icon={Share2}
        title='Shared with this member'
        description='Everything shared directly with this person. Access through a team or their permission profile is not listed here.'>
        {/*
          Search and the bulk toggle sit in the BODY, not the section header —
          the `connections-section.tsx` precedent. Hidden entirely while loading
          or when nothing is shared: a search box floating above an empty state
          is noise.
        */}
        {!isLoading && hasShares && (
          <div className='flex items-center gap-2'>
            {/* Bound the InputSearch wrapper (it's `relative flex-1`), not just its inner input —
                otherwise the absolutely-positioned clear button pins to the full-width row's edge. */}
            <div className='flex-1'>
              <InputSearch
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClear={() => setSearch('')}
                placeholder='Search shared items...'
              />
            </div>
            {canRevoke && (
              <ListBulkToggle active={bulkMode} onActiveChange={setBulkMode} className='shrink-0' />
            )}
          </div>
        )}

        {isLoading ? (
          <div className='space-y-2 rounded-xl border p-1'>
            <Skeleton className='h-8 w-full rounded-md' />
            <Skeleton className='h-8 w-full rounded-md' />
            <Skeleton className='h-8 w-full rounded-md' />
          </div>
        ) : !hasShares ? (
          <EmptySection
            icon={<Share2 />}
            title='Nothing shared with this member'
            description='Threads, records, dashboards and other items shared directly with this person will show up here.'
          />
        ) : (
          <div
            className={cn('flex flex-col gap-1 rounded-xl border p-1', TREE_SECONDARY_NOTRUNCATE)}>
            {/* Pinned first, and excluded from every sweep (decision 8). */}
            {typeGrants.length > 0 && (
              <MemberSharedTypeGroup
                typeGrants={typeGrants}
                isOpen={typeGroupOpen}
                onToggleOpen={() => setTypeGroupOpen((open) => !open)}
                onRemove={handleRemoveTypeGrant}
                canRevoke={canRevoke}
                permissionsHref={`/app/settings/members/${member.userId}?tab=permissions`}
              />
            )}

            {instanceGroups.map((group) => (
              <MemberSharedGroupRow
                key={group.entityDefinitionId}
                memberId={member.userId}
                group={group}
                isOpen={isGroupOpen(group.entityDefinitionId)}
                onToggleOpen={() => toggleGroup(group.entityDefinitionId)}
                search={deferredSearch}
                onItemsChange={handleItemsChange}
                onRemoveType={handleRemoveType}
                onRemoveOne={handleRemoveOne}
                granterNames={granterNames}
                canRevoke={canRevoke}
                searchScanCap={searchScanCap}
              />
            ))}
          </div>
        )}

        {/*
          §6.4a's scope line. It lives here rather than inside `ActionBar`, which
          takes a count and a list of actions and has no slot for a sentence —
          and it reads better beside the rows it is talking about anyway.
        */}
        {(canOfferAllScope || selectAllScope === 'all') && (
          <div className='flex flex-wrap items-center gap-2 rounded-lg bg-primary-50 px-3 py-2 text-sm'>
            {selectAllScope === 'all' ? (
              <>
                <span>All {totalShared} shared items are selected.</span>
                <Button variant='ghost' size='xs' onClick={clearScope}>
                  Select only the {selectedCount} loaded
                </Button>
              </>
            ) : (
              <>
                <span>
                  All {selectedCount} loaded {selectedCount === 1 ? 'item is' : 'items are'}{' '}
                  selected.
                </span>
                <Button variant='ghost' size='xs' onClick={() => setSelectAllScope('all')}>
                  Select all {totalShared} shared items
                </Button>
              </>
            )}
          </div>
        )}
      </SettingsSection>

      {totalOwned > 0 && (
        <SettingsSection
          icon={Package}
          title='Owned by this member'
          description='The member created these, so removing access is not the tool — the item itself has to go.'>
          <div className='flex flex-col gap-3 rounded-xl border p-3'>
            <div className='flex flex-wrap items-center gap-2'>
              {owned.map((entry) => (
                <Badge key={entry.groupKey} variant='secondary' size='sm' className='gap-1.5'>
                  <ShareGroupIcon groupKey={entry.groupKey} icon={null} />
                  {entry.label} {entry.count}
                </Badge>
              ))}
            </div>
            <ul className='space-y-1 text-sm text-muted-foreground'>
              {owned
                .filter((entry) => entry.ownedRemoval)
                .map((entry) => (
                  <li key={entry.groupKey}>
                    <span className='text-foreground'>{entry.label}:</span> {entry.ownedRemoval}
                  </li>
                ))}
            </ul>
          </div>
        </SettingsSection>
      )}

      <ActionBar
        open={canRevoke && (bulkMode || selectedCount > 0)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectAllScope(null)
            exit()
          }
        }}
        selectedCount={selectAllScope === 'all' ? totalShared : selectedCount}
        selectedLabel='selected'
        actions={actions}
        showClose
      />
      <ConfirmDialog />
      <SingleConfirmDialog />
    </>
  )
}

/** The `ids` scope's branded `recordIds`, so a cast lands on one named type. */
type RevokeIds = Extract<
  Parameters<ReturnType<typeof useRevokeMemberShares>['revoke']>[0],
  { kind: 'ids' }
>
