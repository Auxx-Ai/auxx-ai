// apps/web/src/components/editor/slash-commands/block-commands.ts

import type { Editor } from '@tiptap/react'
import type { SlashCommandItem } from './slash-command-picker'

export type SlashRange = { from: number; to: number }

export interface BlockCommandSpec {
  blockType:
    | 'text'
    | 'heading'
    | 'bulletListItem'
    | 'numberedListItem'
    | 'todoListItem'
    | 'quote'
    | 'codeBlock'
    | 'callout'
    | 'embed'
  level?: number | null
  checked?: boolean
  calloutVariant?: 'info' | 'tip' | 'warn' | 'error' | 'success'
}

export interface BlockCommandDef extends SlashCommandItem {
  /** Simple attr-swap action. Mutually exclusive with `custom`. */
  spec?: BlockCommandSpec
  /** Free-form action — used when the insert is more than an attr swap
   *  (divider, image, table, etc.). */
  custom?: (editor: Editor, range: SlashRange) => void
}

/** Basic block set shared by every slash-menu surface. */
export const BASIC_BLOCK_COMMANDS: BlockCommandDef[] = [
  {
    id: 'text',
    title: 'Text',
    description: 'Plain text block',
    keywords: ['p', 'paragraph'],
    iconId: 'text',
    spec: { blockType: 'text', level: null },
  },
  {
    id: 'h1',
    title: 'Heading 1',
    description: 'Big section heading',
    keywords: ['h1', 'title', 'large'],
    iconId: 'heading-1',
    spec: { blockType: 'heading', level: 1 },
  },
  {
    id: 'h2',
    title: 'Heading 2',
    description: 'Medium section heading',
    keywords: ['h2', 'subtitle'],
    iconId: 'heading-2',
    spec: { blockType: 'heading', level: 2 },
  },
  {
    id: 'h3',
    title: 'Heading 3',
    description: 'Small section heading',
    keywords: ['h3', 'subheading'],
    iconId: 'heading-3',
    spec: { blockType: 'heading', level: 3 },
  },
  {
    id: 'bullet',
    title: 'Bullet list',
    description: 'Create a bullet list',
    keywords: ['ul', 'unordered', 'bullets', 'points'],
    iconId: 'list',
    spec: { blockType: 'bulletListItem', level: 1 },
  },
  {
    id: 'numbered',
    title: 'Numbered list',
    description: 'Create a numbered list',
    keywords: ['ol', 'ordered', 'numbers', 'steps'],
    iconId: 'list-ordered',
    spec: { blockType: 'numberedListItem', level: 1 },
  },
  {
    id: 'todo',
    title: 'To-do list',
    description: 'Track tasks with checkboxes',
    keywords: ['todo', 'task', 'check', 'checkbox'],
    iconId: 'check-square',
    spec: { blockType: 'todoListItem', checked: false },
  },
  {
    id: 'quote',
    title: 'Quote',
    description: 'Capture a quote',
    keywords: ['blockquote', 'cite'],
    iconId: 'quote',
    spec: { blockType: 'quote' },
  },
  {
    id: 'code',
    title: 'Code',
    description: 'Capture a code block',
    keywords: ['codeblock', 'code'],
    iconId: 'code',
    spec: { blockType: 'codeBlock' },
  },
  {
    id: 'divider',
    title: 'Divider',
    description: 'Visual separator',
    keywords: ['hr', 'horizontal', 'rule', 'line'],
    iconId: 'minus',
    custom: (editor, range) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .updateAttributes('block', { blockType: 'divider', level: null, checked: false })
        .splitBlock()
        .updateAttributes('block', { blockType: 'text', level: null, checked: false })
        .run()
    },
  },
]

/** Turn a `BlockCommandDef` into the executor `executeCommand` expects. */
export function runBlockCommand(def: BlockCommandDef): (editor: Editor, range: SlashRange) => void {
  if (def.custom) return def.custom
  if (!def.spec) {
    throw new Error(`block command "${def.id}" has neither spec nor custom`)
  }
  const spec = def.spec
  return (editor, range) => {
    const attrs: Record<string, unknown> = {
      blockType: spec.blockType,
      level: spec.level ?? null,
    }
    if (spec.blockType === 'todoListItem') attrs.checked = spec.checked ?? false
    if (spec.blockType === 'callout') attrs.calloutVariant = spec.calloutVariant ?? 'info'
    editor.chain().focus().deleteRange(range).updateAttributes('block', attrs).run()
  }
}
