// apps/web/src/components/editor/bubble-menu/sections/align.tsx
'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ChevronDown } from 'lucide-react'
import { useBubbleSubPopover } from '../bubble-menu-context'
import { BubbleToggleButton } from '../ui/bubble-toggle-button'

type Align = 'left' | 'center' | 'right' | 'justify'

const OPTIONS: { id: Align; label: string; Icon: typeof AlignLeft }[] = [
  { id: 'left', label: 'Align left', Icon: AlignLeft },
  { id: 'center', label: 'Align center', Icon: AlignCenter },
  { id: 'right', label: 'Align right', Icon: AlignRight },
  { id: 'justify', label: 'Justify', Icon: AlignJustify },
]

interface AlignSectionProps {
  editor: Editor
}

export function AlignSection({ editor }: AlignSectionProps) {
  const onOpenChange = useBubbleSubPopover()
  const current = useEditorState({
    editor,
    selector: ({ editor }): Align => {
      // Read the actual textAlign attribute on the current block. Falling
      // back to scanning isActive() across every option made the dropdown
      // pick whichever option happened to match a non-default value first,
      // which surfaced as "always Right" once any block in the doc carried
      // textAlign: 'right'.
      const attrs = editor.getAttributes('block') as { textAlign?: string | null }
      const value = attrs.textAlign
      if (value === 'left' || value === 'center' || value === 'right' || value === 'justify') {
        return value
      }
      return 'left'
    },
  })

  const ActiveIcon = OPTIONS.find((o) => o.id === current)?.Icon ?? AlignLeft

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <BubbleToggleButton aria-label='Text alignment'>
              <ActiveIcon />
            </BubbleToggleButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Alignment</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align='start' className='w-40'>
        {OPTIONS.map((o) => (
          <DropdownMenuItem
            key={o.id}
            onSelect={() => editor.chain().focus().setTextAlign(o.id).run()}
            className='flex items-center gap-2'>
            <o.Icon className='size-3.5 text-muted-foreground' />
            <span>{o.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
