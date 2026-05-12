// apps/web/src/components/editor/bubble-menu/sections/inline-marks.tsx
'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { Bold, Code, Italic, Strikethrough, Underline as UnderlineIcon } from 'lucide-react'
import { BubbleSection } from '../bubble-menu'
import { BubbleToggleButton } from '../ui/bubble-toggle-button'

interface InlineMarksSectionProps {
  editor: Editor
}

export function InlineMarksSection({ editor }: InlineMarksSectionProps) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      strike: editor.isActive('strike'),
      code: editor.isActive('code'),
    }),
  })

  return (
    <BubbleSection>
      <MarkButton
        label='Bold'
        shortcut='⌘B'
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold />
      </MarkButton>
      <MarkButton
        label='Italic'
        shortcut='⌘I'
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic />
      </MarkButton>
      <MarkButton
        label='Underline'
        shortcut='⌘U'
        active={state.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon />
      </MarkButton>
      <MarkButton
        label='Strikethrough'
        shortcut='⌘⇧S'
        active={state.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough />
      </MarkButton>
      <MarkButton
        label='Inline code'
        shortcut='⌘E'
        active={state.code}
        onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code />
      </MarkButton>
    </BubbleSection>
  )
}

interface MarkButtonProps {
  label: string
  shortcut?: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
}

function MarkButton({ label, shortcut, active, onClick, children }: MarkButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <BubbleToggleButton aria-label={label} active={active} onClick={onClick}>
          {children}
        </BubbleToggleButton>
      </TooltipTrigger>
      <TooltipContent>
        <span className='flex items-center gap-1.5'>
          {label}
          {shortcut && <span className='text-muted-foreground'>{shortcut}</span>}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
