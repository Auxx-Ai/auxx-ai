// apps/web/src/components/agents/ui/detail/prompt/persona-editor-content.tsx
'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import type { Editor } from '@tiptap/react'
import { EditorContent } from '@tiptap/react'
import { useRef } from 'react'
import { type ActivePickerState, InlinePickerPopover } from '~/components/editor/inline-picker'
import {
  ReferencePickerContent,
  type ReferencePickerHandle,
} from '~/components/pickers/reference-picker/reference-picker-content'
import EditorHeightResizeWrap from '~/components/workflow/ui/editor-height-resize-wrap'

const HEADER_HEIGHT_OFFSET = 28

interface PersonaEditorContentProps {
  editor: Editor | null
  isExpanded: boolean
  contentHeight: number
  setContentHeight: (height: number) => void
  minHeight: number
  activePicker: ActivePickerState | null
  referencePickerRef: React.RefObject<ReferencePickerHandle | null>
}

export function PersonaEditorContent({
  editor,
  isExpanded,
  contentHeight,
  setContentHeight,
  minHeight,
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

  const editorContentMinHeight = minHeight - HEADER_HEIGHT_OFFSET

  return (
    <EditorHeightResizeWrap
      height={contentHeight}
      minHeight={editorContentMinHeight}
      onHeightChange={setContentHeight}
      hideResize={false}>
      <div className='relative  pb-2 flex min-h-0 flex-1 w-full'>{editorNode}</div>
    </EditorHeightResizeWrap>
  )
}
