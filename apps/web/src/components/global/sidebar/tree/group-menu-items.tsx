// apps/web/src/components/global/sidebar/tree/group-menu-items.tsx
'use client'

import { SIDEBAR_DEFAULT_LAYOUT_SETTING_KEY } from '@auxx/lib/sidebar-layout/client'
import { AnimatedGradientText } from '@auxx/ui/components/animated-gradient-text'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import {
  Check,
  Eye,
  EyeOff,
  FolderPlus,
  LayoutTemplate,
  ListRestart,
  Pencil,
  Plus,
  Save,
  Settings,
  SquarePlus,
  Trash2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useDemo } from '~/hooks/use-demo'
import { useSidebarShowHidden, useSidebarStateActions } from '~/hooks/use-sidebar-state'
import { useAccess } from '~/providers/capabilities-provider'
import {
  useDehydratedOrganizationId,
  useDehydratedStateContext,
} from '~/providers/dehydrated-state-provider'
import { useEntityActions } from './entity-actions'
import type { RenderGroup } from './sidebar-access'
import { useSidebarTree } from './sidebar-tree-context'

interface GroupMenuItemsProps {
  group: RenderGroup
  onRename: () => void
  onNewFolder: () => void
  onNewGroup: () => void
}

/** Group header menu: system-group extras, then group CRUD, then sidebar-wide actions. */
export function GroupMenuItems({ group, onRename, onNewFolder, onNewGroup }: GroupMenuItemsProps) {
  const { mutations, confirm } = useSidebarTree()
  const showHidden = useSidebarShowHidden()
  const { setShowHidden } = useSidebarStateActions()
  const { can } = useAccess()
  const { isDemo } = useDemo()
  const organizationId = useDehydratedOrganizationId()
  const { patchSettings } = useDehydratedStateContext()
  // Same gate the router asserts on saveOrgDefault (settingsManage, not demo).
  const canSaveDefault = can('settings.manage') && !isDemo

  const deleteGroup = async () => {
    const confirmed = await confirm({
      title: `Delete "${group.title}"?`,
      description: 'Its items move back to Workspace, Records and Favorites.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) void mutations.remove(group.key)
  }

  const resetLayout = async () => {
    const confirmed = await confirm({
      title: 'Reset sidebar to the workspace default?',
      description: 'Your groups, folders and order are replaced. Favorites are kept.',
      confirmText: 'Reset',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) void mutations.reset()
  }

  const saveDefault = async () => {
    const confirmed = await confirm({
      title: 'Save as workspace default?',
      description:
        'Members who have not customized their sidebar will see your layout. Favorites are not included.',
      confirmText: 'Save',
      cancelText: 'Cancel',
    })
    if (!confirmed) return
    try {
      const snapshot = await mutations.saveOrgDefault()
      if (organizationId) {
        patchSettings(organizationId, { [SIDEBAR_DEFAULT_LAYOUT_SETTING_KEY]: snapshot })
      }
    } catch (error) {
      toastError({
        title: 'Could not save workspace default',
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  return (
    <>
      {group.systemKey === 'records' && <RecordsExtras />}
      <DropdownMenuItem onClick={onRename}>
        <Pencil /> Rename
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onNewFolder}>
        <FolderPlus /> New folder
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onNewGroup}>
        <SquarePlus /> New group
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => void mutations.setHidden(group.key, !group.ownHidden)}>
        {group.ownHidden ? <Eye /> : <EyeOff />}
        {group.ownHidden ? 'Show group' : 'Hide group'}
      </DropdownMenuItem>
      {!group.systemKey && (
        <DropdownMenuItem variant='destructive' onClick={deleteGroup}>
          <Trash2 /> Delete group
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => setShowHidden(!showHidden)}>
        {showHidden ? <Check /> : <Eye />}
        Show hidden items
      </DropdownMenuItem>
      <DropdownMenuItem onClick={resetLayout}>
        <ListRestart /> Reset to default
      </DropdownMenuItem>
      {canSaveDefault && (
        <DropdownMenuItem onClick={saveDefault}>
          <Save /> Save as default
        </DropdownMenuItem>
      )}
    </>
  )
}

/** Records keeps its entity shortcuts: manage, create, create from template. */
function RecordsExtras() {
  const router = useRouter()
  const actions = useEntityActions()
  return (
    <>
      <DropdownMenuItem onClick={() => router.push('/app/settings/custom-fields')}>
        <Settings /> Manage Entities
      </DropdownMenuItem>
      <DropdownMenuItem onClick={actions.createEntity}>
        <Plus /> Create entity
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={actions.createFromTemplate}
        className='data-highlighted:bg-[#ffaa40]/10'>
        <LayoutTemplate className='text-[#ffaa40]' />{' '}
        <AnimatedGradientText>Create from template</AnimatedGradientText>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  )
}
