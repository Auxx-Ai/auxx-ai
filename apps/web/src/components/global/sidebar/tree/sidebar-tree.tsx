// apps/web/src/components/global/sidebar/tree/sidebar-tree.tsx
'use client'

import { SidebarGroup } from '@auxx/ui/components/sidebar'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Eye, EyeOff } from 'lucide-react'
import { type ReactNode, useCallback, useMemo } from 'react'
import { SIDEBAR_MENU } from '~/constants/menu'
import { useConfirm } from '~/hooks/use-confirm'
import { useIsSelfHosted } from '~/hooks/use-deployment-mode'
import { useSidebarShowHidden, useSidebarStateActions } from '~/hooks/use-sidebar-state'
import { useAccess } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { EntityActionsProvider } from './entity-actions'
import { entityAccessFor, filterSidebarLayout, resolveNavEntry } from './sidebar-access'
import { sidebarSortableId } from './sidebar-drop-rules'
import { useSidebarNodes } from './sidebar-nodes-provider'
import { selectSidebarLayout } from './sidebar-nodes-store'
import { SidebarTreeContext } from './sidebar-tree-context'
import { SidebarTreeGroup } from './sidebar-tree-group'
import { useSidebarMutations } from './use-sidebar-mutations'

/** Everything below Mail: groups → folders → items, rearranged by drag and drop. */
export function SidebarTree({ navActions }: { navActions: Record<string, () => ReactNode> }) {
  const layout = useSidebarNodes(selectSidebarLayout)
  const resourceNav = useSidebarNodes((s) => s.resourceNav)
  const showHidden = useSidebarShowHidden()
  const { setShowHidden } = useSidebarStateActions()
  const { hasAccess } = useFeatureFlags()
  const { can, hasDefPresence } = useAccess()
  const selfHosted = useIsSelfHosted()
  const mutations = useSidebarMutations()
  const [confirm, ConfirmDialog] = useConfirm()

  const defs = useMemo(
    () => (resourceNav ? new Map(resourceNav.map((d) => [d.id, d])) : null),
    [resourceNav]
  )
  const navEntry = useCallback(
    (navId: string) => resolveNavEntry(SIDEBAR_MENU, navId, { hasAccess, can, selfHosted }),
    [hasAccess, can, selfHosted]
  )
  const tree = useMemo(
    () =>
      filterSidebarLayout(layout, {
        showHidden,
        navEntry,
        entity: (id) => entityAccessFor(id, defs, hasAccess, hasDefPresence),
      }),
    [layout, showHidden, navEntry, defs, hasAccess, hasDefPresence]
  )
  const context = useMemo(
    () => ({ tree, mutations, navActions, confirm }),
    [tree, mutations, navActions, confirm]
  )
  const groupIds = tree.groups.map((g) => sidebarSortableId(g.key))

  return (
    <SidebarTreeContext.Provider value={context}>
      <EntityActionsProvider>
        <SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
          {tree.groups.map((group) => (
            <SidebarTreeGroup key={group.key} group={group} />
          ))}
        </SortableContext>
        {/* Show hidden normally lives in a group's menu; with every group hidden there is none left. */}
        {(showHidden || (tree.groups.length === 0 && tree.hasHidden)) && (
          <SidebarGroup>
            <button
              type='button'
              onClick={() => setShowHidden(!showHidden)}
              className='flex h-7 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-sidebar-accent [&_svg]:size-3.5'>
              {showHidden ? <EyeOff /> : <Eye />}
              {showHidden ? 'Hide hidden items' : 'Show hidden items'}
            </button>
          </SidebarGroup>
        )}
        <ConfirmDialog />
      </EntityActionsProvider>
    </SidebarTreeContext.Provider>
  )
}
