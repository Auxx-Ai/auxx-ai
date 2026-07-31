// apps/web/src/components/editor/bubble-menu/kb/kb-block-section.tsx
'use client'

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import type { CalloutVariant } from '@auxx/ui/components/kb/article'
import { CalloutIcon } from '@auxx/ui/components/kb/article'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronDown,
  type LucideIcon,
  Square,
} from 'lucide-react'
import type React from 'react'
import { BubbleSection } from '../bubble-menu'
import { useBubbleSubPopover } from '../bubble-menu-context'
import { BubbleToggleButton } from '../ui/bubble-toggle-button'

interface KBBlockSectionProps {
  editor: Editor
}

interface BlockSelectionInfo {
  /** Position of the single `block` node containing the selection; null if
   *  multi-block or no block ancestor. */
  pos: number | null
  blockType: string | null
  attrs: Record<string, unknown> | null
}

function findContainingBlock(editor: Editor): BlockSelectionInfo {
  const { from, to } = editor.state.selection
  let firstPos: number | null = null
  let firstType: string | null = null
  let firstAttrs: Record<string, unknown> | null = null
  let count = 0
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'block') {
      count++
      if (count === 1) {
        firstPos = pos
        firstType = String(node.attrs.blockType ?? 'text')
        firstAttrs = { ...node.attrs }
      }
      return false
    }
    return true
  })
  if (count !== 1) return { pos: null, blockType: null, attrs: null }
  return { pos: firstPos, blockType: firstType, attrs: firstAttrs }
}

export function KBBlockSection({ editor }: KBBlockSectionProps) {
  const info = useEditorState({
    editor,
    selector: ({ editor }) => findContainingBlock(editor),
    // `b` is null on the first evaluation — nothing to compare against yet.
    equalityFn: (a, b) =>
      b !== null &&
      a.pos === b.pos &&
      a.blockType === b.blockType &&
      JSON.stringify(a.attrs) === JSON.stringify(b.attrs),
  })

  if (!info.pos || !info.blockType || !info.attrs) return null

  const update = (patch: Record<string, unknown>) => {
    const pos = info.pos
    if (pos == null) return
    editor
      .chain()
      .focus()
      .command(({ tr, state }) => {
        const node = state.doc.nodeAt(pos)
        if (!node || node.type.name !== 'block') return false
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch })
        return true
      })
      .run()
  }

  let control: React.ReactNode = null
  switch (info.blockType) {
    case 'bulletListItem':
      control = (
        <BulletListStyleDropdown
          current={(info.attrs.listStyle as string | null) ?? 'disc'}
          onChange={(v) => update({ listStyle: v })}
        />
      )
      break
    case 'numberedListItem':
      control = (
        <NumberedListStyleDropdown
          current={(info.attrs.listStyle as string | null) ?? '1'}
          onChange={(v) => update({ listStyle: v })}
        />
      )
      break
    case 'callout':
      control = (
        <CalloutVariantDropdown
          current={(info.attrs.calloutVariant as CalloutVariant) ?? 'info'}
          onChange={(v) => update({ calloutVariant: v })}
        />
      )
      break
    case 'image':
      control = (
        <ImageAlignDropdown
          current={(info.attrs.imageAlign as 'left' | 'center' | 'right') ?? 'center'}
          onChange={(v) => update({ imageAlign: v })}
        />
      )
      break
    case 'embed':
      control = (
        <EmbedAspectDropdown
          current={(info.attrs.embedAspect as string) ?? '16:9'}
          onChange={(v) => update({ embedAspect: v })}
        />
      )
      break
  }

  if (!control) return null
  return <BubbleSection>{control}</BubbleSection>
}

// Non-empty tuple: the `?? BULLET_OPTIONS[0]` fallback below relies on a
// first element existing.
type BulletOption = { id: string; label: string; glyph: string }
const BULLET_OPTIONS: [BulletOption, ...BulletOption[]] = [
  { id: 'disc', label: 'Disc', glyph: '•' },
  { id: 'circle', label: 'Circle', glyph: '◦' },
  { id: 'square', label: 'Square', glyph: '▪' },
]

function BulletListStyleDropdown({
  current,
  onChange,
}: {
  current: string
  onChange: (v: string) => void
}) {
  const onOpenChange = useBubbleSubPopover()
  const active = BULLET_OPTIONS.find((o) => o.id === current) ?? BULLET_OPTIONS[0]
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <BubbleToggleButton aria-label='Bullet style' className='gap-1 px-2'>
              <span className='text-sm leading-none'>{active.glyph}</span>
              <ChevronDown className='size-3 opacity-60' />
            </BubbleToggleButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>List style</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align='start'>
        <DropdownMenuLabel className='text-xs'>Bullet style</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {BULLET_OPTIONS.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.id}
            checked={current === o.id}
            onSelect={(e) => {
              e.preventDefault()
              onChange(o.id)
            }}>
            <span className='mr-2 inline-block w-3 text-center'>{o.glyph}</span>
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Non-empty tuple — see BULLET_OPTIONS.
type NumberedOption = { id: string; label: string; sample: string }
const NUMBERED_OPTIONS: [NumberedOption, ...NumberedOption[]] = [
  { id: '1', label: 'Decimal', sample: '1.' },
  { id: 'a', label: 'Lower alpha', sample: 'a.' },
  { id: 'A', label: 'Upper alpha', sample: 'A.' },
  { id: 'i', label: 'Lower roman', sample: 'i.' },
  { id: 'I', label: 'Upper roman', sample: 'I.' },
]

function NumberedListStyleDropdown({
  current,
  onChange,
}: {
  current: string
  onChange: (v: string) => void
}) {
  const onOpenChange = useBubbleSubPopover()
  const active = NUMBERED_OPTIONS.find((o) => o.id === current) ?? NUMBERED_OPTIONS[0]
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <BubbleToggleButton aria-label='Numbering style' className='gap-1 px-2'>
              <span className='text-xs leading-none'>{active.sample}</span>
              <ChevronDown className='size-3 opacity-60' />
            </BubbleToggleButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>List style</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align='start'>
        <DropdownMenuLabel className='text-xs'>Numbering style</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {NUMBERED_OPTIONS.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.id}
            checked={current === o.id}
            onSelect={(e) => {
              e.preventDefault()
              onChange(o.id)
            }}>
            <span className='mr-2 inline-block w-6 text-left tabular-nums'>{o.sample}</span>
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const CALLOUT_VARIANTS: { id: CalloutVariant; label: string }[] = [
  { id: 'info', label: 'Info' },
  { id: 'tip', label: 'Tip' },
  { id: 'warn', label: 'Warning' },
  { id: 'error', label: 'Error' },
  { id: 'success', label: 'Success' },
]

function CalloutVariantDropdown({
  current,
  onChange,
}: {
  current: CalloutVariant
  onChange: (v: CalloutVariant) => void
}) {
  const onOpenChange = useBubbleSubPopover()
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <BubbleToggleButton aria-label='Callout variant' className='gap-1 px-2'>
              <CalloutIcon variant={current} size={14} />
              <ChevronDown className='size-3 opacity-60' />
            </BubbleToggleButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Callout variant</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align='start'>
        {CALLOUT_VARIANTS.map((v) => (
          <DropdownMenuItem
            key={v.id}
            onSelect={() => onChange(v.id)}
            className='flex items-center gap-2'>
            <CalloutIcon variant={v.id} size={14} /> {v.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const IMAGE_ALIGN_OPTIONS: {
  id: 'left' | 'center' | 'right'
  label: string
  Icon: LucideIcon
}[] = [
  { id: 'left', label: 'Left', Icon: AlignLeft },
  { id: 'center', label: 'Center', Icon: AlignCenter },
  { id: 'right', label: 'Right', Icon: AlignRight },
]

function ImageAlignDropdown({
  current,
  onChange,
}: {
  current: 'left' | 'center' | 'right'
  onChange: (v: 'left' | 'center' | 'right') => void
}) {
  const onOpenChange = useBubbleSubPopover()
  const ActiveIcon = IMAGE_ALIGN_OPTIONS.find((o) => o.id === current)?.Icon ?? AlignCenter
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <BubbleToggleButton aria-label='Image alignment' className='gap-1 px-1.5'>
              <ActiveIcon />
              <ChevronDown className='size-3 opacity-60' />
            </BubbleToggleButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Image alignment</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align='start'>
        {IMAGE_ALIGN_OPTIONS.map((o) => (
          <DropdownMenuItem
            key={o.id}
            onSelect={() => onChange(o.id)}
            className='flex items-center gap-2'>
            <o.Icon className='size-3.5 text-muted-foreground' /> {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const EMBED_ASPECTS = ['16:9', '4:3', '1:1'] as const

function EmbedAspectDropdown({
  current,
  onChange,
}: {
  current: string
  onChange: (v: string) => void
}) {
  const onOpenChange = useBubbleSubPopover()
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <BubbleToggleButton aria-label='Embed aspect ratio' className='gap-1 px-2'>
              <Square />
              <span className='text-xs leading-none'>{current}</span>
              <ChevronDown className='size-3 opacity-60' />
            </BubbleToggleButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Aspect ratio</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align='start'>
        {EMBED_ASPECTS.map((a) => (
          <DropdownMenuItem
            key={a}
            onSelect={() => onChange(a)}
            className='flex items-center gap-2'>
            {a}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
