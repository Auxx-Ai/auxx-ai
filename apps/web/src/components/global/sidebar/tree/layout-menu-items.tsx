// apps/web/src/components/global/sidebar/tree/layout-menu-items.tsx
'use client'

import { isFavoriteTargetType } from '@auxx/lib/sidebar-layout/client'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { BookmarkX, Eye, EyeOff, Folder, FolderInput, PanelLeft } from 'lucide-react'
import { Fragment } from 'react'
import { useRemoveFavorite } from '~/components/favorites/hooks/use-remove-favorite'
import type { RenderFolder, RenderItem } from './sidebar-access'
import { sidebarParentAccepts } from './sidebar-drop-rules'
import { useSidebarNodes } from './sidebar-nodes-provider'
import { selectSidebarLayout } from './sidebar-nodes-store'
import { useSidebarTree } from './sidebar-tree-context'

/** The layout section of a row menu: Move to…, then Hide/Show or Remove from favorites. */
export function LayoutMenuItems({ node }: { node: RenderItem | RenderFolder }) {
  const { tree, mutations } = useSidebarTree()
  const isFavorite = node.kind === 'ITEM' && isFavoriteTargetType(node.targetType)
  const removeFavorite = useRemoveFavorite(node.nodeId ?? '')
  // The full layout, so a folder's hidden children still count for the Favorites rule.
  const layout = useSidebarNodes(selectSidebarLayout)
  const accepts = (parentKey: string) => sidebarParentAccepts(layout, parentKey, node.key)

  const moveTo = (parentId: string) => void mutations.move({ nodeId: node.key, parentId })

  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <FolderInput /> Move to…
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className='w-48'>
          {tree.groups.map((group) => (
            <Fragment key={group.key}>
              {accepts(group.key) && (
                <DropdownMenuItem
                  disabled={node.parentKey === group.key}
                  onClick={() => moveTo(group.key)}>
                  <PanelLeft /> {group.title}
                </DropdownMenuItem>
              )}
              {node.kind === 'ITEM' &&
                group.children.map((child) =>
                  child.kind === 'FOLDER' && accepts(child.key) ? (
                    <DropdownMenuItem
                      key={child.key}
                      className='ps-6'
                      disabled={node.parentKey === child.key}
                      onClick={() => moveTo(child.key)}>
                      <Folder /> {child.title}
                    </DropdownMenuItem>
                  ) : null
                )}
            </Fragment>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {isFavorite ? (
        <DropdownMenuItem onClick={removeFavorite}>
          <BookmarkX /> Remove from favorites
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem onClick={() => void mutations.setHidden(node.key, !node.ownHidden)}>
          {node.ownHidden ? <Eye /> : <EyeOff />}
          {node.ownHidden ? 'Show in sidebar' : 'Hide from sidebar'}
        </DropdownMenuItem>
      )}
    </>
  )
}
