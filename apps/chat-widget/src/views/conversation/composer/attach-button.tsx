// apps/chat-widget/src/views/conversation/composer/attach-button.tsx
//
// Hidden file input + ghost icon trigger. Uploads via POST /api/chat/attachments
// and surfaces in-flight + uploaded thumbnails to the composer for inline
// preview. The composer is responsible for forwarding the resulting asset ids
// to the send endpoint via `attachmentIds[]`.

import { Paperclip, X } from 'lucide-react'
import { useCallback, useRef } from 'preact/hooks'
import { cn } from '~/lib/cn'
import { getChatPassport } from '~/transport/passport'

export interface UploadedAttachment {
  id: string
  name: string
  size: number
  type: string
}

export interface InflightAttachment {
  localId: string
  name: string
  size: number
  type: string
  /** Asset id once the upload settles. */
  assetId?: string
  error?: string
}

interface AttachButtonProps {
  channelId: string
  inflight: InflightAttachment[]
  onChange: (inflight: InflightAttachment[]) => void
  disabled?: boolean
}

export function AttachButton({ channelId, inflight, onChange, disabled }: AttachButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files)
      if (list.length === 0) return
      const additions: InflightAttachment[] = list.map((f) => ({
        localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: f.name,
        size: f.size,
        type: f.type,
      }))
      const start = [...inflight, ...additions]
      onChange(start)
      const next = [...start]

      await Promise.all(
        additions.map(async (att, i) => {
          const file = list[i]
          try {
            const { passport } = await getChatPassport(channelId)
            const fd = new FormData()
            fd.append('file', file)
            const res = await fetch(`${__AUXX_API_BASE_URL__}/api/chat/attachments`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${passport}` },
              credentials: 'include',
              body: fd,
            })
            const json = (await res.json()) as
              | { success: true; data: UploadedAttachment }
              | { success: false; error: { message: string } }
            const idx = next.findIndex((a) => a.localId === att.localId)
            if (idx === -1) return
            if (!res.ok || !json.success) {
              next[idx] = {
                ...next[idx]!,
                error:
                  json.success === false ? json.error.message : `Upload failed (${res.status})`,
              }
            } else {
              next[idx] = { ...next[idx]!, assetId: json.data.id }
            }
            onChange([...next])
          } catch (e) {
            const idx = next.findIndex((a) => a.localId === att.localId)
            if (idx === -1) return
            next[idx] = { ...next[idx]!, error: e instanceof Error ? e.message : 'Upload failed' }
            onChange([...next])
          }
        })
      )
    },
    [channelId, inflight, onChange]
  )

  return (
    <>
      <input
        ref={inputRef}
        type='file'
        multiple
        className='hidden'
        onChange={(e) => {
          const files = (e.currentTarget as HTMLInputElement).files
          if (files) uploadFiles(files)
          if (inputRef.current) inputRef.current.value = ''
        }}
      />
      <button
        type='button'
        title='Attach files'
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
        )}>
        <Paperclip className='size-4' aria-hidden='true' />
      </button>
    </>
  )
}

export function AttachmentThumbRow({
  inflight,
  onRemove,
}: {
  inflight: InflightAttachment[]
  onRemove: (localId: string) => void
}) {
  if (inflight.length === 0) return null
  return (
    <div className='flex flex-wrap gap-1.5 border-b border-border px-3 py-2'>
      {inflight.map((a) => (
        <div
          key={a.localId}
          className={cn(
            'flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-xs',
            a.error ? 'border-destructive text-destructive' : ''
          )}>
          <span className='max-w-[140px] truncate'>{a.name}</span>
          {!a.assetId && !a.error ? (
            <span
              className='size-3 animate-spin rounded-full border-2 border-current border-t-transparent'
              aria-hidden='true'
            />
          ) : null}
          <button
            type='button'
            onClick={() => onRemove(a.localId)}
            aria-label='Remove attachment'
            className='text-muted-foreground hover:text-foreground'>
            <X className='size-3' aria-hidden='true' />
          </button>
        </div>
      ))}
    </div>
  )
}
