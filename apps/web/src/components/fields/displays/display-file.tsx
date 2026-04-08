// apps/web/src/components/fields/displays/display-file.tsx

import { Badge } from '@auxx/ui/components/badge'
import { Skeleton } from '@auxx/ui/components/skeleton'
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

  const { data: fileDetails, isLoading } = api.file.resolveFileRefs.useQuery(
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

  if (isLoading && refs.length > 0) {
    return (
      <DisplayWrapper>
        <div className='flex flex-wrap gap-1.5'>
          {refs.map((ref) => (
            <div
              key={ref}
              className='flex h-5 items-center gap-1.5 rounded-[5px] bg-neutral-100 ps-0.5 pe-1.5 ring-1 ring-neutral-300 dark:bg-muted dark:ring-neutral-800'>
              <Skeleton className='size-4 rounded-full' />
              <Skeleton className='h-4 w-20 rounded-full' />
            </div>
          ))}
        </div>
      </DisplayWrapper>
    )
  }

  if (fileItems.length === 0) return null

  return (
    <DisplayWrapper>
      <ItemsListView
        items={fileItems}
        renderItem={(item) => (
          <Badge variant='pill' shape='tag' className='flex items-center gap-1.5'>
            <FileIcon mimeType={item.mimeType} className='size-4 flex shrink-0 text-gray-500' />
            <span>{item.name}</span>
          </Badge>
        )}
      />
    </DisplayWrapper>
  )
}
