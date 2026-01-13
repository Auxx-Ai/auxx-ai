// apps/web/src/components/fields/displays/display-file.tsx
import { useMemo } from 'react'
import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'
import { api } from '~/trpc/react'
import { Badge } from '@auxx/ui/components/badge'
import { FileIcon } from '~/components/files/utils/file-icon'
import { ItemsListView, type ItemsListItem } from '~/components/ui/items-list-view'

/** File item for ItemsListView */
interface FileItem extends ItemsListItem {
  name: string
  mimeType: string
}

/**
 * DisplayFile component
 * Renders file attachments in read-only mode
 */
export function DisplayFile() {
  const { value } = useFieldContext()

  // value structure: { attachmentIds: string[] | string }
  const attachmentIds = Array.isArray(value?.attachmentIds)
    ? value.attachmentIds
    : value?.attachmentIds
      ? [value.attachmentIds]
      : []

  const { data: attachments } = api.attachment.getByIds.useQuery(
    { ids: attachmentIds },
    { enabled: attachmentIds.length > 0 }
  )

  // Build file items for ItemsListView
  const fileItems = useMemo<FileItem[]>(() => {
    if (!attachments) return []
    return attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.asset.name || 'Untitled file',
      mimeType: attachment.asset.mimeType || 'application/octet-stream',
    }))
  }, [attachments])

  if (fileItems.length === 0) return null

  return (
    <DisplayWrapper>
      <ItemsListView
        items={fileItems}
        renderItem={(item) => (
          <a
            href={`/api/attachments/${item.id}/download`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}>
            <Badge variant="pill" shape="tag" className="flex items-center gap-1.5">
              <FileIcon mimeType={item.mimeType} className="size-4 text-gray-500 flex-shrink-0" />
              <span>{item.name}</span>
            </Badge>
          </a>
        )}
      />
    </DisplayWrapper>
  )
}
