// apps/web/src/components/dashboard/ui/dashboard-publish-cluster.tsx
'use client'

// The dashboard detail-header status cluster — a PublishClusterShell consumer,
// now on the agent versioning model. The pill is emerald "Live" when the draft
// matches the active version and amber "Live · unsaved" when it diverges
// (`hasUnpublishedChanges`). Edits auto-save; the shell's Publish/Discard segments
// drive versioning:
//   • Publish (Send)  — shows when there are unpublished changes.
//   • Discard (Undo)  — shows when there are unpublished changes (confirm first).
// `extraSegments` carries the mode controls in the same ButtonGroup:
//   • view mode — the Edit button.
//   • edit mode — Add widget ▾, then Done (exit edit; the draft stays parked).
// The chevron menu holds Version history (Read) / Duplicate (`dashboards.manage`)
// / Settings + Archive (Full per instance); each entry renders only at its tier,
// so the menu shrinks rather than 403-ing (hide-don't-disable, doc 24 §A.2.3).
// In view mode with a parked draft the status pill doubles as a Live/Draft view
// toggle (via the shell's `pillOverride`): its label + dot show what the canvas is
// showing NOW, and clicking flips between the published version and the draft so
// "what am I looking at" is never ambiguous. Hidden in edit mode (always draft).

import type { DashboardWithLayout, WidgetKind } from '@auxx/lib/dashboards/client'
import { Button } from '@auxx/ui/components/button'
import { ButtonGroupSeparator } from '@auxx/ui/components/button-group'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { Archive, Check, ChevronDown, Copy, History, Pencil, Plus, Settings } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { PublishClusterShell } from '~/components/versioning/ui/publish-cluster-shell'
import { useConfirm } from '~/hooks/use-confirm'
import { useDashboardMutations } from '../hooks/use-dashboard-mutations'
import type { SaveState, ViewLayer } from '../stores/dashboard-draft-store'
import { AddWidgetMenu } from './config/add-widget-menu'
import { DashboardFormDialog } from './dashboard-form-dialog'
import { DashboardVersionsDialog } from './dashboard-versions-dialog'

const PILL_TOOLTIP =
  'This dashboard is live. Edits auto-save to a draft; Publish makes them the live version.'

export interface DashboardPublishClusterProps {
  dashboard: DashboardWithLayout
  activeVersionNumber: number | null
  /** When true the cluster shows the edit controls (Add widget / Done). */
  isEditMode: boolean
  /** Draft diverges from the active version — drives the pill + Publish/Discard. */
  hasUnpublishedChanges: boolean
  /** Publish in flight. */
  isPublishing: boolean
  /** Discard in flight. */
  isDiscarding: boolean
  /** Auto-save status — a subtle indicator while editing. */
  saveState: SaveState
  /** No persisted version yet — disables Edit. */
  hasPersisted: boolean
  /**
   * Edit-instance on this dashboard — gates Edit / Add widget / Done and the
   * Publish/Discard segments, plus every write in the version-history dialog.
   */
  canEdit: boolean
  /** Admin-instance (Full) — gates Settings and Archive. */
  canAdmin: boolean
  /** Coarse `dashboards.manage` — gates Duplicate (it CREATES a dashboard). */
  canCreate: boolean
  /**
   * Set ⇒ a Kopilot turn holds this dashboard's draft, and this sentence says
   * so. Every WRITE in this cluster is disabled for the span of the turn, and
   * unlike `canEdit` these are DISABLED rather than hidden: the user has the
   * rung, they are being asked to wait, and a button that silently vanishes
   * mid-turn reads as a bug.
   *
   * The canvas clamp does not reach these on its own: Edit, Publish, Discard
   * and the version-history writes all live in view mode, so they are not
   * downstream of `isEditMode`. Publishing mid-turn snapshots a half-written
   * dashboard into an immutable version; Discard and version-restore rewrite
   * the draft under the running agent.
   *
   * Read-only affordances (the version-history dialog itself, Duplicate,
   * Settings, Archive) stay live: none of them touch this draft.
   */
  lockedReason?: string
  /** View-mode canvas layer — drives the Live/Draft toggle. */
  viewLayer: ViewLayer
  onViewLayerChange: (layer: ViewLayer) => void
  onEnterEdit: () => void
  onExitEdit: () => void
  onPublish: () => void
  onDiscard: () => void
  onAddWidget: (kind: WidgetKind) => void
}

export function DashboardPublishCluster({
  dashboard,
  activeVersionNumber,
  isEditMode,
  hasUnpublishedChanges,
  isPublishing,
  isDiscarding,
  saveState,
  hasPersisted,
  canEdit,
  canAdmin,
  canCreate,
  lockedReason,
  viewLayer,
  onViewLayerChange,
  onEnterEdit,
  onExitEdit,
  onPublish,
  onDiscard,
  onAddWidget,
}: DashboardPublishClusterProps) {
  const router = useRouter()
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()

  const { duplicateDashboard, deleteDashboard } = useDashboardMutations()

  const handleDuplicate = async () => {
    const created = await duplicateDashboard(dashboard.id)
    if (created) router.push(`/app/dashboards/${created.id}`)
  }

  const handleArchive = async () => {
    const ok = await confirm({
      title: 'Archive dashboard?',
      description: `"${dashboard.name}" will be removed from your dashboards.`,
      confirmText: 'Archive',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    if (await deleteDashboard(dashboard.id)) router.push('/app/dashboards')
  }

  const handleDiscard = async () => {
    const ok = await confirm({
      title: 'Discard changes?',
      description:
        'Your unpublished changes will be reverted to the current live version. This cannot be undone.',
      confirmText: 'Discard',
      cancelText: 'Keep editing',
      destructive: true,
    })
    if (ok) onDiscard()
  }

  // Read-only members get no Edit entry point at all — hide, don't disable.
  // A held Kopilot turn is the opposite case: the member HAS the rung and is
  // being asked to wait, so the button stays and says why.
  const editButton = canEdit ? (
    <Button
      size='xs'
      variant='outline'
      className='border-r-0'
      disabled={!hasPersisted || !!lockedReason}
      onClick={onEnterEdit}>
      <Pencil /> Edit
    </Button>
  ) : null

  const editSegment =
    editButton && lockedReason ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex'>{editButton}</span>
        </TooltipTrigger>
        <TooltipContent>{lockedReason}</TooltipContent>
      </Tooltip>
    ) : (
      editButton
    )

  const editModeSegments = (
    <>
      <AddWidgetMenu
        onAdd={onAddWidget}
        trigger={
          <Button size='xs' variant='outline' className='border-r-0'>
            <Plus /> Add widget <ChevronDown />
          </Button>
        }
      />
      <ButtonGroupSeparator />
      <Button size='xs' variant='outline' className='border-r-0' onClick={onExitEdit}>
        <Check /> Done
      </Button>
    </>
  )

  // View mode + a parked draft → the status pill doubles as a live/draft view
  // toggle: its label + dot show what the canvas is showing NOW, clicking flips it.
  // Hidden while editing (edit is always the draft) and when nothing is parked
  // (then the pill keeps its default "open menu" behaviour).
  const viewingDraft = viewLayer === 'draft'
  const pillOverride =
    !isEditMode && hasUnpublishedChanges
      ? {
          label: viewingDraft ? 'Draft' : 'Live',
          dotClassName: viewingDraft ? 'bg-amber-500' : 'bg-emerald-500',
          onClick: () => onViewLayerChange(viewingDraft ? 'live' : 'draft'),
          tooltip: viewingDraft
            ? 'Showing your unpublished draft. Click to see the live version.'
            : 'Showing the live version. Click to preview your unpublished draft.',
        }
      : undefined

  return (
    <div className='flex items-center gap-2'>
      {isEditMode && <AutosaveIndicator state={saveState} />}
      <PublishClusterShell
        status={{ isPublished: true, hasUnsaved: hasUnpublishedChanges }}
        pillTooltip={PILL_TOOLTIP}
        pillOverride={pillOverride}
        // While editing, the autosave indicator conveys status — drop the pill.
        hidePill={isEditMode}
        extraSegments={isEditMode ? editModeSegments : editSegment}
        // Publish/Discard are Edit — omitting the slots drops the segments.
        publish={
          canEdit
            ? {
                onClick: onPublish,
                isPending: isPublishing,
                ...(lockedReason ? { disabledReason: lockedReason } : {}),
              }
            : undefined
        }
        discard={
          canEdit
            ? {
                onClick: () => void handleDiscard(),
                isPending: isDiscarding,
                ...(lockedReason ? { disabledReason: lockedReason } : {}),
              }
            : undefined
        }>
        {/* Version history itself is Read (`listVersions`); the dialog's own
            writes are gated by `canEdit`. */}
        <DropdownMenuItem onClick={() => setVersionsOpen(true)}>
          <History /> Version history
        </DropdownMenuItem>
        {canCreate && (
          <DropdownMenuItem onClick={() => void handleDuplicate()}>
            <Copy /> Duplicate
          </DropdownMenuItem>
        )}
        {canAdmin && (
          <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
            <Settings /> Settings
          </DropdownMenuItem>
        )}
        {canAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant='destructive' onClick={() => void handleArchive()}>
              <Archive /> Archive
            </DropdownMenuItem>
          </>
        )}
      </PublishClusterShell>

      <DashboardVersionsDialog
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        dashboardId={dashboard.id}
        activeVersionNumber={activeVersionNumber}
        // Restore / delete / rename all write. A turn holds the draft, so they
        // wait with everything else.
        canEdit={canEdit && !lockedReason}
      />
      <DashboardFormDialog
        dashboard={dashboard}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
      <ConfirmDialog />
    </div>
  )
}

/** Subtle auto-save status, shown in the header while editing. */
function AutosaveIndicator({ state }: { state: SaveState }) {
  const label =
    state === 'saving'
      ? 'Saving…'
      : state === 'saved'
        ? 'Saved'
        : state === 'error'
          ? 'Save failed'
          : null
  if (!label) return null
  return (
    <span
      className={state === 'error' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
      {label}
    </span>
  )
}
