// apps/web/src/components/editor/bubble-menu/sections/link-button.tsx
'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { Link as LinkIcon } from 'lucide-react'
import { BubbleToggleButton } from '../ui/bubble-toggle-button'

interface LinkButtonProps {
  editor: Editor
  onRequest: () => void
}

export function LinkButton({ editor, onRequest }: LinkButtonProps) {
  const active = useEditorState({
    editor,
    selector: ({ editor }) => editor.isActive('link'),
  })

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <BubbleToggleButton aria-label='Add link' active={active} onClick={onRequest}>
          <LinkIcon />
        </BubbleToggleButton>
      </TooltipTrigger>
      <TooltipContent>Link</TooltipContent>
    </Tooltip>
  )
}
