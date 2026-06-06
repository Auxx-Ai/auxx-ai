// apps/web/src/components/editor/bubble-menu/sections/turn-into.tsx
'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { EntityIcon } from '@auxx/ui/components/icons'
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { DEFAULT_BLOCKS, type EditorBlock } from '../../blocks/allowed-blocks'
import { BubbleSection } from '../bubble-menu'
import { useBubbleSubPopover } from '../bubble-menu-context'
import { BubbleToggleButton } from '../ui/bubble-toggle-button'

interface TurnIntoOption {
  id: string
  label: string
  iconId: string
  blockType: string
  level?: number | null
  calloutVariant?: 'info' | 'tip' | 'warn' | 'error' | 'success'
  checked?: boolean
}

/** Subset of the slash menu — in-place block transforms only. */
const TURN_INTO_OPTIONS: TurnIntoOption[] = [
  { id: 'text', label: 'Text', iconId: 'text', blockType: 'text', level: null },
  { id: 'h1', label: 'Heading 1', iconId: 'heading-1', blockType: 'heading', level: 1 },
  { id: 'h2', label: 'Heading 2', iconId: 'heading-2', blockType: 'heading', level: 2 },
  { id: 'h3', label: 'Heading 3', iconId: 'heading-3', blockType: 'heading', level: 3 },
  { id: 'bullet', label: 'Bullet list', iconId: 'list', blockType: 'bulletListItem', level: 1 },
  {
    id: 'numbered',
    label: 'Numbered list',
    iconId: 'list-ordered',
    blockType: 'numberedListItem',
    level: 1,
  },
  {
    id: 'todo',
    label: 'To-do list',
    iconId: 'check-square',
    blockType: 'todoListItem',
    checked: false,
  },
  { id: 'quote', label: 'Quote', iconId: 'quote', blockType: 'quote' },
  { id: 'code', label: 'Code', iconId: 'code', blockType: 'codeBlock' },
  {
    id: 'callout-info',
    label: 'Info callout',
    iconId: 'info',
    blockType: 'callout',
    calloutVariant: 'info',
  },
  {
    id: 'callout-tip',
    label: 'Tip callout',
    iconId: 'lightbulb',
    blockType: 'callout',
    calloutVariant: 'tip',
  },
  {
    id: 'callout-warn',
    label: 'Warning callout',
    iconId: 'alert-triangle',
    blockType: 'callout',
    calloutVariant: 'warn',
  },
  {
    id: 'callout-error',
    label: 'Error callout',
    iconId: 'x-circle',
    blockType: 'callout',
    calloutVariant: 'error',
  },
  {
    id: 'callout-success',
    label: 'Success callout',
    iconId: 'check-circle',
    blockType: 'callout',
    calloutVariant: 'success',
  },
  { id: 'divider', label: 'Divider', iconId: 'minus', blockType: 'divider', level: null },
]

interface TurnIntoSectionProps {
  editor: Editor
  /** Block kinds this editor allows. Options producing other kinds are hidden. */
  allowedBlocks?: EditorBlock[]
}

interface SelectionBlocks {
  /** All `block` node positions touched by the current selection. */
  positions: number[]
  /** Shared blockType across all blocks in selection, or null if mixed. */
  sharedType: string | null
  /** Shared blockType label for the trigger. */
  label: string
}

function findSelectionBlocks(editor: Editor): SelectionBlocks {
  const { from, to } = editor.state.selection
  const positions: number[] = []
  const types = new Set<string>()
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'block') {
      positions.push(pos)
      types.add(String(node.attrs.blockType ?? 'text'))
      return false
    }
    return true
  })
  const sharedType = types.size === 1 ? (types.values().next().value ?? null) : null
  return {
    positions,
    sharedType,
    label: sharedType ? labelForBlockType(sharedType, editor, positions[0]) : 'Mixed',
  }
}

function labelForBlockType(blockType: string, editor: Editor, pos?: number): string {
  if (blockType === 'heading' && typeof pos === 'number') {
    const level = editor.state.doc.nodeAt(pos)?.attrs.level ?? 1
    return `Heading ${level}`
  }
  const opt = TURN_INTO_OPTIONS.find(
    (o) => o.blockType === blockType && o.calloutVariant === undefined
  )
  return opt?.label ?? blockType
}

export function TurnIntoSection({ editor, allowedBlocks = DEFAULT_BLOCKS }: TurnIntoSectionProps) {
  const onOpenChange = useBubbleSubPopover()
  const selection = useEditorState({
    editor,
    selector: ({ editor }) => findSelectionBlocks(editor),
    equalityFn: (a, b) =>
      a.sharedType === b.sharedType &&
      a.positions.length === b.positions.length &&
      a.positions.every((p, i) => p === b.positions[i]),
  })

  // Only show options for kinds this surface allows.
  const allow = new Set(allowedBlocks)
  const options = TURN_INTO_OPTIONS.filter((o) => allow.has(o.blockType as EditorBlock))

  // Hide entirely if the selection has no convertible blocks (e.g. only
  // crossed table cells), or there's nothing meaningful to turn into (≤1
  // allowed option, e.g. a procedure surface that only permits `text`).
  if (selection.positions.length === 0 || options.length <= 1) return null

  const apply = (option: TurnIntoOption) => {
    const chain = editor.chain().focus()
    for (const pos of selection.positions) {
      const attrs: Record<string, unknown> = {
        blockType: option.blockType,
        level: option.level ?? null,
      }
      if (option.blockType === 'todoListItem') attrs.checked = option.checked ?? false
      if (option.blockType === 'callout') attrs.calloutVariant = option.calloutVariant ?? 'info'
      chain.command(({ tr, state }) => {
        const node = state.doc.nodeAt(pos)
        if (!node || node.type.name !== 'block') return false
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs })
        return true
      })
    }
    chain.run()
  }

  return (
    <BubbleSection>
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <BubbleToggleButton aria-label='Turn into'>
            <span className='max-w-24 truncate'>{selection.label}</span>
          </BubbleToggleButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start' className='max-h-72 w-48 overflow-y-auto'>
          {options.map((opt) => (
            <DropdownMenuItem
              key={opt.id}
              onSelect={() => apply(opt)}
              className='flex items-center gap-2'>
              <EntityIcon iconId={opt.iconId} size='xs' className='text-muted-foreground' />
              <span>{opt.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </BubbleSection>
  )
}
