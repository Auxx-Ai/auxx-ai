// apps/web/src/components/favorites/ui/favorite-item.tsx
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
import { DatasetItem } from './items/dataset-item'
import { DocumentItem } from './items/document-item'
import { EntityInstanceItem } from './items/entity-instance-item'
import { FileItem } from './items/file-item'
import { FolderItem } from './items/folder-item'
import { SnippetItem } from './items/snippet-item'
import { TableViewItem } from './items/table-view-item'
import { WorkflowItem } from './items/workflow-item'

/**
 * Dispatch a favorite row to the correct per-type renderer. Each renderer
 * resolves its own display data (via existing app-wide stores or lazy hooks),
 * its own loading/notFound states, and its own href.
 */
export function FavoriteItemDispatch({ favorite }: { favorite: FavoriteEntity }) {
  switch (favorite.targetType) {
    case 'ENTITY_INSTANCE':
      return <EntityInstanceItem favorite={favorite as FavoriteEntity<'ENTITY_INSTANCE'>} />
    case 'TABLE_VIEW':
      return <TableViewItem favorite={favorite as FavoriteEntity<'TABLE_VIEW'>} />
    case 'WORKFLOW':
      return <WorkflowItem favorite={favorite as FavoriteEntity<'WORKFLOW'>} />
    case 'SNIPPET':
      return <SnippetItem favorite={favorite as FavoriteEntity<'SNIPPET'>} />
    case 'FILE':
      return <FileItem favorite={favorite as FavoriteEntity<'FILE'>} />
    case 'FOLDER':
      return <FolderItem favorite={favorite as FavoriteEntity<'FOLDER'>} />
    case 'DATASET':
      return <DatasetItem favorite={favorite as FavoriteEntity<'DATASET'>} />
    case 'DOCUMENT':
      return <DocumentItem favorite={favorite as FavoriteEntity<'DOCUMENT'>} />
    default:
      return null
  }
}
