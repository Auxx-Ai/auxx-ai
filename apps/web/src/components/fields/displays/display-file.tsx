// apps/web/src/components/fields/displays/display-file.tsx

import type { FileValue } from '@auxx/lib/field-values/client'
import { type FileRef, getFileRefDownloadUrl } from '@auxx/types/file-ref'
import { Badge } from '@auxx/ui/components/badge'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { EyeOff } from 'lucide-react'
import { useMemo } from 'react'
import { FileIcon } from '~/components/files/utils/file-icon'
import { type ItemsListItem, ItemsListView } from '~/components/ui/items-list-view'
import { api } from '~/trpc/react'
import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'

/** File item for ItemsListView — carries caption/internal through from the FILE envelope
 * (`{ ref, caption?, internal? }`, plans/dispatch/37b-scouting-quote-photos.md §2). */
interface DisplayFileItem extends ItemsListItem {
  ref: string
  name: string
  mimeType: string
  caption?: string
  internal?: boolean
}

/**
 * DisplayFile component
 * Renders file references in read-only mode.
 * value is now an array of { ref: "asset:xxx", caption?, internal? } objects (FILE is in
 * ARRAY_RETURN_FIELD_TYPES).
 */
export function DisplayFile() {
  const { value } = useFieldContext()

  // Extract refs + envelope metadata from the multi-value array
  const envelopes = useMemo(() => {
    if (!Array.isArray(value)) return []
    return (value as FileValue[]).filter((v) => v?.ref)
  }, [value])
  const refs = useMemo(() => envelopes.map((v) => v.ref), [envelopes])

  const { data: fileDetails, isLoading } = api.file.resolveFileRefs.useQuery(
    { refs },
    { enabled: refs.length > 0 }
  )
  // Build file items for ItemsListView
  const fileItems = useMemo<DisplayFileItem[]>(() => {
    if (!fileDetails) return []
    const envelopeMap = new Map(envelopes.map((v) => [v.ref, v]))
    return fileDetails.map((detail) => ({
      id: detail.ref,
      ref: detail.ref,
      name: detail.name,
      mimeType: detail.mimeType || 'application/octet-stream',
      caption: envelopeMap.get(detail.ref)?.caption,
      internal: envelopeMap.get(detail.ref)?.internal,
    }))
  }, [fileDetails, envelopes])

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
        renderItem={(itemValue) => {
          // `ItemsListView` also supports primitive items (see its doc comment); FILE
          // fields always pass full `DisplayFileItem` objects.
          const item = itemValue as DisplayFileItem
          return item.mimeType.startsWith('image/') ? (
            <PhotoThumbnail item={item} />
          ) : (
            <span className='inline-flex items-center gap-1'>
              <Badge variant='pill' shape='tag' className='flex items-center gap-1.5'>
                <FileIcon mimeType={item.mimeType} className='size-4 flex shrink-0 text-gray-500' />
                <span>{item.name}</span>
                {item.caption && <span className='text-muted-foreground'>· {item.caption}</span>}
              </Badge>
              {item.internal && (
                <Badge variant='secondary' size='xs' className='gap-1'>
                  <EyeOff className='size-3' />
                  Internal
                </Badge>
              )}
            </span>
          )
        }}
      />
    </DisplayWrapper>
  )
}

/** Thumbnail + caption fine print for an image photo, with an "Internal" corner badge
 * when the photo is hidden from the customer. */
function PhotoThumbnail({ item }: { item: DisplayFileItem }) {
  return (
    <div className='flex w-16 flex-col gap-0.5' title={item.name}>
      <div className='relative size-16 shrink-0 overflow-hidden rounded-md ring-1 ring-neutral-300 dark:ring-neutral-800'>
        <img
          src={getFileRefDownloadUrl(item.ref as FileRef)}
          alt={item.caption || item.name}
          className='size-full object-cover'
          loading='lazy'
        />
        {item.internal && (
          <span
            title='Internal — hidden from customer'
            className='absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-background/90 text-muted-foreground ring-1 ring-neutral-300 dark:ring-neutral-800'>
            <EyeOff className='size-2.5' />
          </span>
        )}
      </div>
      {item.caption && (
        <span className='truncate text-[11px] text-muted-foreground'>{item.caption}</span>
      )}
    </div>
  )
}
