// apps/web/src/components/fields/displays/display-file.tsx

import { Badge } from '@auxx/ui/components/badge'
import { useMemo } from 'react'
import { FileIcon } from '~/components/files/utils/file-icon'
import { type ItemsListItem, ItemsListView } from '~/components/ui/items-list-view'
import { api } from '~/trpc/react'
import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'

/** File item for ItemsListView */
interface DisplayFileItem extends ItemsListItem {
  name: string
  mimeType: string
}

/**
 * DisplayFile component
 * Renders file references in read-only mode.
 * value is now an array of { ref: "asset:xxx" } objects (FILE is in ARRAY_RETURN_FIELD_TYPES).
 */
export function DisplayFile() {
  const { value } = useFieldContext()

  // Extract refs from multi-value array
  const refs = useMemo(() => {
    if (!Array.isArray(value)) return []
    return value.filter((v: any) => v?.ref).map((v: any) => v.ref as string)
  }, [value])

  const { data: fileDetails } = api.file.resolveFileRefs.useQuery(
    { refs },
    { enabled: refs.length > 0 }
  )

  // Build file items for ItemsListView
  const fileItems = useMemo<DisplayFileItem[]>(() => {
    if (!fileDetails) return []
    return fileDetails.map((detail) => ({
      id: detail.ref,
      name: detail.name,
      mimeType: detail.mimeType || 'application/octet-stream',
    }))
  }, [fileDetails])

  if (fileItems.length === 0) return null

  return (
    <DisplayWrapper>
      <ItemsListView
        items={fileItems}
        renderItem={(item) => (
          <Badge variant='pill' shape='tag' className='flex items-center gap-1.5'>
            <FileIcon mimeType={item.mimeType} className='size-4 flex-shrink-0 text-gray-500' />
            <span>{item.name}</span>
          </Badge>
        )}
      />
    </DisplayWrapper>
  )
}
