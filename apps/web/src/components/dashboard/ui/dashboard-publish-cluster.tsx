// apps/web/src/components/dashboard/ui/dashboard-publish-cluster.tsx
'use client'

// The dashboard detail-header status cluster — a PublishClusterShell consumer.
// Dashboards have no draft/live split (Save in edit mode publishes a new version
// immediately), so the pill is always "Live" and there are no Publish/Discard
// segments. Instead the shell's `extraSegments` slot carries the mode-specific
// controls so EVERYTHING lives in one ButtonGroup (like the article cluster):
//   • view mode — the Edit button, right after the pill.
//   • edit mode — Add widget ▾, then icon-only Cancel (X) and Save (✓).
// The chevron menu (Version history / Duplicate / Settings / Archive) stays put
// in both modes.

import type { DashboardWithLayout, WidgetKind } from '@auxx/lib/dashboards/client'
import { Button } from '@auxx/ui/components/button'
import { ButtonGroupSeparator } from '@auxx/ui/components/button-group'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { Archive, Check, ChevronDown, Copy, History, Pencil, Plus, Settings, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { PublishClusterShell } from '~/components/versioning/ui/publish-cluster-shell'
import { useConfirm } from '~/hooks/use-confirm'
import { useDashboardMutations } from '../hooks/use-dashboard-mutations'
import { AddWidgetMenu } from './config/add-widget-menu'
import { DashboardFormDialog } from './dashboard-form-dialog'
import { DashboardVersionsDialog } from './dashboard-versions-dialog'

const PILL_TOOLTIP = 'This dashboard is live. Editing and saving publishes a new version.'

export interface DashboardPublishClusterProps {
  dashboard: DashboardWithLayout
  activeVersionNumber: number | null
  /** When true the cluster shows the edit controls (Add widget / Cancel / Save). */
  isEditMode: boolean
  /** Dirty draft — gates Save and drives the Cancel confirm. */
  isDirty: boolean
  /** Save in flight — spins the ✓ button. */
  isSaving: boolean
  /** No persisted version yet — disables Edit. */
  hasPersisted: boolean
  onEnterEdit: () => void
  onCancel: () => void
  onSave: () => void
  onAddWidget: (kind: WidgetKind) => void
}

export function DashboardPublishCluster({
  dashboard,
  activeVersionNumber,
  isEditMode,
  isDirty,
  isSaving,
  hasPersisted,
  onEnterEdit,
  onCancel,
  onSave,
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
      <SimpleTooltip content='Cancel'>
        <Button
          size='xs'
          variant='outline'
          className='border-r-0 px-1.5'
          onClick={onCancel}
          aria-label='Cancel'>
          <X />
        </Button>
      </SimpleTooltip>
      <ButtonGroupSeparator />
      <SimpleTooltip content='Save'>
        <Button
          size='xs'
          variant='outline'
          className='border-r-0 px-1.5'
          loading={isSaving}
          loadingText=''
          disabled={!isDirty}
          onClick={onSave}
          aria-label='Save'>
          <Check />
        </Button>
      </SimpleTooltip>
    </>
  )

  return (
    <>
      <PublishClusterShell
        status={{ isPublished: true, hasUnsaved: false }}
        pillTooltip={PILL_TOOLTIP}
        extraSegments={isEditMode ? editModeSegments : editSegment}>
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
    </>
  )
}
