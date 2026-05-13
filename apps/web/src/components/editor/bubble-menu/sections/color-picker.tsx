// apps/web/src/components/editor/bubble-menu/sections/color-picker.tsx
'use client'

import { Popover, PopoverContentDialogAware, PopoverTrigger } from '@auxx/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { Check, ChevronDown } from 'lucide-react'
import { useBubbleSubPopover } from '../bubble-menu-context'
import { BubbleToggleButton } from '../ui/bubble-toggle-button'

interface ColorSwatch {
  id: string
  label: string
  textVar: string
  bgVar: string
}

const SWATCHES: ColorSwatch[] = [
  { id: 'default', label: 'Default', textVar: '', bgVar: '' },
  { id: 'red', label: 'Red', textVar: 'var(--kb-text-red)', bgVar: 'var(--kb-bg-red)' },
  {
    id: 'orange',
    label: 'Orange',
    textVar: 'var(--kb-text-orange)',
    bgVar: 'var(--kb-bg-orange)',
  },
  {
    id: 'yellow',
    label: 'Yellow',
    textVar: 'var(--kb-text-yellow)',
    bgVar: 'var(--kb-bg-yellow)',
  },
  { id: 'green', label: 'Green', textVar: 'var(--kb-text-green)', bgVar: 'var(--kb-bg-green)' },
  { id: 'teal', label: 'Teal', textVar: 'var(--kb-text-teal)', bgVar: 'var(--kb-bg-teal)' },
  { id: 'blue', label: 'Blue', textVar: 'var(--kb-text-blue)', bgVar: 'var(--kb-bg-blue)' },
  {
    id: 'purple',
    label: 'Purple',
    textVar: 'var(--kb-text-purple)',
    bgVar: 'var(--kb-bg-purple)',
  },
  { id: 'pink', label: 'Pink', textVar: 'var(--kb-text-pink)', bgVar: 'var(--kb-bg-pink)' },
]

interface ColorPickerSectionProps {
  editor: Editor
}

export function ColorPickerSection({ editor }: ColorPickerSectionProps) {
  const onOpenChange = useBubbleSubPopover()
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      activeColor: editor.getAttributes('textStyle').color as string | undefined,
      activeHighlight: editor.getAttributes('highlight').color as string | undefined,
    }),
  })

  const applyText = (swatch: ColorSwatch) => {
    if (!swatch.textVar) {
      editor.chain().focus().unsetColor().run()
      return
    }
    editor.chain().focus().setColor(swatch.textVar).run()
  }

  const applyHighlight = (swatch: ColorSwatch) => {
    if (!swatch.bgVar) {
      editor.chain().focus().unsetHighlight().run()
      return
    }
    editor.chain().focus().setHighlight({ color: swatch.bgVar }).run()
  }

  return (
    <Popover onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <BubbleToggleButton
              aria-label='Text and highlight color'
              active={!!state.activeColor || !!state.activeHighlight}>
              <span
                className='flex size-4 items-center justify-center rounded-sm text-[11px] font-semibold leading-none'
                style={{
                  color: state.activeColor || 'currentColor',
                  background: state.activeHighlight || 'transparent',
                }}>
                A
              </span>
            </BubbleToggleButton>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Text color</TooltipContent>
      </Tooltip>
      <PopoverContentDialogAware
        align='start'
        sideOffset={8}
        className='w-56 p-2'
        onMouseDown={(e) => e.preventDefault()}>
        <div className='text-muted-foreground mb-1 px-1 text-[11px] font-medium uppercase tracking-wide'>
          Text
        </div>
        <div className='grid grid-cols-9 gap-1'>
          {SWATCHES.map((s) => (
            <SwatchButton
              key={s.id}
              label={s.label}
              swatchStyle={{ color: s.textVar || 'inherit' }}
              isActive={s.textVar ? state.activeColor === s.textVar : !state.activeColor}
              onClick={() => applyText(s)}>
              A
            </SwatchButton>
          ))}
        </div>
        <div className='text-muted-foreground mt-3 mb-1 px-1 text-[11px] font-medium uppercase tracking-wide'>
          Highlight
        </div>
        <div className='grid grid-cols-9 gap-1'>
          {SWATCHES.map((s) => (
            <SwatchButton
              key={s.id}
              label={s.label}
              swatchStyle={{
                background: s.bgVar || 'transparent',
                border: s.id === 'default' ? '1px dashed var(--border)' : undefined,
              }}
              isActive={s.bgVar ? state.activeHighlight === s.bgVar : !state.activeHighlight}
              onClick={() => applyHighlight(s)}
            />
          ))}
        </div>
      </PopoverContentDialogAware>
    </Popover>
  )
}

interface SwatchButtonProps {
  label: string
  swatchStyle: React.CSSProperties
  isActive: boolean
  onClick: () => void
  children?: React.ReactNode
}

function SwatchButton({ label, swatchStyle, isActive, onClick, children }: SwatchButtonProps) {
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'relative flex size-5 items-center justify-center rounded-sm text-[11px] font-semibold leading-none',
        'border border-foreground/10 transition-colors hover:border-foreground/40',
        isActive && 'ring-2 ring-ring ring-offset-1 ring-offset-popover'
      )}
      style={swatchStyle}>
      {children}
      {isActive && !children && <Check className='size-3 text-foreground/80' strokeWidth={3} />}
    </button>
  )
}
