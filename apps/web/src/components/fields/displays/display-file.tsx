// apps/web/src/components/fields/displays/display-file.tsx

import type { FileValue } from '@auxx/lib/field-values/client'
import { type FileRef, getFileRefDownloadUrl } from '@auxx/types/file-ref'
import { Badge } from '@auxx/ui/components/badge'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { EyeOff, Loader2 } from 'lucide-react'
import { useMemo } from 'react'
import {
  type FieldUploadingFile,
  useFieldUploadingFiles,
} from '~/components/fields/inputs/hooks/use-field-uploading-files'
import { FileIcon } from '~/components/files/utils/file-icon'
import { useFileRefs } from '~/components/resources'
import { type ItemsListItem, ItemsListView } from '~/components/ui/items-list-view'
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
  const ctx = useFieldContext()
  const { value, field } = ctx
  // `DisplayOnlyProvider` carries no record (previews, exports). No record means no
  // upload session, so the hook is handed an id that can never match one.
  const recordId = 'recordId' in ctx ? ctx.recordId : ''

  // In-flight uploads render a badge IMMEDIATELY — their names come from the local
  // `File`, so nothing waits on the value round-trip or on `resolveFileRefs`.
  // Without this, picking a file showed nothing at all until both had landed.
  const uploadingFiles = useFieldUploadingFiles(recordId, field?.id ?? '')

  // Extract refs + envelope metadata from the multi-value array
  const envelopes = useMemo(() => {
    if (!Array.isArray(value)) return []
    return (value as FileValue[]).filter((v) => v?.ref)
  }, [value])
  const refs = useMemo(() => envelopes.map((v) => v.ref), [envelopes])

  const { details, isLoading } = useFileRefs(refs)

  // Build file items for ItemsListView
  const fileItems = useMemo<DisplayFileItem[]>(() => {
    const envelopeMap = new Map(envelopes.map((v) => [v.ref, v]))
    return details.map((detail) => ({
      id: detail.ref,
      ref: detail.ref,
      name: detail.name,
      mimeType: detail.mimeType || 'application/octet-stream',
      caption: envelopeMap.get(detail.ref)?.caption,
      internal: envelopeMap.get(detail.ref)?.internal,
    }))
  }, [details, envelopes])

  if (isLoading && refs.length > 0) {
    return (
      <DisplayWrapper>
        <div className='flex flex-wrap gap-1.5'>
          {uploadingFiles.map((f) => (
            <UploadingBadge key={f.id} file={f} />
          ))}
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

  // An upload with no saved value yet still owns a row.
  if (fileItems.length === 0) {
    if (uploadingFiles.length === 0) return null
    return (
      <DisplayWrapper>
        <div className='flex flex-wrap gap-1.5'>
          {uploadingFiles.map((f) => (
            <UploadingBadge key={f.id} file={f} />
          ))}
        </div>
      </DisplayWrapper>
    )
  }

  return (
    <DisplayWrapper>
      {uploadingFiles.length > 0 && (
        <div className='mb-1.5 flex flex-wrap gap-1.5'>
          {uploadingFiles.map((f) => (
            <UploadingBadge key={f.id} file={f} />
          ))}
        </div>
      )}
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

/**
 * The badge an upload owns while it is still in flight.
 *
 * Deliberately the same pill shape a saved file gets, so the row does not reflow
 * when the real item replaces it — only the spinner and the muted name change.
 */
function UploadingBadge({ file }: { file: FieldUploadingFile }) {
  return (
    <Badge variant='pill' shape='tag' className='flex items-center gap-1.5' title={file.name}>
      <Loader2 className='size-3 shrink-0 animate-spin text-muted-foreground' />
      <span className='max-w-32 truncate text-muted-foreground'>{file.name}</span>
      {file.progress > 0 && file.progress < 100 && (
        <span className='tabular-nums text-[10px] text-muted-foreground'>
          {Math.round(file.progress)}%
        </span>
      )}
    </Badge>
  )
}
