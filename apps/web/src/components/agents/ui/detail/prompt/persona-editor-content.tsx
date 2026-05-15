// apps/web/src/components/agents/ui/detail/prompt/persona-editor-content.tsx
'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import type { Editor } from '@tiptap/react'
import { EditorContent } from '@tiptap/react'
import { memo, useRef } from 'react'
import { type ActivePickerState, InlinePickerPopover } from '~/components/editor/inline-picker'
import {
  ReferencePickerContent,
  type ReferencePickerHandle,
} from '~/components/pickers/reference-picker/reference-picker-content'
import CollapseWrap from '~/components/workflow/ui/collapse-wrap'

interface PersonaEditorContentProps {
  editor: Editor | null
  isExpanded: boolean
  collapsedMinHeight: number
  isCollapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  activePicker: ActivePickerState | null
  referencePickerRef: React.RefObject<ReferencePickerHandle | null>
}

export const PersonaEditorContent = memo(function PersonaEditorContent({
  editor,
  isExpanded,
  collapsedMinHeight,
  isCollapsed,
  setCollapsed,
  activePicker,
  referencePickerRef,
}: PersonaEditorContentProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const editorNode = (
    <div ref={containerRef} className='relative flex-1 min-h-0 flex w-full'>
      <EditorContent
        editor={editor}
        className='prose prose-sm max-w-none dark:prose-invert w-full [&_.ProseMirror]:outline-none [&_.ProseMirror]:focus:outline-none [&_.ProseMirror-focused]:outline-none focus:outline-none'
      />
      <InlinePickerPopover
        state={{
          isOpen: !!activePicker,
          query: activePicker?.query ?? '',
          range: null,
          clientRect: activePicker?.clientRect ?? null,
        }}
        containerRef={containerRef}
        width={360}
        side='bottom'
        align='start'
        autoFocus={false}
        onInteractOutside={(e) => {
          const target = e.target as HTMLElement | null
          if (target?.closest('[data-type="reference-picker"]')) {
            e.preventDefault()
          }
        }}
        onClose={() => editor?.commands.closeReferencePicker({ keepText: true })}>
        <ReferencePickerContent
          ref={referencePickerRef}
          tab={activePicker?.tab ?? 'people'}
          query={activePicker?.query ?? ''}
          onSelect={(id) => editor?.commands.confirmReferencePicker(id)}
          onTabChange={(tab) => editor?.commands.setReferencePickerTab(tab)}
        />
      </InlinePickerPopover>
    </div>
  )

  if (isExpanded) {
    return (
      <div className='h-full pb-0'>
        <ScrollArea
          className='relative h-full min-h-0 px-3 flex-1 flex'
          fadeClassName=''
          allowScrollChaining
          scrollbarClassName='w-1 mr-0.5 data-[hovering]:opacity-0 hover:!opacity-100'>
          {editorNode}
        </ScrollArea>
      </div>
    )
  }

  return (
    <CollapseWrap
      minHeight={collapsedMinHeight}
      isCollapsed={isCollapsed}
      onCollapsedChange={setCollapsed}
      className='px-3'
      gradientClassName='from-primary-200/30 dark:from-primary-200/30'>
      <div className='relative flex w-full'>{editorNode}</div>
    </CollapseWrap>
  )
})
