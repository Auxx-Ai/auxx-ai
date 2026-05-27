// packages/chat/src/views/conversation/attachment-list.tsx
//
// Renders the attachment chips / image previews under a chat bubble. Each
// attachment carries metadata only; the download URL is resolved on render via
// `useAttachmentUrl`. Optimistic sends pass `objectUrl` so the visitor's own
// image previews instantly without a round trip.

import { File as FileIcon, FileImage, FileText, FileVideo } from 'lucide-react'
import { useAttachmentUrl } from '~/hooks/use-attachment-url'
import { cn } from '~/lib/cn'
import type { ChatAttachment } from '~/transport/chat-api'

interface AttachmentListProps {
  channelId: string
  items: ChatAttachment[]
  isUser: boolean
}

export function AttachmentList({ channelId, items, isUser }: AttachmentListProps) {
  if (items.length === 0) return null
  const images = items.filter((a) => isImage(a.mimeType))
  const files = items.filter((a) => !isImage(a.mimeType))
  return (
    <div className='mt-1 flex flex-col gap-1.5'>
      {images.length > 0 ? (
        <div className='flex flex-wrap gap-1.5'>
          {images.map((a) => (
            <AttachmentImage key={a.id} channelId={channelId} attachment={a} />
          ))}
        </div>
      ) : null}
      {files.length > 0 ? (
        <div className='flex flex-col gap-1.5'>
          {files.map((a) => (
            <AttachmentChip key={a.id} channelId={channelId} attachment={a} isUser={isUser} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function AttachmentImage({
  channelId,
  attachment,
}: {
  channelId: string
  attachment: ChatAttachment
}) {
  const { url, loading, error, retry } = useAttachmentUrl(channelId, attachment.id)
  const effectiveUrl = attachment.objectUrl ?? url
  if (effectiveUrl) {
    return (
      <a
        href={effectiveUrl}
        target='_blank'
        rel='noopener noreferrer'
        className='block overflow-hidden rounded-md'>
        <img
          src={effectiveUrl}
          alt={attachment.name}
          className='max-h-[200px] max-w-[200px] rounded-md object-cover'
          onError={attachment.objectUrl ? undefined : retry}
        />
      </a>
    )
  }
  if (error) {
    return (
      <button
        type='button'
        onClick={retry}
        className='rounded-md border border-destructive/40 bg-background/20 px-2 py-1 text-left text-[11px] hover:bg-background/30'>
        Couldn’t load image — click to retry.
      </button>
    )
  }
  return (
    <div
      className={cn('h-[120px] w-[160px] rounded-md bg-muted', loading ? 'animate-pulse' : '')}
      aria-label={`Loading ${attachment.name}`}
    />
  )
}

function AttachmentChip({
  channelId,
  attachment,
  isUser,
}: {
  channelId: string
  attachment: ChatAttachment
  isUser: boolean
}) {
  const { url, loading, error, retry } = useAttachmentUrl(channelId, attachment.id)
  const effectiveUrl = attachment.objectUrl ?? url
  const Icon = iconForMime(attachment.mimeType)

  const body = (
    <>
      <Icon className='size-4 shrink-0' aria-hidden='true' />
      <div className='flex min-w-0 flex-col text-left'>
        <span className='truncate text-xs font-medium'>{attachment.name}</span>
        <span className='text-[10px] opacity-70'>
          {formatBytes(attachment.size)}
          {error ? ' · click to retry' : loading && !effectiveUrl ? ' · loading…' : ''}
        </span>
      </div>
    </>
  )

  const classes = cn(
    'flex max-w-[260px] items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
    isUser
      ? 'bg-background/15 text-current hover:bg-background/25'
      : 'bg-background text-foreground hover:bg-muted'
  )

  if (error) {
    return (
      <button type='button' onClick={retry} className={classes}>
        {body}
      </button>
    )
  }
  if (!effectiveUrl) {
    return (
      <div className={cn(classes, 'cursor-default opacity-80')} aria-busy={loading}>
        {body}
      </div>
    )
  }
  return (
    <a
      href={effectiveUrl}
      target='_blank'
      rel='noopener noreferrer'
      download={attachment.name}
      className={classes}>
      {body}
    </a>
  )
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

function iconForMime(mimeType: string) {
  if (mimeType.startsWith('image/')) return FileImage
  if (mimeType.startsWith('video/')) return FileVideo
  if (mimeType.startsWith('text/') || mimeType === 'application/pdf') return FileText
  return FileIcon
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = size
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}
