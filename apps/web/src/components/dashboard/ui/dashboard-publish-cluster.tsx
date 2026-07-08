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
// The chevron menu (Version history / Duplicate / Settings / Archive) is constant.
// In view mode with a parked draft the status pill doubles as a Live/Draft view
// toggle (via the shell's `pillOverride`): its label + dot show what the canvas is
// showing NOW, and clicking flips between the published version and the draft so
// "what am I looking at" is never ambiguous. Hidden in edit mode (always draft).

import type { DashboardWithLayout, WidgetKind } from '@auxx/lib/dashboards/client'
import { Button } from '@auxx/ui/components/button'
import { ButtonGroupSeparator } from '@auxx/ui/components/button-group'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
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

  const editSegment = (
    <Button
      size='xs'
      variant='outline'
      className='border-r-0'
      disabled={!hasPersisted}
      onClick={onEnterEdit}>
      <Pencil /> Edit
    </Button>
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
        publish={{ onClick: onPublish, isPending: isPublishing }}
        discard={{ onClick: () => void handleDiscard(), isPending: isDiscarding }}>
        <DropdownMenuItem onClick={() => setVersionsOpen(true)}>
          <History /> Version history
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleDuplicate()}>
          <Copy /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant='destructive' onClick={() => void handleArchive()}>
          <Archive /> Archive
        </DropdownMenuItem>
      </PublishClusterShell>

      <DashboardVersionsDialog
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        dashboardId={dashboard.id}
        activeVersionNumber={activeVersionNumber}
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
