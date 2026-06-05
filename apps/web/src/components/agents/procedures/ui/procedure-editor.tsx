// apps/web/src/components/agents/procedures/ui/procedure-editor.tsx
'use client'

import { Dialog, DialogContent, DialogTitle } from '@auxx/ui/components/dialog'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import Section, { EmptySection } from '@auxx/ui/components/section'
import { VisuallyHidden } from '@auxx/ui/components/visually-hidden'
import { cn } from '@auxx/ui/lib/utils'
import { ListChecks } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { ReferenceTab } from '~/components/editor/inline-picker/nodes/reference-picker-node'
import {
  PromptCharacterCount,
  PromptEditorContent,
  PromptEditorHeader,
} from '~/components/editor/prompt-editor'
import { type ProcedureDraftContextValue, useProcedureDraft } from './procedure-draft-provider'
import { ProcedureTriggerHeader } from './procedure-trigger-header'

// Procedures opt into the admin tabs (Tools, Resources, Fields) exactly like the
// persona editor, PLUS the procedure step tabs (Routing, Code, Sub-procedure,
// Condition, Attribute) — the `@` picker is the only insertion surface (plan §5).
// The CRM/inbox tabs from DEFAULT_TABS (people, records, messages) are dropped —
// they're meaningless inside a procedure; only `articles` carries over.
export const PROCEDURE_REFERENCE_TABS: ReferenceTab[] = [
  'articles',
  'tools',
  'resources',
  'fields',
  'routing',
  'code',
  'subprocedure',
  'condition',
  'attribute',
]

/**
 * The procedure authoring canvas — slimmed to the ROOT prose surface (v9 Phase 6).
 * Sub-procedure and code-block bodies no longer drill inside a private inner NavStack:
 * they're a third panel on the outer `agent-detail-tabs` NavStack ({@link ProcedureDrillPanel}).
 * This component is now just the main body editor + its header (expand-to-dialog / copy /
 * char-count), reading the single lifted owner ({@link useProcedureDraft}). The `@` picker
 * and procedure nodes are on; the inline badge cog calls `openDrill` through context.
 *
 * Visual structure mirrors the persona editor (focus-gradient border, header actions,
 * expand-to-dialog) — only the drill is gone.
 */
export function ProcedureEditor() {
  // Guard the brief procedure→root pop where the owner has unmounted but
  // AnimatePresence still holds this exiting panel — render nothing then (no hooks
  // run in the body, so this is safe).
  const draft = useProcedureDraft()
  if (!draft) return null
  return <ProcedureEditorBody draft={draft} />
}

function ProcedureEditorBody({ draft }: { draft: ProcedureDraftContextValue }) {
  const {
    procedureId,
    meta,
    isLoading,
    mainContent,
    handleMainChange,
    activeEditor,
    handleEditorReady,
    referencePickerRef,
    localAttributes,
    patchMeta,
  } = draft

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
      title='Procedure'
      countSlot={countSlot}
      isExpanded={isExpanded}
      setExpanded={setExpanded}
      isCopied={isCopied}
      onCopy={handleCopy}
    />
  )

  // The root prose surface. Rendered inline OR in the expand dialog (one instance at a
  // time — same as the persona editor). `initialContent` reads the owner's live main
  // body, so a remount on expand re-seeds the latest content, not a stale snapshot.
  const prose = (
    <PromptEditorContent
      initialContent={mainContent}
      onChange={handleMainChange}
      onEditorReady={handleEditorReady}
      onFocusChange={setFocused}
      referencePickerRef={referencePickerRef}
      referenceTabs={PROCEDURE_REFERENCE_TABS}
      enableProcedureNodes
    />
  )

  const handlePatch = useCallback((p: Parameters<typeof patchMeta>[0]) => patchMeta(p), [patchMeta])

  if (isLoading || !meta) return <EmptySection loading className='mx-3 my-3' />

  return (
    <>
      <ProcedureTriggerHeader
        key={procedureId}
        whenToUse={meta.whenToUse}
        triggerExamples={meta.triggerExamples}
        ruleset={meta.ruleset}
        localAttributes={localAttributes}
        onPatch={handlePatch}
      />
      <Section
        title='Procedure'
        icon={<ListChecks className='size-4' />}
        description='Describe the situation that should select this procedure.'
        initialOpen
        collapsible={false}>
        <div
          className={cn(
            isFocused && !isExpanded
              ? 'bg-gradient-to-r from-[#0ba5ec] to-[#155aef]'
              : 'bg-transparent',
            '!rounded-[9px] p-0.5 me-1'
          )}>
          <div
            className={cn(isFocused ? 'bg-background' : 'bg-primary-200/30', 'rounded-lg border')}>
            {header}
            {!isExpanded && (
              <div className='px-3'>
                <div className='relative flex w-full min-h-[300px]'>{prose}</div>
              </div>
            )}
          </div>
        </div>
      </Section>

      <Dialog open={isExpanded} onOpenChange={setExpanded}>
        <DialogContent size='3xl' innerClassName='h-[80vh] flex flex-col p-0' showClose={false}>
          <VisuallyHidden>
            <DialogTitle>Procedure</DialogTitle>
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
