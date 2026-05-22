// apps/chat-widget/src/views/conversation/composer/composer.tsx
//
// Single rounded container: autosize textarea on top, action row (emoji,
// attach, send) below. Owns draft state, keyboard shortcuts, drag-and-drop
// passthrough to the attach flow, and ties together send + attachments.

import { useCallback, useRef, useState } from 'preact/hooks'
import { cn } from '~/lib/cn'
import { AttachButton, AttachmentThumbRow, type InflightAttachment } from './attach-button'
import { AutosizeTextarea } from './autosize-textarea'
import { EmojiButton } from './emoji-button'
import { SendButton } from './send-button'

export interface ComposerSendArgs {
  content: string
  attachmentIds: string[]
}

interface ComposerProps {
  channelId: string
  onSend: (args: ComposerSendArgs) => Promise<void> | void
  disabled?: boolean
  placeholder?: string
}

export function Composer({ channelId, onSend, disabled, placeholder }: ComposerProps) {
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const [attachments, setAttachments] = useState<InflightAttachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const uploaded = attachments.filter((a) => a.assetId).map((a) => a.assetId!) as string[]
  const hasInflight = attachments.some((a) => !a.assetId && !a.error)
  const canSend = !sending && !hasInflight && (value.trim().length > 0 || uploaded.length > 0)

  const handleSend = useCallback(async () => {
    if (!canSend) return
    setSending(true)
    try {
      await onSend({ content: value.trim(), attachmentIds: uploaded })
      setValue('')
      setAttachments([])
    } finally {
      setSending(false)
    }
  }, [canSend, onSend, uploaded, value])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) return
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const insertAtCaret = useCallback(
    (text: string) => {
      const el = textareaRef.current
      if (!el) {
        setValue((v) => v + text)
        return
      }
      const start = el.selectionStart ?? value.length
      const end = el.selectionEnd ?? value.length
      const next = value.slice(0, start) + text + value.slice(end)
      setValue(next)
      requestAnimationFrame(() => {
        if (!el) return
        const pos = start + text.length
        el.focus()
        el.setSelectionRange(pos, pos)
      })
    },
    [value]
  )

  const handleRemoveAttachment = useCallback((localId: string) => {
    setAttachments((prev) => prev.filter((a) => a.localId !== localId))
  }, [])

  // Drag-and-drop handoff to AttachButton's upload pipeline.
  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return
      // Mirror the AttachButton upload flow by appending and triggering uploads.
      // We do it inline here to keep AttachButton stateless for the row UI.
      uploadFiles(channelId, files, attachments, setAttachments)
    },
    [attachments, channelId]
  )

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={cn(
        'mx-3 mb-3 rounded-xl bg-[color:var(--color-surface-subtle)] ring-1 ring-[color:var(--color-border-strong)] transition-colors focus-within:ring-[color:var(--color-primary)] focus-within:ring-2',
        dragOver && 'ring-[color:var(--color-primary)] bg-[color:var(--color-hover)]'
      )}>
      <AttachmentThumbRow inflight={attachments} onRemove={handleRemoveAttachment} />
      <AutosizeTextarea
        ref={textareaRef}
        value={value}
        onInput={(e) => setValue((e.currentTarget as HTMLTextAreaElement).value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? 'Type a message…'}
        minRows={1}
        maxRows={6}
        disabled={disabled}
      />
      <div className='flex items-center justify-between gap-1 px-2 pb-2'>
        <div className='flex items-center gap-1'>
          <EmojiButton onSelect={insertAtCaret} />
          <AttachButton
            channelId={channelId}
            inflight={attachments}
            onChange={setAttachments}
            disabled={disabled || sending}
          />
        </div>
        <SendButton onClick={handleSend} disabled={!canSend} loading={sending} />
      </div>
    </div>
  )
}

async function uploadFiles(
  channelId: string,
  files: FileList,
  current: InflightAttachment[],
  setState: (next: InflightAttachment[]) => void
): Promise<void> {
  const list = Array.from(files)
  const additions: InflightAttachment[] = list.map((f) => ({
    localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: f.name,
    size: f.size,
    type: f.type,
  }))
  const start = [...current, ...additions]
  setState(start)
  const next = [...start]

  const { getChatPassport } = await import('~/transport/passport')

  await Promise.all(
    additions.map(async (att, i) => {
      const file = list[i]!
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
          | { success: true; data: { id: string; name: string; size: number; type: string } }
          | { success: false; error: { message: string } }
        const idx = next.findIndex((a) => a.localId === att.localId)
        if (idx === -1) return
        if (!res.ok || !json.success) {
          next[idx] = {
            ...next[idx]!,
            error: json.success === false ? json.error.message : `Upload failed (${res.status})`,
          }
        } else {
          next[idx] = { ...next[idx]!, assetId: json.data.id }
        }
        setState([...next])
      } catch (e) {
        const idx = next.findIndex((a) => a.localId === att.localId)
        if (idx === -1) return
        next[idx] = { ...next[idx]!, error: e instanceof Error ? e.message : 'Upload failed' }
        setState([...next])
      }
    })
  )
}
