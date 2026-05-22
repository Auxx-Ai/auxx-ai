// apps/chat-widget/src/views/conversation/composer/emoji-button.tsx
//
// Trigger + lazy popover. The picker module is import()'d only on open so the
// large emoji dataset never lands in the initial widget bundle.

import { Smile } from 'lucide-react'
import { useState } from 'preact/hooks'
import { Popover, PopoverContent, PopoverTrigger } from '~/ui/popover'
import EmojiPicker from './emoji-picker'

interface EmojiButtonProps {
  onSelect: (emoji: string) => void
}

export function EmojiButton({ onSelect }: EmojiButtonProps) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type='button'
          title='Emoji'
          // Stop pointerdown from bubbling past the shadow root. Without this,
          // Radix's DismissableLayer sees the event at document scope with
          // `target` retargeted to the shadow host (outside the layer) and
          // immediately closes the popover the same click just opened.
          onPointerDown={(e) => e.stopPropagation()}
          className='flex size-7 items-center justify-center rounded text-[color:var(--color-muted)] hover:bg-[color:var(--color-surface)] hover:text-[color:var(--color-fg)]'>
          <Smile className='size-4' aria-hidden='true' />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className='w-auto p-0'
        align='start'
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}>
        <EmojiPicker onSelect={onSelect} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}
