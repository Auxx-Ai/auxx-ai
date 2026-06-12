// apps/web/src/components/agents/procedures/ui/prose-editor-card.tsx
'use client'

import { Dialog, DialogContent, DialogTitle } from '@auxx/ui/components/dialog'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { VisuallyHidden } from '@auxx/ui/components/visually-hidden'
import { cn } from '@auxx/ui/lib/utils'
import type { JSONContent } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { type RefObject, useCallback, useMemo, useState } from 'react'
import { PROCEDURE_BLOCKS } from '~/components/editor/blocks/allowed-blocks'
import type { ReferenceTab } from '~/components/editor/inline-picker/nodes/reference-picker-node'
import {
  PromptCharacterCount,
  PromptEditorContent,
  PromptEditorHeader,
} from '~/components/editor/prompt-editor'
import type { SlashContentProps } from '~/components/editor/slash-commands/slash-content'
import type { ReferencePickerHandle } from '~/components/pickers/reference-picker/reference-picker-content'
import { ProcedureSlashContent } from './procedure-slash-content'

// `@` is references only (plan: plans/prose/build-plan.md): the admin tabs
// (Tools, Resources, Fields) plus `articles`. The CRM/inbox tabs from
// DEFAULT_TABS (people, records, messages) are dropped — they're meaningless
// inside a procedure. Step insertion (routing / code / sub-procedure /
// condition / attribute) lives in `/` — see `ProcedureSlashContent`.
export const PROCEDURE_REFERENCE_TABS: ReferenceTab[] = ['articles', 'tools', 'resources', 'fields']

// Empty-block hint — both insertion surfaces.
export const PROCEDURE_PLACEHOLDER =
  "Write a step, '/' to add a condition or code, '@' to reference a tool or field…"

// Module-scope render prop — an inline arrow would defeat PromptEditorContent's
// memo() on every ProseEditorCard render (focus state flips re-render the card).
const procedureSlashContent = (props: SlashContentProps) => <ProcedureSlashContent {...props} />

interface ProseEditorCardProps {
  /** Header label — 'Procedure' at the root, the sub-procedure name when drilled. */
  title: string
  /** Initial body content (read once at mount; the owner's refs own it thereafter). */
  initialContent: JSONContent[]
  onChange: (e: { json: JSONContent }) => void
  /** The draft owner's live editor — feeds char count + copy. */
  activeEditor: Editor | null
  onEditorReady: (editor: Editor | null) => void
  referencePickerRef: RefObject<ReferencePickerHandle | null>
  /**
   * Fill the parent's height (the drilled sub-procedure panel, which has no outer
   * ScrollArea) vs. the root's fixed min-height prose that the panel ScrollArea bounds.
   */
  fill?: boolean
}

/**
 * The procedure prose surface + its chrome (focus-gradient border, {@link PromptEditorHeader}
 * with char-count / copy / expand-to-dialog). Shared by the root {@link ProcedureEditor} and
 * the drilled sub-procedure body so both carry the same wrapper — the only difference is
 * `fill` (the drill fills its panel height; the root uses a min-height inside the panel scroll).
 */
export function ProseEditorCard({
  title,
  initialContent,
  onChange,
  activeEditor,
  onEditorReady,
  referencePickerRef,
  fill = false,
}: ProseEditorCardProps) {
  const [isExpanded, setExpanded] = useState(false)
  const [isFocused, setFocused] = useState(false)
  const [isCopied, setIsCopied] = useState(false)

  const handleCopy = useCallback(() => {
    if (!activeEditor) return
    const text = activeEditor.getText()
    if (navigator.clipboard) navigator.clipboard.writeText(text)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }, [activeEditor])

  const countSlot = useMemo(() => <PromptCharacterCount editor={activeEditor} />, [activeEditor])

  const header = (
    <PromptEditorHeader
      title={title}
      countSlot={countSlot}
      isExpanded={isExpanded}
      setExpanded={setExpanded}
      isCopied={isCopied}
      onCopy={handleCopy}
    />
  )

  // One prose instance; rendered inline OR in the expand dialog (the `!isExpanded` /
  // `isExpanded` branches are mutually exclusive, so only one mounts at a time).
  const prose = (
    <PromptEditorContent
      initialContent={initialContent}
      onChange={onChange}
      onEditorReady={onEditorReady}
      onFocusChange={setFocused}
      referencePickerRef={referencePickerRef}
      referenceTabs={PROCEDURE_REFERENCE_TABS}
      allowedBlocks={PROCEDURE_BLOCKS}
      slashContent={procedureSlashContent}
      placeholderText={PROCEDURE_PLACEHOLDER}
      alwaysShowLineNumbers
    />
  )

  return (
    <>
      <div
        className={cn(
          isFocused && !isExpanded
            ? 'bg-gradient-to-r from-[#0ba5ec] to-[#155aef]'
            : 'bg-transparent',
          '!rounded-[9px] p-0.5',
          fill ? 'flex flex-1 flex-col min-h-0' : 'me-1'
        )}>
        <div
          className={cn(
            isFocused ? 'bg-background' : 'bg-primary-200/30',
            'rounded-lg border',
            fill && 'flex flex-1 flex-col min-h-0'
          )}>
          {header}
          {!isExpanded &&
            (fill ? (
              <ScrollArea
                className='relative h-full min-h-0 px-3 flex-1 flex'
                fadeClassName=''
                allowScrollChaining
                scrollbarClassName='w-1 mr-0.5 data-[hovering]:opacity-0 hover:!opacity-100'>
                {prose}
              </ScrollArea>
            ) : (
              <div className='px-3'>
                <div className='relative flex w-full min-h-[300px]'>{prose}</div>
              </div>
            ))}
        </div>
      </div>

      <Dialog open={isExpanded} onOpenChange={setExpanded}>
        <DialogContent size='3xl' innerClassName='h-[80vh] flex flex-col p-0' showClose={false}>
          <VisuallyHidden>
            <DialogTitle>{title}</DialogTitle>
          </VisuallyHidden>
          <div className='shrink-0 border-b'>{header}</div>
          <div className='flex-1 min-h-0 overflow-hidden'>
            <ScrollArea
              className='relative h-full min-h-0 px-3 flex-1 flex'
              fadeClassName=''
              allowScrollChaining
              scrollbarClassName='w-1 mr-0.5 data-[hovering]:opacity-0 hover:!opacity-100'>
              {isExpanded && prose}
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
