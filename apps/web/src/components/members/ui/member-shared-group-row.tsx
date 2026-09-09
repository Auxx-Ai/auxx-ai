// apps/web/src/components/members/ui/member-shared-group-row.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { TreeRow, TreeRowButton, TreeRowEmpty } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { formatRelativeTime } from '@auxx/utils'
import {
  BookOpen,
  Bot,
  Contact,
  Database,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  Mailbox,
  MessagesSquare,
  NotepadText,
  PenLine,
  Send,
  ShieldCheck,
  Table2,
  Trash2,
  Workflow,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo } from 'react'
import {
  useBulkMode,
  useIsPending,
  useIsSelected,
  useListSelection,
  usePendingLabel,
} from '~/components/list-selection'
import {
  displayPermissionOfRung,
  LEVEL_OF_PERMISSION,
} from '~/components/permissions/ui/level-labels'
import { RungBadge } from '~/components/permissions/ui/rung-badge'
import type { MemberShareGroup, MemberShareItem } from '../hooks/use-member-shares'
import { MEMBER_SHARES_PAGE_SIZE, useMemberShareGroup } from '../hooks/use-member-shares'

/**
 * Glyph per resource type.
 *
 * Plan §6.2 says to take these from `PERMISSION_AREAS[area].icon` — that field
 * does not exist (`AreaMetadata` carries label/description/group/rungs and no
 * icon), and the group vocabulary here is a def keyspace rather than a
 * permission area anyway, so the map is keyed on the group key directly. Record
 * groups draw their definition's own `EntityIcon` instead and never reach this.
 */
export const SHARE_GROUP_ICONS: Record<string, LucideIcon> = {
  thread: MessagesSquare,
  inbox: Inbox,
  personal_inbox: Mailbox,
  contact: Contact,
  signature: PenLine,
  snippet: NotepadText,
  sequence: Send,
  dashboard: LayoutDashboard,
  dataset: Database,
  kb: BookOpen,
  workflow: Workflow,
  agent: Bot,
  record: Table2,
}

/** The group's own glyph, or the record definition's icon when it has one. */
export function ShareGroupIcon({
  groupKey,
  icon,
}: {
  groupKey: string
  icon: { iconId: string; color: string } | null
}) {
  if (icon) return <EntityIcon iconId={icon.iconId} color={icon.color} size='xs' />
  const Glyph = SHARE_GROUP_ICONS[groupKey] ?? Table2
  return <Glyph className='size-4' />
}

interface MemberSharedGroupRowProps {
  memberId: string
  group: MemberShareGroup
  isOpen: boolean
  onToggleOpen: () => void
  /** Debounced search term. Non-empty forces the group open and runs the label scan. */
  search: string
  /**
   * Reports this group's loaded rows up to the section, which owns the
   * selection store's `itemIds` (it is the union across every open group, and
   * `setItemIds` prunes the selection to what it is given).
   */
  onItemsChange: (entityDefinitionId: string, items: MemberShareItem[]) => void
  /** "Remove all in this type" — a `{ kind: 'type' }` scope, not a list of ids. */
  onRemoveType: (group: MemberShareGroup) => void
  /** Single-row revoke — a one-element `{ kind: 'ids' }` scope. */
  onRemoveOne: (item: MemberShareItem, group: MemberShareGroup) => void
  /** `grantedById` → display name. */
  granterNames: Map<string, string>
  /** False while the viewer is looking at their own tab (§4.2 — read-only). */
  canRevoke: boolean
  /** How deep a search scans this group before it truncates. */
  searchScanCap: number
}

/**
 * One resource type on the member Shared tab (§6.2).
 *
 * Expand and select are deliberately different gestures here. Deposits — the row
 * this copies its checkbox idiom from — binds the parent row's `onToggleOpen` to
 * "select the day", which works because its day groups never collapse. These
 * genuinely collapse and the expand IS the fetch, so a click on the row means
 * expand, and only the checkbox selects.
 */
export function MemberSharedGroupRow({
  memberId,
  group,
  isOpen,
  onToggleOpen,
  search,
  onItemsChange,
  onRemoveType,
  onRemoveOne,
  granterNames,
  canRevoke,
  searchScanCap,
}: MemberSharedGroupRowProps) {
  const bulkMode = useBulkMode()
  const selectedIds = useListSelection((s) => s.selectedIds)
  const toggle = useListSelection((s) => s.toggle)

  const page = useMemberShareGroup({
    memberId,
    entityDefinitionId: group.entityDefinitionId,
    enabled: isOpen,
    q: search || undefined,
  })

  useEffect(() => {
    onItemsChange(group.entityDefinitionId, isOpen ? page.items : [])
  }, [onItemsChange, group.entityDefinitionId, isOpen, page.items])

  // A blocked row is visible and counted but never sweepable (§5.2), so it is
  // excluded from the group checkbox's set as well as from select-all.
  const selectableIds = useMemo(
    () => page.items.filter((i) => !i.blockedReason).map((i) => i.recordId),
    [page.items]
  )
  const selectedInGroup = useMemo(() => {
    const chosen = new Set(selectedIds)
    return selectableIds.filter((id) => chosen.has(id)).length
  }, [selectedIds, selectableIds])

  const groupSelected: boolean | 'indeterminate' =
    selectableIds.length > 0 && selectedInGroup === selectableIds.length
      ? true
      : selectedInGroup > 0
        ? 'indeterminate'
        : false

  const handleGroupSelect = useCallback(
    (next: boolean) => {
      const chosen = new Set(selectedIds)
      for (const id of selectableIds) {
        if (next !== chosen.has(id)) toggle(id)
      }
    },
    [selectedIds, selectableIds, toggle]
  )

  // A group with more rows than the scan cap is searching only its most recent
  // (the scan resolves labels and matches the REDACTED one, so it cannot run off
  // an index), and a search UI that does not admit that is lying.
  const scanCapped = !!search && searchScanCap > 0 && group.count > searchScanCap
  const showMatchCount = !!search && (page.items.length < page.total || scanCapped)

  return (
    <TreeRow
      rowClassName='bg-primary-50 hover:bg-primary-100'
      icon={<ShareGroupIcon groupKey={group.groupKey} icon={group.icon} />}
      title={group.label}
      description={group.description ?? undefined}
      secondary={
        <span className='text-xs text-muted-foreground'>
          {group.count} {group.count === 1 ? 'item' : 'items'}
        </span>
      }
      expandable
      isOpen={isOpen}
      onToggleOpen={onToggleOpen}
      selectable={canRevoke && isOpen && selectableIds.length > 0}
      selecting={bulkMode && isOpen && selectableIds.length > 0}
      selected={groupSelected}
      onSelectChange={handleGroupSelect}
      selectLabel={`Select every loaded ${group.plural} row`}
      actions={
        canRevoke ? (
          <TreeRowButton
            variant='destructive'
            tooltipText={`Remove all ${group.plural} shared with this member`}
            onClick={() => onRemoveType(group)}>
            <Trash2 />
          </TreeRowButton>
        ) : undefined
      }>
      <TreeRowList
        items={page.items}
        loading={page.isLoading}
        skeletonCount={3}
        getKey={(item) => item.recordId}
        renderRow={(item) => (
          <MemberSharedLeafRow
            item={item}
            granterName={item.grantedById ? granterNames.get(item.grantedById) : undefined}
            canRevoke={canRevoke}
            onRemove={() => onRemoveOne(item, group)}
          />
        )}
      />

      {!page.isLoading && page.items.length === 0 && (
        <TreeRowEmpty
          depth={1}
          title={search ? 'No matches' : 'Nothing shared'}
          description={
            search
              ? `No ${group.plural} match your search.`
              : `Nothing in ${group.label.toLowerCase()} is shared with this member.`
          }
        />
      )}

      {showMatchCount && (
        <p className='px-2 py-1 pl-8 text-xs text-muted-foreground'>
          Showing {page.items.length} of {page.total} {page.total === 1 ? 'match' : 'matches'}
          {scanCapped ? ` in the ${searchScanCap} most recent.` : '.'}
        </p>
      )}

      {/*
        Explicit click, never a scroll sentinel: auto-loading rows underneath a
        select-all whose meaning changes on every load is a bad pairing (§6.5).
        Never while searching — the search lane is a bounded scan and returns no
        cursor, so its result set is complete as far as it goes.
      */}
      {!search && page.hasNextPage && (
        <Button
          variant='ghost'
          size='xs'
          className='mt-1 self-center text-muted-foreground'
          loading={page.isFetchingNextPage}
          onClick={() => void page.fetchNextPage()}>
          Load {MEMBER_SHARES_PAGE_SIZE} more
        </Button>
      )}
    </TreeRow>
  )
}

/** One share row (§6.2). Click toggles the checkbox; the chevron has no meaning here. */
function MemberSharedLeafRow({
  item,
  granterName,
  canRevoke,
  onRemove,
}: {
  item: MemberShareItem
  granterName: string | undefined
  canRevoke: boolean
  onRemove: () => void
}) {
  const bulkMode = useBulkMode()
  const selected = useIsSelected(item.recordId)
  const pending = useIsPending(item.recordId)
  const pendingLabel = usePendingLabel()
  const toggle = useListSelection((s) => s.toggle)

  const blocked = !!item.blockedReason
  const selectable = canRevoke && !blocked && !pending

  return (
    <TreeRow
      depth={1}
      rowClassName={blocked || pending ? 'opacity-60' : 'hover:bg-primary-100'}
      icon={<ShareGroupIcon groupKey={item.recordId.split(':')[0] ?? ''} icon={null} />}
      // A tombstone label is muted and italic — it names a KIND of thing that is
      // gone rather than a thing you can go look at. Styling stops at the label:
      // the row itself is fully live, because clearing an orphan row is one of
      // the genuinely useful things this tab does.
      title={
        item.targetMissing ? (
          <span className='italic text-muted-foreground'>{item.label}</span>
        ) : (
          item.label
        )
      }
      // The raw id stays reachable for support, in the tooltip rather than the
      // label — a cuid in the title tells the reader nothing.
      description={
        item.blockedReason ??
        (item.targetMissing ? `This target no longer exists. Id: ${item.targetId}` : undefined)
      }
      secondary={
        <span className='flex items-center gap-1.5'>
          <RungBadge level={LEVEL_OF_PERMISSION[displayPermissionOfRung(item.rung)]} />
          {pending ? (
            <span className='text-xs text-muted-foreground'>{pendingLabel}</span>
          ) : (
            <span className='text-xs text-muted-foreground'>
              {item.targetMissing ? `${item.targetId} · ` : ''}
              {granterName ? `by ${granterName} · ` : ''}
              {formatRelativeTime(item.createdAt, true)}
            </span>
          )}
        </span>
      }
      selectable={selectable}
      selecting={bulkMode && selectable}
      selected={selected}
      onSelectChange={(_next, e) => toggle(item.recordId, { shiftKey: e.shiftKey })}
      selectLabel={`Select ${item.label}`}
      onToggleOpen={selectable ? () => toggle(item.recordId) : undefined}
      actions={
        canRevoke ? (
          <TreeRowButton
            variant='destructive'
            disabled={blocked || pending}
            tooltipText={item.blockedReason ?? 'Remove this share'}
            onClick={onRemove}>
            <Trash2 />
          </TreeRowButton>
        ) : undefined
      }
    />
  )
}

interface MemberSharedTypeGroupProps {
  typeGrants: Array<{
    entityDefinitionId: string
    rung: string
    createdAt: Date
    label: string
    icon: { iconId: string; color: string } | null
  }>
  isOpen: boolean
  onToggleOpen: () => void
  onRemove: (entityDefinitionId: string, label: string) => void
  canRevoke: boolean
  /** Where the def grant is actually edited — the member's Permissions tab. */
  permissionsHref: string
}

/**
 * The pinned "Record types" group (decision 8).
 *
 * A type-level row is the LARGEST grant a member can hold, so hiding it would
 * make the tab lie about what they have; but it is a permissions decision rather
 * than a share, it is edited on the Permissions tab, and it has no
 * `entityInstanceId` and therefore no `RecordId` for a sweep to name. So: shown,
 * pinned first, individually revocable, and never selectable.
 */
export function MemberSharedTypeGroup({
  typeGrants,
  isOpen,
  onToggleOpen,
  onRemove,
  canRevoke,
  permissionsHref,
}: MemberSharedTypeGroupProps) {
  return (
    <TreeRow
      rowClassName='bg-primary-50 hover:bg-primary-100'
      icon={<ShieldCheck className='size-4' />}
      title='Record types'
      description='Access to every record of a type. Edited on the Permissions tab, and never included in a bulk removal.'
      secondary={
        <span className='text-xs text-muted-foreground'>
          {typeGrants.length} {typeGrants.length === 1 ? 'type' : 'types'}
        </span>
      }
      expandable
      isOpen={isOpen}
      onToggleOpen={onToggleOpen}
      actions={
        // `Link`, not a bare anchor: the target is the SAME page's Permissions
        // tab, so a full document load here would throw away the member query
        // and every open group on the way to a `?tab=` change.
        <Button variant='ghost' size='xs' asChild>
          <Link href={permissionsHref}>Permissions</Link>
        </Button>
      }>
      <TreeRowList
        items={typeGrants}
        getKey={(grant) => grant.entityDefinitionId}
        renderRow={(grant) => (
          <TreeRow
            depth={1}
            rowClassName='hover:bg-primary-100'
            icon={<ShareGroupIcon groupKey='record' icon={grant.icon} />}
            title={grant.label}
            secondary={
              <span className='flex items-center gap-1.5'>
                <Badge variant='secondary' size='sm'>
                  All records
                </Badge>
                <span className='text-xs text-muted-foreground'>
                  {formatRelativeTime(grant.createdAt, true)}
                </span>
              </span>
            }
            actions={
              canRevoke ? (
                <TreeRowButton
                  variant='destructive'
                  tooltipText='Remove this record-type grant'
                  onClick={() => onRemove(grant.entityDefinitionId, grant.label)}>
                  <Trash2 />
                </TreeRowButton>
              ) : undefined
            }
          />
        )}
      />
    </TreeRow>
  )
}
