// apps/web/src/components/records/record-actions-menu.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { getRecordActions } from '@auxx/lib/resources/client'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { cn } from '@auxx/ui/lib/utils'
import {
  Archive,
  Expand,
  Link as LinkIcon,
  Merge,
  MoreVertical,
  Send,
  Share2,
  SquarePen,
  TextCursorInput,
  Trash2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { AppRecordActionsSubmenu } from '~/components/detail-view/components/app-record-actions'
import { GranularPermissionsGate } from '~/components/mail-permissions/ui/granular-permissions-gate'
import { MergeDialog } from '~/components/merge'
import { InstanceShareDialog } from '~/components/permissions/ui/instance-share-dialog'
import { RecordRequestAccessPopover } from '~/components/permissions/ui/record-request-access-popover'
import { useRecordAccess, useRecordLink, useResource } from '~/components/resources'
import { AddToSequenceDialog } from '~/components/sequences/ui/add-to-sequence-dialog'
import { WorkflowSubMenu } from '~/components/workflow/workflow-submenu'
import { useEntityInstanceOperations } from '~/hooks/use-entity-instance-operations'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { getRecordMenuActions } from './record-action-registry'

/**
 * Which surface is rendering the menu. Drives the trigger's shape and the two
 * items whose relevance depends on where you already are.
 */
export type RecordActionsSurface = 'page' | 'drawer' | 'row'

export interface RecordActionsMenuProps {
  recordId: RecordId
  /** ModelType from `resource.entityType` — `'entity'` for custom definitions. */
  entityType: string
  record?: Record<string, unknown>
  surface: RecordActionsSurface
  /**
   * Open this surface's record-editor dialog. The item hides when omitted, so a
   * surface without an editor doesn't advertise one — the editor's shape differs
   * per surface, which is why the menu takes a callback instead of owning it.
   */
  onEdit?: () => void
  /** Focus this surface's inline title input. Drawer-only; item hides when omitted. */
  onRename?: () => void
  /** Link this record to another. Item hides when omitted. */
  onLink?: () => void
  /** After a successful delete — close the drawer, navigate away from the page. */
  onDeleted?: () => void
  /**
   * Items this surface renders as its OWN control, outside the menu, so the
   * menu must not also offer them.
   *
   * The detail page promotes both: Share sits in the header beside the
   * shared-with avatars, and the access request is a labelled button (the ask
   * that ADDS capability should not be buried behind a kebab on the record's
   * own page). The drawer and the table row keep them in here, where there is
   * no room to promote anything.
   */
  omitItems?: RecordActionKey[]
  /** Extra items, rendered after the registry's custom ones and before the destructive group. */
  children?: React.ReactNode
}

/** Built-in items a surface may render itself instead — see `omitItems`. */
export type RecordActionKey = 'share' | 'request-access'

/**
 * Ghost buttons in a record header override their hover: `MainPage`'s background
 * is the same value as `ghost`'s own hover, so the default reads as nothing
 * happening. `data-[state=open]` holds the tint while a menu/dialog the button
 * owns is open. Exported so the sibling controls (Share, the favourite star)
 * match the menu trigger exactly.
 */
export const RECORD_HEADER_GHOST = 'hover:bg-foreground/10 data-[state=open]:bg-foreground/10'

const TRIGGER_BY_SURFACE: Record<
  RecordActionsSurface,
  { variant: 'outline' | 'ghost'; size: 'sm' | 'icon-sm' | 'icon-xs'; className?: string }
> = {
  page: { variant: 'ghost', size: 'icon-xs', className: RECORD_HEADER_GHOST },
  drawer: {
    variant: 'ghost',
    size: 'icon-xs',
    className: 'rounded-full data-[state=open]:bg-foreground/10',
  },
  // Hover-revealed, matching the surrounding `PrimaryCell` chrome.
  row: {
    variant: 'ghost',
    size: 'icon-xs',
    className:
      'rounded-md sm:opacity-0 sm:group-hover/primary:opacity-100 transition-opacity data-[state=open]:opacity-100!',
  },
}

/**
 * **The one record-action menu**, shared by the detail page, the record drawer
 * and the records-table row.
 *
 * Before this, each of the three surfaces hand-rolled its own list against its
 * own permission helpers and its own `actions` config, and they disagreed in
 * ways users could see: a contact was deletable from its table row but not from
 * its own detail page, "Run workflow" existed in the drawer and not on the page,
 * and half the detail page's buttons were `console.log` stubs (Archive, Delete,
 * Spam, Groups, Run Workflow) behind confirm dialogs that led nowhere.
 *
 * Two rules hold the consolidation together:
 *
 * 1. **Authorization is the per-ROW `_access` stamp**, resolved once by
 *    `useRecordAccess`. Config flags say what a record TYPE offers; they never
 *    say what a member may do. `canEdit` and `canDelete` are deliberately not
 *    one flag — delete is the edit floor PLUS the delete verb.
 * 2. **Favourite is not here.** Every surface renders `FavoriteStarButton`
 *    beside the trigger instead: it is the one control that reports state
 *    (filled = favourited), and state you have to open a menu to read is state
 *    you may as well not show.
 *
 * ⚠ Dialogs are siblings of `<DropdownMenu>`, never children of
 * `<DropdownMenuContent>` — Radix unmounts the content when the menu closes, and
 * selecting an item closes the menu, so a dialog mounted inside would be torn
 * down in the same tick it was opened.
 */
export function RecordActionsMenu({
  recordId,
  entityType,
  record,
  surface,
  onEdit,
  onRename,
  onLink,
  onDeleted,
  omitItems = [],
  children,
}: RecordActionsMenuProps) {
  const router = useRouter()
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  const { resource } = useResource(entityDefinitionId)
  const access = useRecordAccess(recordId)
  const { hasAccess } = useFeatureFlags()
  const sequencesEnabled = hasAccess(FeatureKey.sequences)
  const fullPageLink = useRecordLink(recordId)

  const omitted = new Set(omitItems)
  const actions = getRecordActions(entityType)
  const customItems = getRecordMenuActions(entityType, entityDefinitionId)

  const [mergeOpen, setMergeOpen] = React.useState(false)
  const [shareOpen, setShareOpen] = React.useState(false)
  const [sequenceOpen, setSequenceOpen] = React.useState(false)

  // The REAL archive/delete path, shared with the records table. Only the
  // handlers and their dialogs are taken — NOT this hook's `canEdit`, which is
  // the def-level `canEditEntity` and would undo the per-row gate above.
  const { handleArchive, handleDelete, ConfirmDeleteDialog, ConfirmArchiveDialog } =
    useEntityInstanceOperations({
      entityDefinitionId,
      resourceLabel: resource?.label,
      resourcePlural: resource?.plural,
      onDrawerClose: onDeleted,
      onRefetch: onDeleted,
    })

  const status = record?.status as string | undefined
  // A merged record is a tombstone — nothing here applies to it.
  if (status === 'MERGED') return null
  const isArchived = status === 'ARCHIVED'

  const trigger = TRIGGER_BY_SURFACE[surface]
  const noun = resource?.label?.toLowerCase() ?? 'record'

  return (
    <>
      {/* `modal={false}` so the menu doesn't lock scroll or steal focus from the
          page/drawer behind it.

          ⚠ NO tooltip on this trigger. Wrapping a `DropdownMenuTrigger` in a
          Radix tooltip leaves the tooltip mounted over the open menu — it hangs
          around because the trigger keeps hover/focus while the menu owns
          pointer events. The label lives on `aria-label` instead, which is what
          names the button for assistive tech anyway, and matches the drawer's
          and the table row's kebabs — neither ever had one. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant={trigger.variant}
            size={trigger.size}
            aria-label='More actions'
            title='More actions'
            className={cn(trigger.className)}>
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align='end' className='w-56'>
          {/* Ask for the next rung. FIRST on purpose: everything below is
              destructive-leaning and this is the one item that ADDS capability.
              Only at `read` — below that the surface never opened, and at
              `edit`/`admin` there is nothing left to ask for. */}
          {access.access === 'read' && !omitted.has('request-access') && (
            <GranularPermissionsGate>
              <RecordRequestAccessPopover
                entityDefinitionId={entityDefinitionId}
                entityInstanceId={entityInstanceId}
                variant='menu-item'
              />
            </GranularPermissionsGate>
          )}

          {actions.enableEdit && onEdit && access.canEdit && (
            <DropdownMenuItem onSelect={onEdit}>
              <SquarePen />
              Edit {noun}
            </DropdownMenuItem>
          )}

          {actions.enableRename && onRename && access.canEdit && (
            <DropdownMenuItem onSelect={onRename}>
              <TextCursorInput />
              Rename
            </DropdownMenuItem>
          )}

          {surface !== 'page' && fullPageLink && (
            <DropdownMenuItem onSelect={() => router.push(fullPageLink)}>
              <Expand />
              Open full page
            </DropdownMenuItem>
          )}

          {access.canShare && !omitted.has('share') && (
            <GranularPermissionsGate>
              <DropdownMenuItem onSelect={() => setShareOpen(true)}>
                <Share2 />
                Share
              </DropdownMenuItem>
            </GranularPermissionsGate>
          )}

          <DropdownMenuSeparator />

          {/* Neither submenu vanishes when empty. `WorkflowSubMenu` always
              carries a "Create workflow" item wired to this entity definition,
              so it is never a dead end; app actions disables its branch. A menu
              whose rows appear and disappear by org configuration is a menu
              nobody can learn. */}
          <WorkflowSubMenu recordId={recordId} />
          <AppRecordActionsSubmenu recordId={recordId} recordType={entityType} />

          {actions.enableAddToSequence && sequencesEnabled && access.canEdit && (
            <DropdownMenuItem onSelect={() => setSequenceOpen(true)}>
              <Send />
              Add to sequence
            </DropdownMenuItem>
          )}

          {actions.enableLink && onLink && access.canEdit && (
            <DropdownMenuItem onSelect={onLink}>
              <LinkIcon />
              Link {noun}
            </DropdownMenuItem>
          )}

          {/* ⚠ Merge rides the DELETE verb, not the edit floor: it permanently
              removes the source rows and the server asserts `assertCanDeleteRows`
              over the target AND every source. */}
          {actions.enableMerge && access.canDelete && (
            <DropdownMenuItem onSelect={() => setMergeOpen(true)}>
              <Merge />
              Merge
            </DropdownMenuItem>
          )}

          {customItems.map((Item, i) => (
            <Item
              key={i}
              recordId={recordId}
              entityDefinitionId={entityDefinitionId}
              entityInstanceId={entityInstanceId}
              entityType={entityType}
              record={record}
              resource={resource}
              access={access}
            />
          ))}
          {children}

          {actions.enableArchive && access.canEdit && !isArchived && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void handleArchive(entityInstanceId)}>
                <Archive />
                Archive
              </DropdownMenuItem>
            </>
          )}

          {access.canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant='destructive'
                onSelect={() => void handleDelete(entityInstanceId)}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmArchiveDialog />
      <ConfirmDeleteDialog />

      {mergeOpen && (
        <MergeDialog
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          baseRecordIds={[recordId]}
          onMergeComplete={() => setMergeOpen(false)}
        />
      )}

      {shareOpen && (
        <InstanceShareDialog recordId={recordId} open={shareOpen} onOpenChange={setShareOpen} />
      )}

      {sequencesEnabled && sequenceOpen && (
        <AddToSequenceDialog
          open={sequenceOpen}
          onOpenChange={setSequenceOpen}
          recipientEntityInstanceIds={[entityInstanceId]}
        />
      )}
    </>
  )
}
