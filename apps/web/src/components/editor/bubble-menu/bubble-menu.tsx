// apps/web/src/components/editor/bubble-menu/bubble-menu.tsx
'use client'

import { Popover, PopoverAnchor, PopoverContentDialogAware } from '@auxx/ui/components/popover'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import type { Editor } from '@tiptap/react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { BubbleSubPopoverContext } from './bubble-menu-context'
import { type BubbleMenuRange, useBubbleMenuState } from './use-bubble-menu-state'

export interface EditorBubbleMenuContext {
  editor: Editor
  range: BubbleMenuRange
  rect: DOMRect
}

interface EditorBubbleMenuProps {
  editor: Editor | null
  shouldShow?: (ctx: { editor: Editor; from: number; to: number }) => boolean
  /** Block-aware controls (Section 1). The renderer is expected to return
   *  null when the selection spans multiple blocks. */
  renderBlockSection?: (ctx: EditorBubbleMenuContext) => React.ReactNode
  renderAISlot?: (ctx: EditorBubbleMenuContext) => React.ReactNode
  renderTurnInto?: (ctx: EditorBubbleMenuContext) => React.ReactNode
  renderInlineMarks?: (ctx: EditorBubbleMenuContext) => React.ReactNode
  renderColor?: (ctx: EditorBubbleMenuContext) => React.ReactNode
  renderAlign?: (ctx: EditorBubbleMenuContext) => React.ReactNode
  renderLink?: (ctx: EditorBubbleMenuContext) => React.ReactNode
  renderMore?: (ctx: EditorBubbleMenuContext) => React.ReactNode
  className?: string
}

export function EditorBubbleMenu({
  editor,
  shouldShow,
  renderBlockSection,
  renderAISlot,
  renderTurnInto,
  renderInlineMarks,
  renderColor,
  renderAlign,
  renderLink,
  renderMore,
  className,
}: EditorBubbleMenuProps) {
  // Track open sub-popovers (color picker, turn-into menu, etc.) so the
  // bubble stays mounted while they're open and steal focus from the editor.
  const [subPopoverCount, setSubPopoverCount] = useState(0)
  const trackSubPopover = useCallback((open: boolean) => {
    setSubPopoverCount((n) => Math.max(0, open ? n + 1 : n - 1))
  }, [])

  const contentRef = useRef<HTMLDivElement>(null)

  const state = useBubbleMenuState({
    editor,
    shouldShow,
    forceOpen: subPopoverCount > 0,
    getMenuEl: () => contentRef.current,
  })

  const virtualRef = useRef<{ getBoundingClientRect: () => DOMRect }>({
    getBoundingClientRect: () => state.rect ?? new DOMRect(),
  })
  virtualRef.current.getBoundingClientRect = () => state.rect ?? new DOMRect()

  const ctx = useMemo<EditorBubbleMenuContext | null>(
    () => (editor && state.rect ? { editor, range: state.range, rect: state.rect } : null),
    [editor, state.range, state.rect]
  )

  if (!editor || !ctx) return null

  return (
    <BubbleSubPopoverContext.Provider value={trackSubPopover}>
      <TooltipProvider delayDuration={350}>
        <Popover open={state.open} onOpenChange={() => {}}>
          <PopoverAnchor virtualRef={virtualRef} />
          <PopoverContentDialogAware
            ref={contentRef}
            side='top'
            align='start'
            sideOffset={8}
            collisionPadding={8}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onMouseDown={(e) => {
              e.preventDefault()
            }}
            className={cn(
              'flex w-auto flex-row items-center rounded-2xl p-0.5',
              'border border-foreground/15 bg-popover shadow-md backdrop-blur',
              // Round whichever button ends up flush with the popover edges.
              // CSS :first-child / :last-child resolve against the actually-
              // rendered DOM, so this works even when some sections return null.
              '[&>:first-child>:first-child]:rounded-l-2xl',
              '[&>:last-child>:last-child]:rounded-r-2xl',
              className
            )}>
            {renderBlockSection?.(ctx)}
            {renderAISlot?.(ctx)}
            {renderTurnInto?.(ctx)}
            {renderInlineMarks?.(ctx)}
            <BubbleSection>
              {renderColor?.(ctx)}
              {renderAlign?.(ctx)}
              {renderLink?.(ctx)}
              {renderMore?.(ctx)}
            </BubbleSection>
          </PopoverContentDialogAware>
        </Popover>
      </TooltipProvider>
    </BubbleSubPopoverContext.Provider>
  )
}

export function BubbleSection({ children }: { children?: React.ReactNode }) {
  // React treats `null`/`false`/`undefined` as no children but they still
  // count for the `hasContent` heuristic below. Use a manual check that
  // walks the array.
  const childArray = Array.isArray(children) ? children : [children]
  const hasContent = childArray.some((c) => c != null && c !== false)
  if (!hasContent) return null
  return (
    <div className='flex items-center gap-0.5 border-r border-foreground/10 px-0.5 last:border-r-0 first:pl-0 last:pr-0'>
      {children}
    </div>
  )
}
