// apps/web/src/components/workflow/ui/prompt-editor/tiptap-prompt-editor.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { EditorContent } from '@tiptap/react'
import type React from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { InlinePickerPopover, useActivePicker } from '~/components/editor/inline-picker'
import { ReferencePickerContent } from '~/components/pickers/reference-picker/reference-picker-content'
import { useWorkflowVariableEditor } from '../input-editor/hooks/use-workflow-variable-editor'
import { VariableExplorerEnhanced } from '../variables/variable-explorer-enhanced'
import { usePromptEditorContext } from './prompt-editor-context'
import './tiptap-prompt-editor.css'

/**
 * Core TiptapPromptEditor component.
 * Uses context instead of props to eliminate prop drilling.
 * Uses the new inline-picker system for React-driven variable picker UI.
 *
 * When the context flips into JSON mode (`jsonMode = true`) the inner
 * `useWorkflowVariableEditor` runs the JSON path — initial doc read
 * once, no text round-trip, onChange emits the live Tiptap doc.
 *
 * When `enableReferencePicker = true`, also mounts the `@`-picker popover
 * alongside the standard `{`-variable popover. Both share the same
 * containerRef for positioning.
 */
const TiptapPromptEditor: React.FC = () => {
  const {
    value,
    onChange,
    valueJson,
    onChangeJson,
    jsonMode,
    enableReferencePicker,
    referenceTabs,
    placeholder,
    setFocused,
    editable,
    compact,
    className,
    inputClassName,
    onBlur,
    editorRef,
    setCharacterCount,
    nodeId,
    trigger,
  } = usePromptEditorContext()

  const containerRef = useRef<HTMLDivElement>(null)

  // Multi-line editor needs different className (no whitespace-nowrap)
  const editorClassName = cn(
    'prose prose-sm max-w-none focus:outline-none flex-1',
    compact ? 'text-[13px] leading-5' : 'text-sm leading-5',
    'text-primary-500',
    'prose-p:my-0 prose-ul:my-1 prose-li:my-0',
    className,
    inputClassName
  )

  // Reference-picker keyboard nav: the popover (`ReferencePickerContent`)
  // exposes an imperative handle for arrow/Enter; the chip extension
  // forwards keydowns into these callbacks.
  const referencePickerRef = useRef<React.ComponentRef<typeof ReferencePickerContent> | null>(null)
  const onPickerEnter = useCallback(
    () => referencePickerRef.current?.confirmHighlighted() ?? false,
    []
  )
  const onPickerArrowVertical = useCallback(
    (dir: 1 | -1) => referencePickerRef.current?.moveHighlight(dir) ?? false,
    []
  )

  const {
    editor,
    suggestionState,
    insertVariable,
    closePicker,
    isFocused,
    setContent,
    flushPendingChanges,
  } = useWorkflowVariableEditor({
    // String-mode props (used when jsonMode === false)
    initialContent: jsonMode ? undefined : value,
    onContentChange: jsonMode ? undefined : onChange,
    onBlur: jsonMode ? undefined : onBlur,
    // JSON-mode props (used when jsonMode === true)
    valueJson: jsonMode ? valueJson : undefined,
    onContentChangeJson: jsonMode ? onChangeJson : undefined,
    placeholder,
    className: editorClassName,
    nodeId,
    editable,
    trigger,
    enableReferencePicker,
    referenceTabs,
    onPickerEnter: enableReferencePicker ? onPickerEnter : undefined,
    onPickerArrowVertical: enableReferencePicker ? onPickerArrowVertical : undefined,
  })

  // Track the active reference-picker chip (at most one per doc).
  const activePicker = useActivePicker(enableReferencePicker ? editor : null)

  // Update context focus state when isFocused changes
  useEffect(() => {
    setFocused(isFocused)
  }, [isFocused, setFocused])

  // Store editor reference in context for external access
  useEffect(() => {
    if (editorRef) {
      editorRef.current = editor
    }

    // Initialize character count when editor is ready
    if (editor) {
      const textContent = editor.getText()
      setCharacterCount(textContent.length)
    }
  }, [editor, editorRef, setCharacterCount])

  // Handle component unmount - flush any pending changes (string mode only)
  useEffect(() => {
    return () => {
      flushPendingChanges()
    }
  }, [flushPendingChanges])

  // Sync external value changes to editor (e.g., from Apply button in
  // generate dialog). JSON mode is uncontrolled-after-mount on purpose —
  // see `useWorkflowVariableEditor` JSON-mode contract — so we skip the
  // sync entirely in that mode.
  useEffect(() => {
    if (!editor || jsonMode) return
    if (value !== undefined) setContent(value)
  }, [value, editor, setContent, jsonMode])

  /**
   * Handle Escape key - prevent parent dialog close when inside command picker
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && e.target instanceof HTMLElement && e.target.closest('[cmdk-root]')) {
      e.preventDefault()
      e.stopPropagation()
    }
  }, [])

  const showReadOnlyOverlay = !editable

  return (
    <div ref={containerRef} className='relative flex-1 min-h-0 flex' onKeyDown={handleKeyDown}>
      <EditorContent
        editor={editor}
        className={cn(
          'min-h-[56px] w-full flex-1 flex',
          compact ? 'text-[13px] leading-5' : 'text-sm leading-6',
          'outline-none ring-0 focus-within:outline-none',
          className
        )}
      />

      {/* Variable picker popover ({ trigger) */}
      <InlinePickerPopover
        state={suggestionState}
        containerRef={containerRef}
        onClose={closePicker}
        width={400}>
        <VariableExplorerEnhanced
          nodeId={nodeId}
          onVariableSelect={(variable) => insertVariable(variable.id)}
          className='max-h-[400px]'
          placeholder='Type in editor to filter...'
          onClose={closePicker}
        />
      </InlinePickerPopover>

      {/* Reference picker popover (@ trigger) — opt-in */}
      {enableReferencePicker && (
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
            tabs={referenceTabs}
          />
        </InlinePickerPopover>
      )}

      {showReadOnlyOverlay && <div className='absolute inset-0 z-10' />}
    </div>
  )
}

export default TiptapPromptEditor
