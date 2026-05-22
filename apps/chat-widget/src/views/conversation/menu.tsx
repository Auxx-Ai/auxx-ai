// apps/chat-widget/src/views/conversation/menu.tsx
//
// `…` overflow menu in the conversation header. Items today:
//   - Expand window (toggles expanded state — persisted in localStorage)
//   - Download transcript (gated by ChatWidget.allowDownloadTranscript)

import { Download, Maximize2, Minimize2, MoreHorizontal } from 'lucide-react'
import { chatApi } from '~/transport/chat-api'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/ui/dropdown-menu'

interface ConversationMenuProps {
  channelId: string
  threadId: string
  expanded: boolean
  onToggleExpanded: () => void
  allowDownloadTranscript: boolean
}

export function ConversationMenu({
  channelId,
  threadId,
  expanded,
  onToggleExpanded,
  allowDownloadTranscript,
}: ConversationMenuProps) {
  const api = chatApi(channelId)

  const handleDownload = async () => {
    try {
      const { html, filename } = await api.getTranscript(threadId)
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      /* swallow — surfaced elsewhere */
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          aria-label='More'
          // See emoji-button.tsx — stop pointerdown bubbling so the
          // DismissableLayer's outside-click detector doesn't retarget through
          // the shadow boundary and close the menu instantly.
          onPointerDown={(e) => e.stopPropagation()}
          className='flex size-7 items-center justify-center rounded text-[color:var(--color-muted)] hover:bg-[color:var(--color-surface)] hover:text-[color:var(--color-fg)]'>
          <MoreHorizontal className='size-4' aria-hidden='true' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuItem onSelect={onToggleExpanded}>
          {expanded ? (
            <Minimize2 className='size-4' aria-hidden='true' />
          ) : (
            <Maximize2 className='size-4' aria-hidden='true' />
          )}
          {expanded ? 'Shrink window' : 'Expand window'}
        </DropdownMenuItem>
        {allowDownloadTranscript ? (
          <DropdownMenuItem onSelect={handleDownload}>
            <Download className='size-4' aria-hidden='true' />
            Download transcript
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
